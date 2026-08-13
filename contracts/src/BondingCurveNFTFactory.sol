// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import {BondingCurveNFT} from "./BondingCurveNFT.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";

/// @title BondingCurveNFTFactory
/// @notice Launches {BondingCurveNFT} collections via EIP-1167 clones. Launching
///         costs a USD-denominated fee (default $3, priced via a Chainlink ETH/USD
///         feed) paid to the protocol wallet; every launched collection carries a
///         1% buy/sell fee to the same wallet.
contract BondingCurveNFTFactory is Ownable, ReentrancyGuardTransient {
    error InsufficientLaunchFee();
    error TransferFailed();
    error BadCurve();

    address public immutable implementation;
    IAggregatorV3 public ethUsdFeed;
    address public protocolRecipient; // launch fee + 1% trade fee
    uint256 public launchFeeUsd = 3e18; // $3, 18-dp USD
    uint16 public tradeFeeBps = 100; // 1% buy/sell

    mapping(address => bool) public isCollection;
    address[] public allCollections;

    event Launched(
        address indexed collection,
        address indexed creator,
        string name,
        string symbol,
        uint256 basePrice,
        uint256 slope,
        uint256 maxSupply
    );
    event ConfigUpdated();

    constructor(
        address owner_,
        address implementation_,
        address ethUsdFeed_,
        address protocolRecipient_
    ) Ownable(owner_) {
        implementation = implementation_;
        ethUsdFeed = IAggregatorV3(ethUsdFeed_);
        protocolRecipient = protocolRecipient_;
    }

    /// @notice Launch a bonding-curve NFT collection. `msg.value` must cover the
    ///         launch fee; any excess is refunded.
    /// @param basePrice_ price of the first token (wei)
    /// @param slope_     price increase per token (wei)
    /// @param maxSupply_ hard cap (0 => uncapped)
    /// @param uri_       collection metadata (data:/ipfs:/https URI)
    function launch(
        string calldata name_,
        string calldata symbol_,
        uint256 basePrice_,
        uint256 slope_,
        uint256 maxSupply_,
        string calldata uri_
    ) external payable nonReentrant returns (address collection) {
        if (basePrice_ == 0) revert BadCurve();
        uint256 fee = launchFeeWei();
        if (msg.value < fee) revert InsufficientLaunchFee();

        collection = Clones.clone(implementation);
        BondingCurveNFT(payable(collection)).initialize(
            BondingCurveNFT.Init({
                name: name_,
                symbol: symbol_,
                basePrice: basePrice_,
                slope: slope_,
                maxSupply: maxSupply_,
                feeBps: tradeFeeBps,
                protocol: protocolRecipient,
                creator: msg.sender,
                uri: uri_
            })
        );

        isCollection[collection] = true;
        allCollections.push(collection);

        _pay(protocolRecipient, fee);
        uint256 refund = msg.value - fee;
        if (refund != 0) _pay(msg.sender, refund);

        emit Launched(collection, msg.sender, name_, symbol_, basePrice_, slope_, maxSupply_);
    }

    /// @notice Launch fee in wei from the USD target and the ETH/USD feed.
    function launchFeeWei() public view returns (uint256) {
        (, int256 answer,,,) = ethUsdFeed.latestRoundData();
        if (answer <= 0) return 0;
        uint256 dec = ethUsdFeed.decimals();
        return (launchFeeUsd * (10 ** dec)) / uint256(answer);
    }

    function collectionsCount() external view returns (uint256) {
        return allCollections.length;
    }

    // --- Admin ---

    function setProtocolRecipient(address r) external onlyOwner {
        protocolRecipient = r;
        emit ConfigUpdated();
    }

    function setLaunchFeeUsd(uint256 usd) external onlyOwner {
        launchFeeUsd = usd;
        emit ConfigUpdated();
    }

    function setTradeFeeBps(uint16 bps) external onlyOwner {
        require(bps <= 1000, "fee too high"); // <= 10%
        tradeFeeBps = bps;
        emit ConfigUpdated();
    }

    function setEthUsdFeed(address f) external onlyOwner {
        ethUsdFeed = IAggregatorV3(f);
        emit ConfigUpdated();
    }

    function _pay(address to, uint256 amount) private {
        if (amount == 0) return;
        // slither-disable-next-line arbitrary-send-eth
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
