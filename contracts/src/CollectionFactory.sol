// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {LaunchpadTypes} from "./LaunchpadTypes.sol";
import {LaunchpadERC721A} from "./LaunchpadERC721A.sol";

interface ICoinFactory {
    function enableMarket(address collection) external returns (address);
}

/// @title CollectionFactory
/// @notice Permissionless launchpad factory. Deploys EIP-1167 minimal-proxy
///         clones of a single audited {LaunchpadERC721A} implementation, so each
///         new collection costs ~50k gas instead of a full ~2M-gas deploy — the
///         economics that make an open launchpad viable.
/// @dev    SECURITY INVARIANT: the ERC-6551 account implementation is fixed and
///         owner-controlled. Creators cannot supply their own. A malicious account
///         implementation could drain a token's TBA on transfer, converting the
///         platform into a rug factory; this is non-negotiable and enforced by the
///         factory never reading an implementation address from creator input.
contract CollectionFactory is Ownable {
    using Clones for address;

    // --------------------------------------------------------------------- //
    //                               Errors                                  //
    // --------------------------------------------------------------------- //
    error ZeroAddress();
    error InvalidRoyalty();
    error InvalidFunding();
    error NoPhases();
    error ZeroMaxSupply();
    error IncorrectDeployFee();
    error WithdrawFailed();

    // --------------------------------------------------------------------- //
    //                          Platform settings                            //
    // --------------------------------------------------------------------- //

    /// @notice The audited, cloneable ERC-721A implementation.
    address public collectionImplementation;
    /// @notice Canonical ERC-6551 registry (deterministic across EVM chains).
    address public immutable registry;
    /// @notice The FIXED token-bound account implementation used by every clone.
    address public accountImplementation;
    /// @notice Pull-payment splitter that receives mint proceeds.
    address public feeSplitter;
    /// @notice Optional ETH->backingAsset swap adapter passed to clones.
    address public swapper;
    /// @notice Optional coin/market factory. When set, a creator can opt into having
    ///         a fungible {CollectionCoin} + SushiSwap market auto-enabled at creation.
    address public coinFactory;
    /// @notice Flat fee (wei) charged to deploy a collection. Default 0 (free).
    ///         Accumulates in the factory; the owner withdraws it.
    uint256 public deployFee;
    /// @notice Platform-wide salt for 6551 account derivation.
    bytes32 public accountSalt;

    // --------------------------------------------------------------------- //
    //                            Enumeration                                //
    // --------------------------------------------------------------------- //

    /// @notice Per-collection metadata for on-chain enumeration and hook referral
    ///         validation.
    mapping(address => LaunchpadTypes.CollectionMeta) public collections;
    address[] public allCollections;
    /// @dev creator => monotonically increasing nonce, salts deterministic clones.
    mapping(address => uint256) public creatorNonce;

    // --------------------------------------------------------------------- //
    //                                Events                                 //
    // --------------------------------------------------------------------- //

    /// @notice PRIMARY indexer event. Emitted once per collection.
    event CollectionCreated(address indexed collection, address indexed creator, bytes32 configHash);
    event CollectionImplementationUpdated(address indexed impl);
    event AccountImplementationUpdated(address indexed impl);
    event FeeSplitterUpdated(address indexed splitter);
    event SwapperUpdated(address indexed swapper);
    event CoinFactoryUpdated(address indexed coinFactory);
    event MarketAutoEnabled(address indexed collection, address indexed coin);
    event DeployFeeUpdated(uint256 fee);

    // --------------------------------------------------------------------- //
    //                             Constructor                               //
    // --------------------------------------------------------------------- //

    constructor(
        address owner_,
        address registry_,
        address collectionImplementation_,
        address accountImplementation_,
        address feeSplitter_
    ) Ownable(owner_) {
        if (
            registry_ == address(0) || collectionImplementation_ == address(0)
                || accountImplementation_ == address(0) || feeSplitter_ == address(0)
        ) revert ZeroAddress();
        registry = registry_;
        collectionImplementation = collectionImplementation_;
        accountImplementation = accountImplementation_;
        feeSplitter = feeSplitter_;
    }

    // --------------------------------------------------------------------- //
    //                          Create collection                            //
    // --------------------------------------------------------------------- //

    /// @notice Deploy a new collection clone and initialize it.
    /// @param config        Creator-supplied collection configuration. NOTE: it
    ///                       carries no account-implementation field by design.
    /// @param baseTokenURI  Metadata service base ("" => on-chain fallback).
    /// @param contractURI   EIP-7572 contract-level metadata.
    /// @param enableCoinMarket If true and a coin factory is configured, a fungible
    ///                       coin + SushiSwap market is auto-enabled in the same tx.
    /// @return collection   The deployed clone address.
    function createCollection(
        LaunchpadTypes.CollectionConfig calldata config,
        string calldata baseTokenURI,
        string calldata contractURI,
        bool enableCoinMarket
    ) external payable returns (address collection) {
        if (msg.value != deployFee) revert IncorrectDeployFee();
        if (config.maxSupply == 0) revert ZeroMaxSupply();
        if (config.royaltyBps > 10_000) revert InvalidRoyalty();
        if (config.tbaFundingBps > 10_000) revert InvalidFunding();
        if (config.mintPhases.length == 0) revert NoPhases();

        bytes32 configHash = keccak256(abi.encode(config));
        bytes32 salt = keccak256(abi.encodePacked(msg.sender, creatorNonce[msg.sender]++));

        collection = collectionImplementation.cloneDeterministic(salt);

        // Effects before the external initialize() call (checks-effects-interactions).
        // initialize() runs on our own freshly-deployed clone and cannot re-enter,
        // but recording state first keeps the ordering unconditionally safe.
        collections[collection] = LaunchpadTypes.CollectionMeta({
            creator: msg.sender,
            backingAsset: config.backingAsset,
            royaltyBps: config.royaltyBps,
            tbaFundingBps: config.tbaFundingBps,
            maxSupply: config.maxSupply,
            configHash: configHash,
            createdAt: uint64(block.timestamp),
            exists: true
        });
        allCollections.push(collection);

        LaunchpadERC721A(payable(collection))
            .initialize(
                LaunchpadERC721A.InitParams({
                config: config,
                creator: msg.sender,
                factory: address(this),
                registry: registry,
                accountImplementation: accountImplementation, // FIXED, never from input
                accountSalt: accountSalt,
                feeSplitter: feeSplitter,
                swapper: swapper,
                baseTokenURI: baseTokenURI,
                contractURI_: contractURI
            })
            );

        emit CollectionCreated(collection, msg.sender, configHash);

        // Opt-in: auto-enable the fungible coin + SushiSwap market in the same tx.
        // Wrapped so a coin-factory issue can never block collection creation.
        if (enableCoinMarket && coinFactory != address(0)) {
            try ICoinFactory(coinFactory).enableMarket(collection) returns (address coin) {
                emit MarketAutoEnabled(collection, coin);
            } catch {}
        }
    }

    /// @notice Predict the address of the next collection `creator` will deploy.
    function predictCollectionAddress(address creator) external view returns (address) {
        bytes32 salt = keccak256(abi.encodePacked(creator, creatorNonce[creator]));
        return collectionImplementation.predictDeterministicAddress(salt, address(this));
    }

    // --------------------------------------------------------------------- //
    //                               Views                                   //
    // --------------------------------------------------------------------- //

    /// @notice True if `addr` is a collection deployed by this factory. Used by the
    ///         hook to validate referral addresses passed as swap hook data.
    function isCollection(address addr) external view returns (bool) {
        return collections[addr].exists;
    }

    function collectionsCount() external view returns (uint256) {
        return allCollections.length;
    }

    /// @notice Paginated enumeration for indexers/UI.
    function collectionsPage(uint256 offset, uint256 limit) external view returns (address[] memory page) {
        uint256 total = allCollections.length;
        if (offset >= total) return new address[](0);
        uint256 end = offset + limit;
        if (end > total) end = total;
        page = new address[](end - offset);
        for (uint256 i = offset; i < end; ++i) {
            page[i - offset] = allCollections[i];
        }
    }

    // --------------------------------------------------------------------- //
    //                          Owner administration                         //
    // --------------------------------------------------------------------- //

    function setCollectionImplementation(address impl) external onlyOwner {
        if (impl == address(0)) revert ZeroAddress();
        collectionImplementation = impl;
        emit CollectionImplementationUpdated(impl);
    }

    /// @notice Update the FIXED TBA implementation used by future clones. Owner-only;
    ///         creators can never influence this value.
    function setAccountImplementation(address impl) external onlyOwner {
        if (impl == address(0)) revert ZeroAddress();
        accountImplementation = impl;
        emit AccountImplementationUpdated(impl);
    }

    function setFeeSplitter(address splitter) external onlyOwner {
        if (splitter == address(0)) revert ZeroAddress();
        feeSplitter = splitter;
        emit FeeSplitterUpdated(splitter);
    }

    function setSwapper(address swapper_) external onlyOwner {
        // address(0) is valid: disables atomic swaps, TBAs hold ETH.
        swapper = swapper_;
        emit SwapperUpdated(swapper_);
    }

    function setAccountSalt(bytes32 salt) external onlyOwner {
        accountSalt = salt;
    }

    /// @notice Wire the coin/market factory used for auto-enable at creation.
    ///         address(0) disables auto-enable.
    function setCoinFactory(address coinFactory_) external onlyOwner {
        coinFactory = coinFactory_;
        emit CoinFactoryUpdated(coinFactory_);
    }

    /// @notice Set the flat deploy fee (wei). Default 0 keeps deployment free.
    function setDeployFee(uint256 fee) external onlyOwner {
        deployFee = fee;
        emit DeployFeeUpdated(fee);
    }

    /// @notice Withdraw accumulated deploy fees to `to`.
    function withdrawFees(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = address(this).balance;
        // slither-disable-next-line arbitrary-send-eth
        (bool ok,) = to.call{value: bal}("");
        if (!ok) revert WithdrawFailed();
    }
}
