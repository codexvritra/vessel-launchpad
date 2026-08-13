// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC721AUpgradeable} from "erc721a-upgradeable/ERC721AUpgradeable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

/// @title BondingCurveNFT
/// @notice Cloneable ERC-721A whose price rises along a linear bonding curve.
///         `buy` mints at the current curve price (price grows with supply);
///         `sell` burns owned NFTs back to the contract at the current price.
///
///         The contract holds an ETH reserve equal to the sum of the prices of
///         every live token, so sells are ALWAYS payable (see BondingCurveNFT
///         tests for the solvency invariant). A `feeBps` cut is added on top of
///         buys and deducted from sells, routed to the protocol wallet.
///
///         Early buyers profit: they mint cheap, and when later demand raises the
///         supply the sell price rises with it — they redeem higher than they paid.
contract BondingCurveNFT is ERC721AUpgradeable, ReentrancyGuardTransient {
    error ZeroQty();
    error MaxSupplyReached();
    error Underpaid();
    error NotYourToken();
    error TransferFailed();

    uint256 public basePrice; // price of the 1st token (wei)
    uint256 public slope; // price increment per token (wei)
    uint256 public maxSupply; // 0 => uncapped
    uint16 public feeBps; // protocol fee, e.g. 100 = 1%
    address public protocol; // fee recipient
    address public creator; // who launched it
    string private _uri; // collection metadata (data:/ipfs:/https:)

    /// @dev Grouped into a struct so the ABI decoder stays shallow (avoids
    ///      stack-too-deep with the default, non-IR pipeline).
    struct Init {
        string name;
        string symbol;
        uint256 basePrice;
        uint256 slope;
        uint256 maxSupply;
        uint16 feeBps;
        address protocol;
        address creator;
        string uri;
    }

    event Bought(address indexed buyer, uint256 quantity, uint256 cost, uint256 fee, uint256 supply);
    event Sold(address indexed seller, uint256 quantity, uint256 proceeds, uint256 fee, uint256 supply);

    function initialize(Init calldata p) external initializerERC721A {
        __ERC721A_init(p.name, p.symbol);
        basePrice = p.basePrice;
        slope = p.slope;
        maxSupply = p.maxSupply;
        feeBps = p.feeBps;
        protocol = p.protocol;
        creator = p.creator;
        _uri = p.uri;
    }

    function _startTokenId() internal pure override returns (uint256) {
        return 1;
    }

    // ------------------------------------------------------------------ //
    //                          Curve pricing                             //
    // ------------------------------------------------------------------ //

    /// @notice Cost (excluding fee) to buy `q` tokens at the current supply.
    /// @dev sum_{i=1..q} [basePrice + slope*(s+i-1)] = q*basePrice + slope*(q*s + q*(q-1)/2).
    function buyCost(uint256 q) public view returns (uint256) {
        uint256 s = totalSupply();
        return q * basePrice + slope * (q * s + (q * (q - 1)) / 2);
    }

    /// @notice Proceeds (excluding fee) to sell `q` tokens at the current supply.
    /// @dev sum_{k=s-q+1..s} [basePrice + slope*(k-1)] = q*basePrice + slope*(q*(2s-q-1)/2).
    ///      q*(2s-q-1) is always even, so the division is exact.
    function sellProceeds(uint256 q) public view returns (uint256) {
        uint256 s = totalSupply();
        if (q == 0 || q > s) return 0;
        return q * basePrice + slope * ((q * (2 * s - q - 1)) / 2);
    }

    function feeOn(uint256 amount) public view returns (uint256) {
        return (amount * feeBps) / 10_000;
    }

    /// @notice What a buyer pays for `q` tokens (curve cost + fee).
    function buyQuote(uint256 q) external view returns (uint256 total) {
        uint256 cost = buyCost(q);
        total = cost + feeOn(cost);
    }

    /// @notice What a seller receives for `q` tokens (curve proceeds − fee).
    function sellQuote(uint256 q) external view returns (uint256 net) {
        uint256 proceeds = sellProceeds(q);
        net = proceeds - feeOn(proceeds);
    }

    function reserve() external view returns (uint256) {
        return address(this).balance;
    }

    // ------------------------------------------------------------------ //
    //                             Trading                                //
    // ------------------------------------------------------------------ //

    function buy(uint256 quantity) external payable nonReentrant {
        if (quantity == 0) revert ZeroQty();
        uint256 s = totalSupply();
        if (maxSupply != 0 && s + quantity > maxSupply) revert MaxSupplyReached();

        uint256 cost = buyCost(quantity);
        uint256 fee = feeOn(cost);
        uint256 total = cost + fee;
        if (msg.value < total) revert Underpaid();

        // Effects: mint. The reserve keeps exactly `cost`; `fee` and any
        // overpayment leave the contract below.
        _mint(msg.sender, quantity);

        _pay(protocol, fee);
        uint256 refund = msg.value - total;
        if (refund != 0) _pay(msg.sender, refund);

        emit Bought(msg.sender, quantity, cost, fee, totalSupply());
    }

    function sell(uint256[] calldata tokenIds) external nonReentrant {
        uint256 q = tokenIds.length;
        if (q == 0) revert ZeroQty();

        uint256 proceeds = sellProceeds(q);
        uint256 fee = feeOn(proceeds);

        // Effects: burn every token (each must be owned by the seller).
        for (uint256 i; i < q; ++i) {
            if (ownerOf(tokenIds[i]) != msg.sender) revert NotYourToken();
            _burn(tokenIds[i]);
        }

        _pay(protocol, fee);
        _pay(msg.sender, proceeds - fee);

        emit Sold(msg.sender, q, proceeds, fee, totalSupply());
    }

    // ------------------------------------------------------------------ //
    //                             Metadata                               //
    // ------------------------------------------------------------------ //

    function contractURI() external view returns (string memory) {
        return _uri;
    }

    function tokenURI(uint256) public view override returns (string memory) {
        return _uri;
    }

    function _pay(address to, uint256 amount) private {
        if (amount == 0) return;
        // `to` is the connected caller or the owner-configured protocol wallet.
        // slither-disable-next-line arbitrary-send-eth
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
