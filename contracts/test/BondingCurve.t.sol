// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {BondingCurve} from "../src/BondingCurve.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {SushiMarketDeployer} from "../src/SushiMarketDeployer.sol";
import {MockAggregator, MockERC20} from "./mocks/Mocks.sol";
import {MockUniV2Factory, MockUniV2Router} from "./mocks/MockUniV2.sol";

/// @notice Bonding-curve token launchpad: virtual liquidity, permissionless
///         buy/sell, 1% fee to the protocol wallet, $3 launch fee, graduation.
contract BondingCurveTest is Test {
    BondingCurve internal curve;
    MockAggregator internal feed;

    address internal owner = makeAddr("owner");
    address internal protocol = makeAddr("protocol");
    address internal creator = makeAddr("creator");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        address tokenImpl = address(new LaunchToken());
        feed = new MockAggregator(3000e8, 8); // ETH = $3000
        curve = new BondingCurve(owner, tokenImpl, address(feed), protocol);
    }

    function _launch() internal returns (address token) {
        uint256 fee = curve.launchFeeWei();
        vm.deal(creator, fee);
        vm.prank(creator);
        token = curve.launch{value: fee}("Frog", "FROG");
    }

    function test_LaunchFeeIsThreeDollars() public {
        // $3 at $3000/ETH = 0.001 ETH.
        assertEq(curve.launchFeeWei(), 0.001 ether);

        uint256 before = protocol.balance;
        address token = _launch();
        assertEq(protocol.balance - before, 0.001 ether, "launch fee to protocol");
        assertEq(LaunchToken(token).totalSupply(), curve.SUPPLY());
        assertEq(LaunchToken(token).balanceOf(address(curve)), curve.SUPPLY(), "supply on curve");
    }

    function test_LaunchUnderfundedReverts() public {
        vm.deal(creator, 0.0001 ether);
        vm.prank(creator);
        vm.expectRevert(BondingCurve.InsufficientLaunchFee.selector);
        curve.launch{value: 0.0001 ether}("X", "X");
    }

    function test_BuyTakesOnePercentFeeAndMovesPrice() public {
        address token = _launch();
        uint256 p0 = curve.priceX18(token);

        uint256 protoBefore = protocol.balance;
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        uint256 out = curve.buy{value: 1 ether}(token, 0);

        assertGt(out, 0, "got tokens");
        assertEq(LaunchToken(token).balanceOf(alice), out);
        // 1% of 1 ETH = 0.01 ETH fee to protocol.
        assertEq(protocol.balance - protoBefore, 0.01 ether, "1% buy fee");
        assertGt(curve.priceX18(token), p0, "price rose after buy");
    }

    function test_SellReturnsEthMinusFee() public {
        address token = _launch();
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        uint256 bought = curve.buy{value: 1 ether}(token, 0);

        uint256 protoBefore = protocol.balance;
        uint256 aliceBefore = alice.balance;
        vm.startPrank(alice);
        LaunchToken(token).approve(address(curve), bought);
        uint256 ethOut = curve.sell(token, bought, 0);
        vm.stopPrank();

        assertGt(ethOut, 0, "got eth back");
        assertEq(alice.balance - aliceBefore, ethOut);
        assertGt(protocol.balance - protoBefore, 0, "sell fee to protocol");
        // Round-trip: seller ends with less than 1 ETH (paid ~2% in fees + curve).
        assertLt(ethOut, 1 ether);
    }

    function test_BuyIsPermissionless() public {
        address token = _launch();
        // A random address that isn't creator/owner can buy.
        vm.deal(bob, 0.5 ether);
        vm.prank(bob);
        uint256 out = curve.buy{value: 0.5 ether}(token, 0);
        assertGt(out, 0);
        assertEq(LaunchToken(token).balanceOf(bob), out);
    }

    function test_InvariantHoldsAcrossTrades() public {
        address token = _launch();
        (,,, uint256 v, uint256 r, uint256 tr, uint256 k) = curve.curves(token);
        assertEq((v + r) * tr >= k, true);

        vm.deal(alice, 3 ether);
        vm.startPrank(alice);
        uint256 b1 = curve.buy{value: 2 ether}(token, 0);
        (,,, v, r, tr, k) = curve.curves(token);
        assertGe((v + r) * tr, k, "invariant after buy");

        LaunchToken(token).approve(address(curve), b1);
        curve.sell(token, b1 / 2, 0);
        (,,, v, r, tr, k) = curve.curves(token);
        assertGe((v + r) * tr, k, "invariant after sell");
        vm.stopPrank();
    }

    function test_GraduatesToSushiAtThreshold() public {
        // Wire a mock SushiSwap + a low graduation threshold.
        MockERC20 weth = new MockERC20();
        MockUniV2Factory uniF = new MockUniV2Factory();
        MockUniV2Router router = new MockUniV2Router(address(uniF), address(weth));
        uniF.setRouter(address(router));
        SushiMarketDeployer md = new SushiMarketDeployer(address(router));

        vm.startPrank(owner);
        curve.setMarketDeployer(address(md));
        curve.setCurveParams(3e18, 1 ether, 1 ether); // graduate at 1 ETH raised
        vm.stopPrank();

        address token = _launch();

        vm.deal(alice, 5 ether);
        vm.prank(alice);
        curve.buy{value: 3 ether}(token, 0); // crosses 1 ETH real -> graduate

        (, bool graduated,,,,,) = curve.curves(token);
        assertTrue(graduated, "should have graduated");
        assertTrue(md.pairFor(token) != address(0), "sushi pair created");

        // Trading on the curve is closed post-graduation.
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert(BondingCurve.Graduated.selector);
        curve.buy{value: 1 ether}(token, 0);
    }
}
