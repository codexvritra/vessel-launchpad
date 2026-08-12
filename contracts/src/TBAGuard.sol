// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IERC6551Registry} from "./interfaces/IERC6551Registry.sol";
import {IERC6551Account} from "./interfaces/IERC6551Account.sol";

/// @title TBAGuard
/// @notice A settlement guard for trading token-bound NFTs that defends against
///         the drain-before-transfer attack:
///
///           1. A seller lists an NFT, advertising a TBA that holds assets.
///           2. A buyer commits funds.
///           3. Before settlement, the seller empties the TBA.
///           4. The buyer receives an NFT whose wallet is empty.
///
///         Defence = SNAPSHOT-ON-LIST. At list time we commit to the TBA's balance
///         set. Settlement re-reads live balances and reverts unless every declared
///         asset (and native ETH) is still present at >= the snapshotted amount. A
///         drained TBA fails the check, the buyer's payment is returned by the
///         revert, and no NFT changes hands.
///
///         See docs/TBAGuard.md for the full threat model and the escrow-on-list
///         alternative and its tradeoffs.
/// @dev    This is a minimal, self-custodial order book (no asset escrow). It holds
///         no NFTs and no TBA assets; it only gates the atomic swap of NFT-for-ETH
///         on a balance invariant. Seller proceeds use a pull-payment pattern.
contract TBAGuard is ReentrancyGuardTransient {
    // --------------------------------------------------------------------- //
    //                               Errors                                  //
    // --------------------------------------------------------------------- //
    error NotOwner();
    error NotSeller();
    error InactiveListing();
    error ListingExpired();
    error IncorrectPayment();
    error CommitMismatch();
    error BalancesChanged(); // a declared asset fell below its snapshot => drained
    error OwnershipChanged(); // seller moved the NFT out of band
    error NothingToWithdraw();
    error TransferFailed();
    error TooManyAssets();

    uint256 internal constant MAX_ASSETS = 32;

    IERC6551Registry public immutable registry;
    address public immutable accountImplementation;
    bytes32 public immutable accountSalt;

    struct Listing {
        address collection;
        uint256 tokenId;
        address seller;
        uint256 price;
        uint64 expiry;
        uint256 snapshotEth; // ETH balance of the TBA at list time
        bytes32 balanceCommit; // keccak256(abi.encode(assets, balances)) at list time
        uint256 stateSnapshot; // 6551 account state() at list time (informational)
        bool active;
    }

    uint256 public nextListingId;
    mapping(uint256 => Listing) public listings;
    /// @notice Pull-payment balances for sellers.
    mapping(address => uint256) public proceeds;

    event Listed(
        uint256 indexed listingId,
        address indexed collection,
        uint256 indexed tokenId,
        address seller,
        uint256 price,
        address account,
        uint256 snapshotEth,
        bytes32 balanceCommit
    );
    event Settled(uint256 indexed listingId, address indexed buyer, address indexed seller, uint256 price);
    event Cancelled(uint256 indexed listingId);
    event Withdrawn(address indexed seller, uint256 amount);

    error ZeroAddress();

    constructor(address registry_, address accountImplementation_, bytes32 accountSalt_) {
        if (registry_ == address(0) || accountImplementation_ == address(0)) revert ZeroAddress();
        registry = IERC6551Registry(registry_);
        accountImplementation = accountImplementation_;
        accountSalt = accountSalt_;
    }

    /// @notice Deterministic TBA address for a listed token.
    function accountOf(address collection, uint256 tokenId) public view returns (address) {
        return registry.account(accountImplementation, accountSalt, block.chainid, collection, tokenId);
    }

    // --------------------------------------------------------------------- //
    //                                List                                   //
    // --------------------------------------------------------------------- //

    /// @notice List an NFT for sale, snapshotting the balances the seller is
    ///         guaranteeing to deliver inside the token-bound account.
    /// @param collection The NFT collection.
    /// @param tokenId    The token being sold.
    /// @param price      Sale price in wei.
    /// @param expiry     Unix time after which the listing is void.
    /// @param assets     ERC-20 assets whose balances are guaranteed (native ETH is
    ///                    always guaranteed and need not be listed here).
    /// @dev The seller must own the token and approve this guard as an operator so
    ///      settlement can transfer it. We do NOT take custody of the NFT or the
    ///      TBA assets — see the escrow alternative in the docs.
    function list(
        address collection,
        uint256 tokenId,
        uint256 price,
        uint64 expiry,
        address[] calldata assets
    ) external returns (uint256 listingId) {
        if (assets.length > MAX_ASSETS) revert TooManyAssets();
        if (IERC721(collection).ownerOf(tokenId) != msg.sender) revert NotOwner();

        address tba = accountOf(collection, tokenId);

        uint256[] memory balances = new uint256[](assets.length);
        for (uint256 i; i < assets.length; ++i) {
            balances[i] = IERC20(assets[i]).balanceOf(tba);
        }
        bytes32 commit = keccak256(abi.encode(assets, balances));
        uint256 stateSnap = _safeState(tba);

        listingId = nextListingId++;
        listings[listingId] = Listing({
            collection: collection,
            tokenId: tokenId,
            seller: msg.sender,
            price: price,
            expiry: expiry,
            snapshotEth: tba.balance,
            balanceCommit: commit,
            stateSnapshot: stateSnap,
            active: true
        });

        emit Listed(listingId, collection, tokenId, msg.sender, price, tba, tba.balance, commit);
    }

    // --------------------------------------------------------------------- //
    //                               Settle                                  //
    // --------------------------------------------------------------------- //

    /// @notice Buy a listed NFT. Reverts unless the TBA still holds every declared
    ///         asset (and ETH) at >= the snapshotted amount — i.e. it was not
    ///         drained after listing.
    /// @param listingId The listing to settle.
    /// @param assets    The exact asset array committed to at list time.
    /// @param balances  The exact balances committed to at list time.
    /// @dev `assets`/`balances` are re-supplied by the buyer (or their client) and
    ///      checked against the on-chain commitment, so the snapshot cannot be
    ///      forged. The invariant is >= (not ==): deposits into the TBA after
    ///      listing are fine; only shortfalls (drains) revert.
    function settle(uint256 listingId, address[] calldata assets, uint256[] calldata balances)
        external
        payable
        nonReentrant
    {
        Listing storage l = listings[listingId];
        if (!l.active) revert InactiveListing();
        if (block.timestamp > l.expiry) revert ListingExpired();
        if (msg.value != l.price) revert IncorrectPayment();

        // The supplied snapshot must match what was committed at list time.
        if (keccak256(abi.encode(assets, balances)) != l.balanceCommit) revert CommitMismatch();

        address tba = accountOf(l.collection, l.tokenId);

        // Balance invariant: nothing was drained below the snapshot.
        if (tba.balance < l.snapshotEth) revert BalancesChanged();
        for (uint256 i; i < assets.length; ++i) {
            if (IERC20(assets[i]).balanceOf(tba) < balances[i]) revert BalancesChanged();
        }

        // Seller must still hold the token (no out-of-band transfer).
        if (IERC721(l.collection).ownerOf(l.tokenId) != l.seller) revert OwnershipChanged();

        // Effects before interactions.
        l.active = false;
        proceeds[l.seller] += msg.value;

        // Atomic hand-off: NFT (and, by the invariant above, its funded wallet)
        // moves to the buyer.
        IERC721(l.collection).safeTransferFrom(l.seller, msg.sender, l.tokenId);

        emit Settled(listingId, msg.sender, l.seller, l.price);
    }

    /// @notice Off-chain/UI helper: returns true if the listing is still honestly
    ///         fillable right now (not drained, not expired, still owned).
    function isFillable(uint256 listingId, address[] calldata assets, uint256[] calldata balances)
        external
        view
        returns (bool)
    {
        Listing storage l = listings[listingId];
        if (!l.active || block.timestamp > l.expiry) return false;
        if (keccak256(abi.encode(assets, balances)) != l.balanceCommit) return false;
        address tba = accountOf(l.collection, l.tokenId);
        if (tba.balance < l.snapshotEth) return false;
        for (uint256 i; i < assets.length; ++i) {
            if (IERC20(assets[i]).balanceOf(tba) < balances[i]) return false;
        }
        return IERC721(l.collection).ownerOf(l.tokenId) == l.seller;
    }

    // --------------------------------------------------------------------- //
    //                          Cancel / withdraw                            //
    // --------------------------------------------------------------------- //

    function cancel(uint256 listingId) external {
        Listing storage l = listings[listingId];
        if (!l.active) revert InactiveListing();
        if (l.seller != msg.sender) revert NotSeller();
        l.active = false;
        emit Cancelled(listingId);
    }

    function withdraw() external nonReentrant returns (uint256 amount) {
        amount = proceeds[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        proceeds[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(msg.sender, amount);
    }

    /// @dev Reads 6551 state() defensively; returns 0 if the account isn't deployed.
    function _safeState(address tba) internal view returns (uint256) {
        if (tba.code.length == 0) return 0;
        try IERC6551Account(payable(tba)).state() returns (uint256 s) {
            return s;
        } catch {
            return 0;
        }
    }
}
