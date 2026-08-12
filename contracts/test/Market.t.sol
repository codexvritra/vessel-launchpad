// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Base} from "./Base.t.sol";
import {LaunchpadERC721A} from "../src/LaunchpadERC721A.sol";
import {CollectionCoin} from "../src/CollectionCoin.sol";
import {CoinFactory} from "../src/CoinFactory.sol";
import {SushiMarketDeployer} from "../src/SushiMarketDeployer.sol";
import {LiquidityLauncher} from "../src/LiquidityLauncher.sol";
import {LaunchpadTypes} from "../src/LaunchpadTypes.sol";
import {MockERC20} from "./mocks/Mocks.sol";
import {MockUniV2Factory, MockUniV2Router, MockUniV2Pair} from "./mocks/MockUniV2.sol";

/// @notice Zora-style coin + SushiSwap market: enable a fungible vault coin for a
///         collection, deposit NFTs for coins, and seed a coin/ETH pool through the
///         Sushi (UniswapV2) market deployer. Uses a mock router.
contract MarketTest is Base {
    CoinFactory internal coinFactory;
    SushiMarketDeployer internal marketDeployer;
    LiquidityLauncher internal launcher;
    MockUniV2Factory internal uniFactory;
    MockUniV2Router internal router;
    MockERC20 internal weth;
    LaunchpadERC721A internal col;

    function setUp() public {
        _deployStack();

        // Sushi-compatible mock AMM.
        weth = new MockERC20();
        uniFactory = new MockUniV2Factory();
        router = new MockUniV2Router(address(uniFactory), address(weth));
        uniFactory.setRouter(address(router));
        marketDeployer = new SushiMarketDeployer(address(router));

        // Coin factory wired to the launchpad registry + Sushi deployer.
        address coinImpl = address(new CollectionCoin());
        coinFactory = new CoinFactory(owner, address(factory), coinImpl, address(marketDeployer));

        // Wire the coin factory into the collection factory for auto-enable.
        vm.prank(owner);
        factory.setCoinFactory(address(coinFactory));

        launcher = new LiquidityLauncher(address(coinFactory));

        // A collection with 5 tokens minted to alice.
        col = _create(_defaultConfig(0.01 ether, 0)); // no TBA funding; focus on the coin
        vm.deal(alice, 0.05 ether);
        vm.prank(alice);
        bytes32[] memory none;
        col.mint{value: 0.05 ether}(0, 5, none);
        assertEq(col.balanceOf(alice), 5);
    }

    function _enableAndDeposit(uint256[] memory ids) internal returns (CollectionCoin coin) {
        coin = CollectionCoin(coinFactory.enableMarket(address(col)));
        vm.startPrank(alice);
        col.setApprovalForAll(address(coin), true);
        coin.deposit(ids);
        vm.stopPrank();
    }

    function test_EnableMarketDeploysBackedCoin() public {
        uint256[] memory ids = new uint256[](3);
        ids[0] = 1;
        ids[1] = 2;
        ids[2] = 3;
        CollectionCoin coin = _enableAndDeposit(ids);

        assertEq(coin.collection(), address(col));
        assertEq(coin.balanceOf(alice), 3e18, "3 NFTs => 3 coins");
        assertEq(coin.totalSupply(), 3e18);
        assertEq(coin.heldCount(), 3, "vault holds the NFTs");
        assertEq(col.ownerOf(1), address(coin), "NFT custodied by the coin vault");

        // Name/symbol derived from the collection.
        assertEq(coin.symbol(), "cFLAG");
    }

    function test_SeedSushiMarket() public {
        uint256[] memory ids = new uint256[](3);
        ids[0] = 1;
        ids[1] = 2;
        ids[2] = 3;
        CollectionCoin coin = _enableAndDeposit(ids);

        // alice seeds 2 coins + 1 ETH into the Sushi pool.
        vm.deal(alice, 1 ether);
        vm.startPrank(alice);
        coin.approve(address(marketDeployer), 2e18);
        (address pair, uint256 liquidity) =
            marketDeployer.createMarket{value: 1 ether}(address(coin), 2e18, 0, 0, alice);
        vm.stopPrank();

        assertTrue(pair != address(0), "pair created");
        assertEq(marketDeployer.pairFor(address(coin)), pair);
        assertGt(liquidity, 0, "LP minted");
        assertEq(MockUniV2Pair(pair).balanceOf(alice), liquidity, "LP to seeder");
        // 2 coins moved into the pair; alice keeps 1.
        assertEq(coin.balanceOf(alice), 1e18);
        assertEq(coin.balanceOf(pair), 2e18);
    }

    function test_RedeemReturnsNFT() public {
        uint256[] memory ids = new uint256[](2);
        ids[0] = 4;
        ids[1] = 5;
        CollectionCoin coin = _enableAndDeposit(ids);

        uint256[] memory back = new uint256[](1);
        back[0] = 4;
        vm.prank(alice);
        coin.redeem(back);

        assertEq(col.ownerOf(4), alice, "NFT redeemed to holder");
        assertEq(coin.balanceOf(alice), 1e18, "one coin burned");
        assertEq(coin.heldCount(), 1);
    }

    function test_RedeemUnheldReverts() public {
        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;
        CollectionCoin coin = _enableAndDeposit(ids);

        uint256[] memory back = new uint256[](1);
        back[0] = 2; // not in the vault
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CollectionCoin.NotHeld.selector, uint256(2)));
        coin.redeem(back);
    }

    function test_EnableMarketIsPermissionlessButOnce() public {
        // A non-creator (bob) can enable the market — it's neutral infra.
        vm.prank(bob);
        address coin = coinFactory.enableMarket(address(col));
        assertEq(coinFactory.coinOf(address(col)), coin);

        // But only once.
        vm.expectRevert(CoinFactory.AlreadyEnabled.selector);
        coinFactory.enableMarket(address(col));
    }

    function test_EnableMarketRejectsNonCollection() public {
        vm.expectRevert(CoinFactory.NotACollection.selector);
        coinFactory.enableMarket(address(0xdead));
    }

    function test_AutoEnableAtCreation() public {
        // Creating a collection with the opt-in flag deploys the coin in the same tx.
        LaunchpadTypes.CollectionConfig memory c = _defaultConfig(0.01 ether, 0);
        vm.prank(creator);
        address newCol = factory.createCollection(c, "", "", true);

        address coin = coinFactory.coinOf(newCol);
        assertTrue(coin != address(0), "coin not auto-enabled");
        assertEq(CollectionCoin(coin).collection(), newCol);
    }

    function test_OneClickLaunchLiquidity() public {
        CollectionCoin coin = CollectionCoin(coinFactory.enableMarket(address(col)));

        uint256[] memory ids = new uint256[](2);
        ids[0] = 1;
        ids[1] = 2;

        vm.deal(alice, 1 ether);
        vm.startPrank(alice);
        col.setApprovalForAll(address(launcher), true); // one approval
        (address pair, uint256 liquidity) = launcher.launch{value: 1 ether}(address(col), ids, 0, 0);
        vm.stopPrank();

        assertTrue(pair != address(0), "pair created in one tx");
        assertGt(liquidity, 0, "LP minted to provider");
        assertEq(coin.heldCount(), 2, "NFTs vaulted");
        assertEq(coin.balanceOf(pair), 2e18, "coins seeded into pool");
        assertEq(coin.balanceOf(alice), 0, "no leftover coins for provider");
        assertEq(col.ownerOf(1), address(coin), "NFT custodied by vault");
    }

    function test_AutoEnableSkippedWhenNotOpted() public {
        LaunchpadTypes.CollectionConfig memory c = _defaultConfig(0.01 ether, 0);
        vm.prank(creator);
        address newCol = factory.createCollection(c, "", "", false);
        assertEq(coinFactory.coinOf(newCol), address(0), "should not auto-enable");
    }
}
