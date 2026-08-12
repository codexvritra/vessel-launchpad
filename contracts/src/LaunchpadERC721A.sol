// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC721AUpgradeable} from "erc721a-upgradeable/ERC721AUpgradeable.sol";
import {IERC721AUpgradeable} from "erc721a-upgradeable/IERC721AUpgradeable.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

import {LaunchpadTypes} from "./LaunchpadTypes.sol";
import {DutchAuction} from "./libraries/DutchAuction.sol";
import {IERC6551Registry} from "./interfaces/IERC6551Registry.sol";
import {IFeeSplitter} from "./interfaces/IFeeSplitter.sol";
import {ITBASwapper} from "./interfaces/ITBASwapper.sol";

/// @title LaunchpadERC721A
/// @author Vessel (original work; mechanics reimplemented from public docs of
///         content-coin protocols, no third-party contract code copied)
/// @notice Cloneable ERC-721A collection. Each minted token id is paired with a
///         deterministic ERC-6551 token-bound account (TBA) that is deployed and
///         funded in the same transaction — so an NFT is a wallet holding assets,
///         not just an image reference.
/// @dev    Deployed once as an implementation; the factory creates EIP-1167
///         minimal-proxy clones and calls {initialize}. Clones have no
///         constructor, so all setup happens in {initialize}. Reentrancy is
///         guarded with transient storage (EVM Cancun), which needs no per-clone
///         initialization.
contract LaunchpadERC721A is ERC721AUpgradeable, ERC2981, ReentrancyGuardTransient {
    using LaunchpadTypes for LaunchpadTypes.CollectionConfig;

    // --------------------------------------------------------------------- //
    //                               Errors                                  //
    // --------------------------------------------------------------------- //
    error AlreadyInitialized();
    error InvalidConfig();
    error PhaseOutOfRange();
    error PhaseNotActive();
    error NotAllowlisted();
    error ZeroQuantity();
    error MaxSupplyExceeded();
    error PhaseSupplyExceeded();
    error WalletCapExceeded();
    error IncorrectPayment();
    error TBAFundingFailed();
    error NotCreator();
    error NothingToRescue();

    // --------------------------------------------------------------------- //
    //                          Init parameters                              //
    // --------------------------------------------------------------------- //
    struct InitParams {
        LaunchpadTypes.CollectionConfig config;
        address creator;
        address factory;
        address registry; // canonical 6551 registry
        address accountImplementation; // FIXED, factory-owned TBA implementation
        bytes32 accountSalt;
        address feeSplitter;
        address swapper; // optional ETH->backingAsset adapter (may be address(0))
        string baseTokenURI; // metadata service base; "" => on-chain fallback
        string contractURI_; // EIP-7572 contract metadata (URI or data URI)
    }

    // --------------------------------------------------------------------- //
    //                                State                                  //
    // --------------------------------------------------------------------- //
    address public creator;
    address public factory;
    IERC6551Registry public registry;
    address public accountImplementation;
    bytes32 public accountSalt;
    IFeeSplitter public feeSplitter;
    ITBASwapper public swapper;

    uint256 public maxSupply;
    uint256 public mintPrice; // headline price (phases may override)
    uint16 public tbaFundingBps;
    address public backingAsset;

    LaunchpadTypes.MintPhase[] private _phases;
    /// @dev phaseId => minter => count minted in that phase.
    mapping(uint256 => mapping(address => uint256)) public mintedInPhase;
    /// @dev phaseId => total minted in that phase.
    mapping(uint256 => uint256) public phaseMinted;

    string private _baseTokenURI;
    string private _contractURI;

    // --------------------------------------------------------------------- //
    //                                Events                                 //
    // --------------------------------------------------------------------- //
    event Initialized(address indexed creator, bytes32 configHash);
    event Minted(
        address indexed minter,
        uint256 indexed startTokenId,
        uint256 quantity,
        uint256 indexed phaseId,
        uint256 totalTbaFunding,
        uint256 totalPaid // primary-sale volume for this mint (post-refund), for indexers
    );
    /// @notice Primary per-token indexer event linking a token to its TBA.
    event TokenBoundAccountFunded(
        uint256 indexed tokenId, address indexed account, address asset, uint256 amount
    );
    event BaseURIUpdated(string baseURI);
    event ContractURIUpdated(string contractURI);

    // --------------------------------------------------------------------- //
    //                             Initializer                               //
    // --------------------------------------------------------------------- //

    /// @notice One-time clone setup. Guarded by ERC721A's initializer.
    function initialize(InitParams calldata p) external initializerERC721A {
        LaunchpadTypes.CollectionConfig calldata c = p.config;
        if (c.maxSupply == 0) revert InvalidConfig();
        if (c.royaltyBps > 10_000) revert InvalidConfig();
        if (c.tbaFundingBps > 10_000) revert InvalidConfig();
        if (p.registry == address(0) || p.accountImplementation == address(0)) revert InvalidConfig();
        if (p.feeSplitter == address(0)) revert InvalidConfig();
        if (c.mintPhases.length == 0) revert InvalidConfig();

        __ERC721A_init(c.name, c.symbol);

        creator = p.creator;
        factory = p.factory;
        registry = IERC6551Registry(p.registry);
        accountImplementation = p.accountImplementation;
        accountSalt = p.accountSalt;
        feeSplitter = IFeeSplitter(p.feeSplitter);
        swapper = ITBASwapper(p.swapper);

        maxSupply = c.maxSupply;
        mintPrice = c.mintPrice;
        tbaFundingBps = c.tbaFundingBps;
        backingAsset = c.backingAsset;

        for (uint256 i; i < c.mintPhases.length; ++i) {
            _phases.push(c.mintPhases[i]);
        }

        _setDefaultRoyalty(p.creator, uint96(c.royaltyBps));

        _baseTokenURI = p.baseTokenURI;
        _contractURI = p.contractURI_;

        emit Initialized(p.creator, keccak256(abi.encode(c)));
    }

    // --------------------------------------------------------------------- //
    //                                Mint                                   //
    // --------------------------------------------------------------------- //

    /// @notice Mint `quantity` tokens in `phaseId`, deploying and funding a
    ///         token-bound account for each new token id.
    /// @param phaseId  Index into the collection's phases.
    /// @param quantity Number of tokens to mint.
    /// @param proof    Merkle proof of `msg.sender` for allowlist phases (ignored
    ///                 for public phases).
    function mint(uint256 phaseId, uint256 quantity, bytes32[] calldata proof) external payable nonReentrant {
        if (quantity == 0) revert ZeroQuantity();
        if (phaseId >= _phases.length) revert PhaseOutOfRange();
        LaunchpadTypes.MintPhase storage ph = _phases[phaseId];

        // --- Phase window ---
        if (block.timestamp < ph.startTime || block.timestamp >= ph.endTime) {
            revert PhaseNotActive();
        }

        // --- Allowlist ---
        if (ph.merkleRoot != bytes32(0)) {
            bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender))));
            if (!MerkleProof.verifyCalldata(proof, ph.merkleRoot, leaf)) revert NotAllowlisted();
        }

        // --- Supply / caps (effects computed and written before interactions) ---
        if (_totalMinted() + quantity > maxSupply) revert MaxSupplyExceeded();
        if (ph.maxMintable != 0 && phaseMinted[phaseId] + quantity > ph.maxMintable) {
            revert PhaseSupplyExceeded();
        }
        uint256 walletTotal = mintedInPhase[phaseId][msg.sender] + quantity;
        if (ph.perWalletCap != 0 && walletTotal > ph.perWalletCap) revert WalletCapExceeded();

        // Price is the current Dutch-auction price (or the fixed price). Minters
        // may overpay (the auction price can tick down between signing and mining);
        // the excess is refunded at the end.
        uint256 unitPrice =
            DutchAuction.priceAt(ph.price, ph.endPrice, ph.startTime, ph.endTime, block.timestamp);
        uint256 cost = unitPrice * quantity;
        if (msg.value < cost) revert IncorrectPayment();

        // Update accounting BEFORE any external call (checks-effects-interactions).
        mintedInPhase[phaseId][msg.sender] = walletTotal;
        phaseMinted[phaseId] += quantity;

        uint256 startTokenId = _nextTokenId();
        _mint(msg.sender, quantity); // ERC721A batch mint (cheap)

        // --- Deploy + fund a TBA per token ---
        // Per-token floor then multiply is intentional: every TBA receives exactly
        // `fundingPerToken`, and proceeds are the exact remainder, so value is
        // conserved to the wei (see testFuzz_FeeSplitConservation).
        // slither-disable-next-line divide-before-multiply
        uint256 fundingPerToken = (unitPrice * tbaFundingBps) / 10_000;
        uint256 totalFunding = fundingPerToken * quantity;

        if (fundingPerToken > 0) {
            for (uint256 i; i < quantity; ++i) {
                _fundTokenAccount(startTokenId + i, fundingPerToken);
            }
        }

        // --- Route remaining proceeds via pull-payment splitter ---
        uint256 proceeds = cost - totalFunding;
        if (proceeds > 0) {
            feeSplitter.depositMintProceeds{value: proceeds}(address(this), creator);
        }

        // --- Refund any overpayment (interaction last, after all effects) ---
        uint256 refund = msg.value - cost;
        if (refund > 0) {
            (bool ok,) = msg.sender.call{value: refund}("");
            if (!ok) revert TBAFundingFailed();
        }

        emit Minted(msg.sender, startTokenId, quantity, phaseId, totalFunding, cost);
    }

    /// @dev Deploys the deterministic TBA for `tokenId` and moves `amount` into it,
    ///      optionally swapping to the backing asset atomically.
    function _fundTokenAccount(uint256 tokenId, uint256 amount) private {
        address tba =
            registry.createAccount(accountImplementation, accountSalt, block.chainid, address(this), tokenId);

        if (backingAsset == address(0) || address(swapper) == address(0)) {
            // Destination is the deterministic 6551 account for this token (from the
            // canonical registry), not an attacker-supplied address.
            // slither-disable-next-line arbitrary-send-eth
            (bool ok,) = tba.call{value: amount}("");
            if (!ok) revert TBAFundingFailed();
            emit TokenBoundAccountFunded(tokenId, tba, address(0), amount);
        } else {
            // `swapper` is the owner-configured, audited adapter; minAmountOut is
            // left to its Chainlink-aware default, which reverts on excess slippage.
            // slither-disable-next-line arbitrary-send-eth
            uint256 out = swapper.swapETHForAsset{value: amount}(backingAsset, tba, 0);
            emit TokenBoundAccountFunded(tokenId, tba, backingAsset, out);
        }
    }

    /// @notice Deterministic TBA address for a token id (view helper for the UI/indexer).
    function accountOf(uint256 tokenId) external view returns (address) {
        return registry.account(accountImplementation, accountSalt, block.chainid, address(this), tokenId);
    }

    // --------------------------------------------------------------------- //
    //                              Metadata                                 //
    // --------------------------------------------------------------------- //

    function _startTokenId() internal pure override returns (uint256) {
        return 1;
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    /// @notice Token metadata. Points at the off-chain metadata service when a base
    ///         URI is configured; otherwise returns a minimal on-chain JSON so the
    ///         token is never unreadable if the service is down.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        if (!_exists(tokenId)) revert URIQueryForNonexistentToken();
        string memory base = _baseURI();
        if (bytes(base).length != 0) {
            return string.concat(base, _toString(tokenId));
        }
        // On-chain fallback.
        string memory json = string.concat(
            '{"name":"',
            name(),
            " #",
            _toString(tokenId),
            '","description":"A token-bound NFT wallet.","attributes":[{"trait_type":"tokenId","value":',
            _toString(tokenId),
            "}]}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    /// @notice EIP-7572 contract-level metadata.
    function contractURI() external view returns (string memory) {
        return _contractURI;
    }

    // --------------------------------------------------------------------- //
    //                          Creator admin                               //
    // --------------------------------------------------------------------- //

    modifier onlyCreator() {
        if (msg.sender != creator) revert NotCreator();
        _;
    }

    function setBaseURI(string calldata newBase) external onlyCreator {
        _baseTokenURI = newBase;
        emit BaseURIUpdated(newBase);
    }

    function setContractURI(string calldata newURI) external onlyCreator {
        _contractURI = newURI;
        emit ContractURIUpdated(newURI);
    }

    /// @notice Rescue ETH accidentally sent to the collection (proceeds normally
    ///         leave in the same tx via the splitter, so this should be ~0).
    function rescueETH(address to) external onlyCreator {
        if (to == address(0)) revert InvalidConfig();
        uint256 bal = address(this).balance;
        // slither-disable-next-line incorrect-equality
        if (bal == 0) revert NothingToRescue();
        (bool ok,) = to.call{value: bal}("");
        if (!ok) revert TBAFundingFailed();
    }

    // --------------------------------------------------------------------- //
    //                              Views                                    //
    // --------------------------------------------------------------------- //

    function phases() external view returns (LaunchpadTypes.MintPhase[] memory) {
        return _phases;
    }

    function phase(uint256 phaseId) external view returns (LaunchpadTypes.MintPhase memory) {
        return _phases[phaseId];
    }

    function phaseCount() external view returns (uint256) {
        return _phases.length;
    }

    /// @notice The live mint price for a phase right now — the current Dutch-auction
    ///         price for auction phases, or the fixed price otherwise. Used by the UI
    ///         to display a ticking price and to size the payment (+buffer).
    function currentPrice(uint256 phaseId) external view returns (uint256) {
        LaunchpadTypes.MintPhase storage ph = _phases[phaseId];
        return DutchAuction.priceAt(ph.price, ph.endPrice, ph.startTime, ph.endTime, block.timestamp);
    }

    function totalMinted() external view returns (uint256) {
        return _totalMinted();
    }

    // --------------------------------------------------------------------- //
    //                            Interfaces                                 //
    // --------------------------------------------------------------------- //

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721AUpgradeable, ERC2981)
        returns (bool)
    {
        return ERC721AUpgradeable.supportsInterface(interfaceId) || ERC2981.supportsInterface(interfaceId);
    }
}
