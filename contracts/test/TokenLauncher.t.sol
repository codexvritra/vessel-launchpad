// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {TokenLauncher} from "../src/TokenLauncher.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {SushiMarketDeployer} from "../src/SushiMarketDeployer.sol";
import {MockAggregator, MockERC20} from "./mocks/Mocks.sol";
import {MockUniV2Factory, MockUniV2Router, MockUniV2Pair} from "./mocks/MockUniV2.sol";

/// @notice Direct-to-DEX fair launch (no bonding curve): launch seeds a live
///         SushiSwap pair immediately, LP is locked, and a 1% buy/sell tax routes
///         to the protocol wallet.
contract TokenLauncherTest is Test {
    TokenLauncher internal launcher;
    SushiMarketDeployer internal md;
    MockUniV2Factory internal uniF;
    MockUniV2Router internal router;
    MockERC20 internal weth;

    address internal owner = makeAddr("owner");
    address internal protocol = makeAddr("protocol");
    address internal creator = makeAddr("creator");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        weth = new MockERC20();
        uniF = new MockUniV2Factory();
        router = new MockUniV2Router(address(uniF), address(weth));
        uniF.setRouter(address(router));
        md = new SushiMarketDeployer(address(router));

        address tokenImpl = address(new LaunchToken());
        MockAggregator feed = new MockAggregator(3000e8, 8);
        launcher = new TokenLauncher(owner, tokenImpl, address(feed), address(md), protocol);
    }

    function _launch(uint256 liquidity) internal returns (address token, address pair) {
        uint256 fee = launcher.launchFeeWei();
        vm.deal(creator, fee + liquidity);
        vm.prank(creator);
        (token, pair) = launcher.launch{value: fee + liquidity}("Frog", "FROG");
    }

    function test_LaunchSeedsSushiPoolImmediately() public {
        uint256 protoBefore = protocol.balance;
        (address token, address pair) = _launch(1 ether);

        assertTrue(pair != address(0), "pair created at launch");
        assertEq(LaunchToken(token).balanceOf(pair), launcher.SUPPLY(), "full supply in the pool");
        assertEq(md.pairFor(token), pair);
        // Launch fee ($3 = 0.001 ETH) to protocol.
        assertEq(protocol.balance - protoBefore, 0.001 ether, "launch fee");
        // LP locked with the protocol/lock address.
        assertGt(MockUniV2Pair(pair).balanceOf(launcher.liquidityLock()), 0, "LP locked");
        assertTrue(launcher.isLaunchToken(token));
    }

    function test_LaunchWithoutLiquidityReverts() public {
        uint256 fee = launcher.launchFeeWei();
        vm.deal(creator, fee);
        vm.prank(creator);
        vm.expectRevert(TokenLauncher.NoLiquidity.selector);
        launcher.launch{value: fee}("X", "X");
    }

    function test_OnePercentTaxOnBuysAndSells() public {
        (address token, address pair) = _launch(1 ether);
        LaunchToken t = LaunchToken(token);

        // Simulate a BUY: tokens move from the pair to a buyer -> 1% to protocol.
        uint256 amount = 1_000_000e18;
        uint256 protoBefore = t.balanceOf(protocol);
        vm.prank(pair);
        t.transfer(alice, amount);
        assertEq(t.balanceOf(alice), (amount * 99) / 100, "buyer receives 99%");
        assertEq(t.balanceOf(protocol) - protoBefore, amount / 100, "1% buy tax to protocol");

        // Simulate a SELL: buyer sends tokens back to the pair -> 1% to protocol.
        uint256 sell = 500_000e18;
        protoBefore = t.balanceOf(protocol);
        uint256 pairBefore = t.balanceOf(pair);
        vm.prank(alice);
        t.transfer(pair, sell);
        assertEq(t.balanceOf(pair) - pairBefore, (sell * 99) / 100, "pair receives 99%");
        assertEq(t.balanceOf(protocol) - protoBefore, sell / 100, "1% sell tax to protocol");
    }

    function test_WalletToWalletIsNotTaxed() public {
        (address token, address pair) = _launch(1 ether);
        LaunchToken t = LaunchToken(token);

        vm.prank(pair);
        t.transfer(alice, 1_000e18); // buy (taxed)

        // alice -> bob (neither is the pair): no tax.
        uint256 protoBefore = t.balanceOf(protocol);
        uint256 send = 100e18;
        vm.prank(alice);
        t.transfer(bob, send);
        assertEq(t.balanceOf(bob), send, "no tax on wallet-to-wallet");
        assertEq(t.balanceOf(protocol), protoBefore, "protocol unchanged");
    }
}
