// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {ERC6551Registry} from "erc6551/ERC6551Registry.sol";
import {ERC6551Account} from "erc6551/examples/simple/ERC6551Account.sol";

import {CollectionFactory} from "../src/CollectionFactory.sol";
import {LaunchpadERC721A} from "../src/LaunchpadERC721A.sol";
import {FeeSplitter} from "../src/FeeSplitter.sol";
import {CollectionCoin} from "../src/CollectionCoin.sol";
import {CoinFactory} from "../src/CoinFactory.sol";
import {SushiMarketDeployer} from "../src/SushiMarketDeployer.sol";
import {LiquidityLauncher} from "../src/LiquidityLauncher.sol";
import {LaunchpadTypes} from "../src/LaunchpadTypes.sol";
import {MockERC20} from "../test/mocks/Mocks.sol";
import {MockUniV2Factory, MockUniV2Router} from "../test/mocks/MockUniV2.sol";

/// @notice End-to-end local demo of the FULL launchpad journey on one chain:
///   deploy stack (+ a mock SushiSwap router) -> create a collection with the coin
///   market auto-enabled -> mint (each token's 6551 wallet funded) -> one-click
///   provide liquidity (NFTs -> coins -> seeded SushiSwap pool). Asserts every step.
contract LocalDemo is Script {
    function run() external {
        address me = msg.sender;
        vm.startBroadcast();

        // --- platform ---
        ERC6551Registry registry = new ERC6551Registry();
        address accountImpl = address(new ERC6551Account());
        address collImpl = address(new LaunchpadERC721A());
        address feeSplitter = address(new FeeSplitter(me, me, 500));
        CollectionFactory factory =
            new CollectionFactory(me, address(registry), collImpl, accountImpl, feeSplitter);

        // --- mock SushiSwap (UniV2) ---
        MockERC20 weth = new MockERC20();
        MockUniV2Factory uniFactory = new MockUniV2Factory();
        MockUniV2Router router = new MockUniV2Router(address(uniFactory), address(weth));
        uniFactory.setRouter(address(router));
        SushiMarketDeployer marketDeployer = new SushiMarketDeployer(address(router));

        // --- coin market + one-click launcher, wired in ---
        address coinImpl = address(new CollectionCoin());
        CoinFactory coinFactory = new CoinFactory(me, address(factory), coinImpl, address(marketDeployer));
        factory.setCoinFactory(address(coinFactory));
        LiquidityLauncher launcher = new LiquidityLauncher(address(coinFactory));

        // --- 1) create a collection with the coin market auto-enabled ---
        LaunchpadTypes.MintPhase[] memory phases = new LaunchpadTypes.MintPhase[](1);
        phases[0] = LaunchpadTypes.MintPhase({
            merkleRoot: bytes32(0),
            price: 0.01 ether,
            endPrice: 0,
            startTime: uint64(block.timestamp),
            endTime: uint64(block.timestamp + 30 days),
            perWalletCap: 0,
            maxMintable: 0
        });
        LaunchpadTypes.CollectionConfig memory cfg = LaunchpadTypes.CollectionConfig({
            name: "Demo Vessels",
            symbol: "DEMO",
            maxSupply: 100,
            mintPrice: 0.01 ether,
            royaltyBps: 500,
            tbaFundingBps: 5000,
            backingAsset: address(0),
            mintPhases: phases
        });
        address collection = factory.createCollection(cfg, "", "", true);
        address coin = coinFactory.coinOf(collection);
        require(coin != address(0), "coin not auto-enabled");
        console2.log("Collection        :", collection);
        console2.log("Auto-enabled coin :", coin);

        // --- 2) mint 5; each token's 6551 account is funded ---
        LaunchpadERC721A col = LaunchpadERC721A(payable(collection));
        bytes32[] memory noProof;
        col.mint{value: 0.05 ether}(0, 5, noProof);
        address tba1 = col.accountOf(1);
        require(tba1.balance == 0.005 ether, "TBA not funded");
        console2.log("Minted 5; token#1 TBA funded (wei):", tba1.balance);

        // --- 3) one-click: NFTs -> coins -> seeded SushiSwap pool ---
        uint256[] memory ids = new uint256[](3);
        ids[0] = 1;
        ids[1] = 2;
        ids[2] = 3;
        col.setApprovalForAll(address(launcher), true);
        (address pair, uint256 liquidity) = launcher.launch{value: 1 ether}(collection, ids, 0, 0);
        require(pair != address(0), "pool not created");
        require(liquidity > 0, "no LP");
        console2.log("SushiSwap pair    :", pair);
        console2.log("LP minted         :", liquidity);
        console2.log("Coins in pool     :", CollectionCoin(coin).balanceOf(pair));

        vm.stopBroadcast();
        console2.log("== FULL JOURNEY OK: create -> mint(+TBA) -> coins -> SushiSwap pool ==");
    }
}
