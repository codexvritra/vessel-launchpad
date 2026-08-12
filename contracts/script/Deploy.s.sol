// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {ERC6551Registry} from "erc6551/ERC6551Registry.sol";
import {ERC6551Account} from "erc6551/examples/simple/ERC6551Account.sol";

import {CollectionFactory} from "../src/CollectionFactory.sol";
import {LaunchpadERC721A} from "../src/LaunchpadERC721A.sol";
import {FeeSplitter} from "../src/FeeSplitter.sol";
import {TBAGuard} from "../src/TBAGuard.sol";
import {CollectionCoin} from "../src/CollectionCoin.sol";
import {CoinFactory} from "../src/CoinFactory.sol";
import {SushiMarketDeployer} from "../src/SushiMarketDeployer.sol";
import {LiquidityLauncher} from "../src/LiquidityLauncher.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {BondingCurve} from "../src/BondingCurve.sol";
import {TokenLauncher} from "../src/TokenLauncher.sol";
import {MockAggregator} from "../test/mocks/Mocks.sol";

/// @notice Deploys the launchpad core stack. On a chain where the canonical ERC-6551
///         registry already exists we reuse it; otherwise (local anvil) we deploy a
///         local one. All addresses are logged for the indexer/frontend .env files.
///
/// Env:
///   PROTOCOL_RECIPIENT   (address, defaults to broadcaster)
///   PROTOCOL_FEE_BPS     (uint, defaults to 500 = 5%)
///   REGISTRY_6551        (address, defaults to canonical; deployed locally if absent)
contract Deploy is Script {
    // Canonical, deterministic across EVM chains.
    address internal constant CANONICAL_6551 = 0x000000006551c19487814612e58FE06813775758;

    function run()
        external
        returns (
            address factory,
            address collectionImpl,
            address feeSplitter,
            address guard,
            address registry,
            address accountImpl
        )
    {
        address deployer = msg.sender;
        address protocolRecipient = vm.envOr("PROTOCOL_RECIPIENT", deployer);
        uint256 protocolFeeBps = vm.envOr("PROTOCOL_FEE_BPS", uint256(500));

        vm.startBroadcast();

        // 1. ERC-6551 registry: reuse canonical if present, else deploy local.
        registry = vm.envOr("REGISTRY_6551", CANONICAL_6551);
        if (registry.code.length == 0) {
            registry = address(new ERC6551Registry());
            console2.log("Deployed local ERC6551Registry:", registry);
        } else {
            console2.log("Using existing ERC6551 registry:", registry);
        }

        // 2. Fixed, factory-owned TBA implementation.
        accountImpl = address(new ERC6551Account());

        // 3. Cloneable collection implementation.
        collectionImpl = address(new LaunchpadERC721A());

        // 4. Pull-payment fee splitter.
        feeSplitter = address(new FeeSplitter(deployer, protocolRecipient, uint16(protocolFeeBps)));

        // 5. Factory (owns the fixed account impl; creators cannot override it).
        factory = address(new CollectionFactory(deployer, registry, collectionImpl, accountImpl, feeSplitter));

        // 6. Marketplace guard (drain-before-transfer defence).
        guard = address(new TBAGuard(registry, accountImpl, bytes32(0)));

        // 7-9. Coin market layer + one-click launcher + bonding-curve token
        //      launchpad. Scoped in a block to keep the stack shallow.
        _deployMarketLayer(factory, deployer, protocolRecipient);

        vm.stopBroadcast();

        console2.log("== Launchpad core deployed ==");
        console2.log("CollectionFactory :", factory);
        console2.log("LaunchpadERC721A  :", collectionImpl);
        console2.log("FeeSplitter       :", feeSplitter);
        console2.log("TBAGuard          :", guard);
        console2.log("AccountImpl(6551) :", accountImpl);
        console2.log("Registry(6551)    :", registry);
    }

    /// @dev Separate function so its many locals don't overflow run()'s stack.
    function _deployMarketLayer(address factory, address deployer, address protocolRecipient) internal {
        address coinImpl = address(new CollectionCoin());
        address sushiRouter = vm.envOr("SUSHI_ROUTER", address(0));
        address marketDeployer;
        if (sushiRouter != address(0)) marketDeployer = address(new SushiMarketDeployer(sushiRouter));

        address coinFactory = address(new CoinFactory(deployer, factory, coinImpl, marketDeployer));
        CollectionFactory(factory).setCoinFactory(coinFactory);
        address liquidityLauncher = address(new LiquidityLauncher(coinFactory));

        // Bonding-curve token launchpad (real Chainlink feed on live chains; mock locally).
        address ethUsdFeed = vm.envOr("ETH_USD_FEED", address(0));
        if (ethUsdFeed == address(0) || ethUsdFeed.code.length == 0) {
            ethUsdFeed = address(new MockAggregator(3000e8, 8));
        }
        address launchTokenImpl = address(new LaunchToken());
        BondingCurve bondingCurve = new BondingCurve(deployer, launchTokenImpl, ethUsdFeed, protocolRecipient);
        if (marketDeployer != address(0)) bondingCurve.setMarketDeployer(marketDeployer);

        console2.log("CoinFactory       :", coinFactory);
        console2.log("CollectionCoinImpl:", coinImpl);
        console2.log("SushiMarketDeploy :", marketDeployer);
        console2.log("SushiRouter       :", sushiRouter);
        console2.log("LiquidityLauncher :", liquidityLauncher);
        // Direct-to-DEX launcher (no bonding curve): fair-launch straight to a
        // SushiSwap pair. Logged inline to keep the stack shallow.
        console2.log(
            "TokenLauncher     :",
            address(
                new TokenLauncher(deployer, launchTokenImpl, ethUsdFeed, marketDeployer, protocolRecipient)
            )
        );
        console2.log("BondingCurve      :", address(bondingCurve));
        console2.log("LaunchTokenImpl   :", launchTokenImpl);
        console2.log("EthUsdFeed        :", ethUsdFeed);
    }
}
