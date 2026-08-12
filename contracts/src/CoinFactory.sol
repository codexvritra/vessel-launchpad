// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC721Metadata} from "@openzeppelin/contracts/token/ERC721/extensions/IERC721Metadata.sol";
import {CollectionCoin} from "./CollectionCoin.sol";

interface ICollectionRegistry {
    function isCollection(address addr) external view returns (bool);
}

/// @title CoinFactory
/// @notice Permissionlessly attaches a fungible {CollectionCoin} vault to any
///         collection deployed by the launchpad, enabling a Zora-style AMM market.
///         Anyone can enable the coin for a real collection (it is neutral infra,
///         not a privileged action); seeding liquidity is then a separate, opt-in
///         step via the configured {IMarketDeployer} (SushiSwap).
/// @dev    Coins are EIP-1167 clones of a single implementation — the same cheap
///         pattern as the collection factory.
contract CoinFactory is Ownable {
    using Clones for address;

    error NotACollection();
    error AlreadyEnabled();
    error ZeroAddress();

    /// @notice Cloneable {CollectionCoin} implementation.
    address public coinImplementation;
    /// @notice The launchpad's collection registry (isCollection).
    ICollectionRegistry public immutable registry;
    /// @notice The AMM market deployer (SushiSwap) coins seed liquidity through.
    address public marketDeployer;

    mapping(address => address) public coinOf; // collection => coin
    address[] public allCoins;

    event MarketEnabled(address indexed collection, address indexed coin);
    event CoinImplementationUpdated(address indexed impl);
    event MarketDeployerUpdated(address indexed deployer);

    constructor(address owner_, address registry_, address coinImplementation_, address marketDeployer_)
        Ownable(owner_)
    {
        if (registry_ == address(0) || coinImplementation_ == address(0)) revert ZeroAddress();
        registry = ICollectionRegistry(registry_);
        coinImplementation = coinImplementation_;
        marketDeployer = marketDeployer_;
    }

    /// @notice Deploy the fungible coin/vault for a collection (once). Permissionless.
    function enableMarket(address collection) external returns (address coin) {
        if (!registry.isCollection(collection)) revert NotACollection();
        if (coinOf[collection] != address(0)) revert AlreadyEnabled();

        coin = coinImplementation.clone();
        string memory n = string.concat(IERC721Metadata(collection).name(), " Coin");
        string memory s = string.concat("c", IERC721Metadata(collection).symbol());

        // Effects before the external initialize() call (CEI). initialize() runs on
        // our own fresh clone and cannot re-enter.
        coinOf[collection] = coin;
        allCoins.push(coin);

        CollectionCoin(coin).initialize(collection, n, s);
        emit MarketEnabled(collection, coin);
    }

    function coinsCount() external view returns (uint256) {
        return allCoins.length;
    }

    function setCoinImplementation(address impl) external onlyOwner {
        if (impl == address(0)) revert ZeroAddress();
        coinImplementation = impl;
        emit CoinImplementationUpdated(impl);
    }

    function setMarketDeployer(address deployer) external onlyOwner {
        marketDeployer = deployer; // address(0) allowed: disables seeding
        emit MarketDeployerUpdated(deployer);
    }
}
