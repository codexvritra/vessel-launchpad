// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {BondingCurveNFT} from "../src/BondingCurveNFT.sol";
import {BondingCurveNFTFactory} from "../src/BondingCurveNFTFactory.sol";
import {MockAggregator} from "./mocks/Mocks.sol";

contract BondingCurveNFTTest is Test {
    BondingCurveNFTFactory internal factory;
    BondingCurveNFT internal impl;
    MockAggregator internal feed;

    address internal owner = makeAddr("owner");
    address internal protocol = makeAddr("protocol");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    uint256 internal basePrice = 0.01 ether;
    uint256 internal slope = 0.001 ether;

    function setUp() public {
        impl = new BondingCurveNFT();
        feed = new MockAggregator(3000e8, 8); // $3000 / ETH
        factory = new BondingCurveNFTFactory(owner, address(impl), address(feed), protocol);
    }

    function _buyFee(BondingCurveNFT c, uint256 q) internal view returns (uint256) {
        return c.feeOn(c.buyCost(q));
    }

    function _sellFee(BondingCurveNFT c, uint256 q) internal view returns (uint256) {
        return c.feeOn(c.sellProceeds(q));
    }

    function _ids(uint256 n) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](n);
        for (uint256 i; i < n; ++i) ids[i] = i + 1;
    }

    /// @dev Buy as `who`. IMPORTANT: the price is read BEFORE vm.prank, because an
    ///      external call inside the {value:} expression would consume the prank.
    function _buy(BondingCurveNFT c, address who, uint256 q) internal {
        uint256 total = c.buyQuote(q);
        vm.deal(who, who.balance + total);
        vm.prank(who);
        c.buy{value: total}(q);
    }

    function _launch() internal returns (BondingCurveNFT c) {
        uint256 fee = factory.launchFeeWei();
        vm.deal(alice, alice.balance + fee);
        vm.prank(alice);
        address col = factory.launch{value: fee}("Curve", "CRV", basePrice, slope, 0, "ipfs://x");
        c = BondingCurveNFT(payable(col));
    }

    function test_LaunchChargesThreeDollarFee() public {
        assertEq(factory.launchFeeWei(), 0.001 ether); // $3 / $3000
        uint256 before = protocol.balance;
        _launch();
        assertEq(protocol.balance - before, 0.001 ether, "fee not paid");
        assertEq(factory.collectionsCount(), 1);
    }

    function test_BuyRaisesSupplyAndPrice() public {
        BondingCurveNFT c = _launch();
        uint256 total = c.buyQuote(1);
        assertEq(total, basePrice + (basePrice * 100) / 10_000, "quote wrong");

        _buy(c, alice, 1);
        assertEq(c.totalSupply(), 1);
        assertEq(c.balanceOf(alice), 1);
        assertGt(c.buyQuote(1), total, "price should rise");
    }

    function test_EarlyBuyerProfits() public {
        BondingCurveNFT c = _launch();

        uint256 alicePaid = c.buyQuote(1);
        _buy(c, alice, 1); // alice owns token id 1

        _buy(c, bob, 10); // bob pushes supply/price up
        assertEq(c.totalSupply(), 11);

        uint256 net = c.sellQuote(1);
        uint256 balBefore = alice.balance;
        vm.prank(alice);
        c.sell(_ids(1));

        assertEq(alice.balance - balBefore, net, "payout != quote");
        assertGt(alice.balance - balBefore, alicePaid, "early buyer should profit");
    }

    function test_ReserveIsSolvent_EveryoneCanSellOut() public {
        BondingCurveNFT c = _launch();
        _buy(c, bob, 20);

        assertEq(c.reserve(), c.sellProceeds(20), "reserve != sum of prices");

        vm.prank(bob);
        c.sell(_ids(20));
        assertEq(c.totalSupply(), 0, "not fully sold");
        assertEq(c.reserve(), 0, "reserve should be empty (no dust)");
    }

    function test_SellRequiresOwnership() public {
        BondingCurveNFT c = _launch();
        _buy(c, bob, 1); // bob owns token 1

        vm.prank(alice);
        vm.expectRevert(BondingCurveNFT.NotYourToken.selector);
        c.sell(_ids(1));
    }

    function test_ProtocolEarnsTradeFees() public {
        BondingCurveNFT c = _launch();

        uint256 start = protocol.balance;
        uint256 buyFee = _buyFee(c, 5);
        _buy(c, bob, 5);
        assertEq(protocol.balance - start, buyFee, "buy fee not collected");

        uint256 mid = protocol.balance;
        uint256 sellFee = _sellFee(c, 5);
        vm.prank(bob);
        c.sell(_ids(5));
        assertEq(protocol.balance - mid, sellFee, "sell fee not collected");
    }
}
