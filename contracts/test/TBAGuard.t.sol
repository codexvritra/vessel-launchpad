// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Base} from "./Base.t.sol";
import {TBAGuard} from "../src/TBAGuard.sol";
import {LaunchpadERC721A} from "../src/LaunchpadERC721A.sol";
import {LaunchpadTypes} from "../src/LaunchpadTypes.sol";
import {ERC6551Account} from "erc6551/examples/simple/ERC6551Account.sol";
import {MockERC20, MockSwapper} from "./mocks/Mocks.sol";

interface IExecute {
    function execute(address to, uint256 value, bytes calldata data, uint8 operation)
        external
        payable
        returns (bytes memory);
}

/// @notice Drain-before-transfer attack and defence for the token-bound-account
///         marketplace guard. `alice` is the seller, `bob` the buyer.
contract TBAGuardTest is Base {
    TBAGuard internal guard;
    LaunchpadERC721A internal col;
    address[] internal noAssets; // ETH-only listings

    function setUp() public {
        // Use the reference 6551 account (supports execute) as the fixed impl.
        _deployStack(address(new ERC6551Account()));
        guard = new TBAGuard(address(registry), accountImpl, factory.accountSalt());

        col = _create(_defaultConfig(0.1 ether, 5000)); // 50% funding => 0.05 ETH per TBA

        // alice mints token #1; its TBA is funded with 0.05 ETH.
        vm.deal(alice, 0.1 ether);
        vm.prank(alice);
        bytes32[] memory none;
        col.mint{value: 0.1 ether}(0, 1, none);
        assertEq(col.ownerOf(1), alice);
        assertEq(col.accountOf(1).balance, 0.05 ether);
    }

    function _list(uint256 price) internal returns (uint256 id) {
        vm.startPrank(alice);
        col.setApprovalForAll(address(guard), true);
        id = guard.list(address(col), 1, price, uint64(block.timestamp + 1 days), noAssets);
        vm.stopPrank();
    }

    function _drainEth(address who, uint256 amount) internal {
        address tba = col.accountOf(1);
        vm.prank(who);
        IExecute(payable(tba)).execute(who, amount, "", 0);
    }

    // ------------------------------------------------------------------ //
    //                         Defence (happy path)                       //
    // ------------------------------------------------------------------ //

    function test_SettlesWhenTBANotDrained() public {
        uint256 price = 1 ether;
        uint256 id = _list(price);

        uint256[] memory noBalances;
        vm.deal(bob, price);
        vm.prank(bob);
        guard.settle{value: price}(id, noAssets, noBalances);

        // Buyer now owns the token AND its still-funded wallet.
        assertEq(col.ownerOf(1), bob);
        assertEq(col.accountOf(1).balance, 0.05 ether, "TBA must still be funded");

        // Seller proceeds are pull-only.
        assertEq(guard.proceeds(alice), price);
        uint256 before = alice.balance;
        vm.prank(alice);
        guard.withdraw();
        assertEq(alice.balance, before + price);
    }

    function test_DepositsAfterListingStillSettle() public {
        uint256 price = 1 ether;
        uint256 id = _list(price);

        // Someone tops up the TBA after listing: invariant is >=, so this is fine.
        vm.deal(address(this), 1 ether);
        (bool ok,) = col.accountOf(1).call{value: 1 ether}("");
        assertTrue(ok);

        uint256[] memory noBalances;
        vm.deal(bob, price);
        vm.prank(bob);
        guard.settle{value: price}(id, noAssets, noBalances);
        assertEq(col.ownerOf(1), bob);
    }

    // ------------------------------------------------------------------ //
    //                            Attack paths                            //
    // ------------------------------------------------------------------ //

    function test_DrainAfterListReverts_ETH() public {
        uint256 price = 1 ether;
        uint256 id = _list(price);

        // Seller drains the TBA after listing.
        _drainEth(alice, 0.05 ether);
        assertEq(col.accountOf(1).balance, 0);

        uint256[] memory noBalances;
        vm.deal(bob, price);
        uint256 bobBefore = bob.balance;
        vm.prank(bob);
        vm.expectRevert(TBAGuard.BalancesChanged.selector);
        guard.settle{value: price}(id, noAssets, noBalances);

        // Buyer lost nothing; seller still holds the (now-empty) token.
        assertEq(bob.balance, bobBefore, "buyer funds must be safe");
        assertEq(col.ownerOf(1), alice);
    }

    function test_PartialDrainAlsoReverts() public {
        uint256 price = 1 ether;
        uint256 id = _list(price);
        _drainEth(alice, 0.01 ether); // even a partial drain breaks the invariant

        uint256[] memory noBalances;
        vm.deal(bob, price);
        vm.prank(bob);
        vm.expectRevert(TBAGuard.BalancesChanged.selector);
        guard.settle{value: price}(id, noAssets, noBalances);
    }

    function test_ERC20DrainDetected() public {
        // Fresh collection whose TBAs hold an ERC-20 backing asset.
        MockERC20 equity = new MockERC20();
        MockSwapper mockSwap = new MockSwapper(equity, 1);
        vm.prank(owner);
        factory.setSwapper(address(mockSwap));
        LaunchpadTypes.CollectionConfig memory c = _defaultConfig(0.1 ether, 5000);
        c.backingAsset = address(equity);
        LaunchpadERC721A ecol = _create(c);

        vm.deal(alice, 0.1 ether);
        vm.prank(alice);
        bytes32[] memory none;
        ecol.mint{value: 0.1 ether}(0, 1, none);
        address tba = ecol.accountOf(1);
        uint256 held = equity.balanceOf(tba);
        assertGt(held, 0);

        // List declaring the equity as a guaranteed asset.
        address[] memory assets = new address[](1);
        assets[0] = address(equity);
        uint256[] memory balances = new uint256[](1);
        balances[0] = held;

        vm.startPrank(alice);
        ecol.setApprovalForAll(address(guard), true);
        uint256 id = guard.list(address(ecol), 1, 1 ether, uint64(block.timestamp + 1 days), assets);
        // Drain the ERC-20 out of the TBA.
        bytes memory xfer = abi.encodeWithSelector(equity.transfer.selector, alice, held);
        IExecute(payable(tba)).execute(address(equity), 0, xfer, 0);
        vm.stopPrank();

        vm.deal(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert(TBAGuard.BalancesChanged.selector);
        guard.settle{value: 1 ether}(id, assets, balances);
    }

    // ------------------------------------------------------------------ //
    //                          Guard bookkeeping                         //
    // ------------------------------------------------------------------ //

    function test_CommitMismatchReverts() public {
        uint256 id = _list(1 ether);
        // Supply a bogus asset set that doesn't match the on-chain commitment.
        address[] memory assets = new address[](1);
        assets[0] = address(0xdead);
        uint256[] memory balances = new uint256[](1);
        balances[0] = 1;
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert(TBAGuard.CommitMismatch.selector);
        guard.settle{value: 1 ether}(id, assets, balances);
    }

    function test_OwnershipChangedReverts() public {
        uint256 id = _list(1 ether);
        // Seller moves the NFT elsewhere out of band.
        vm.prank(alice);
        col.transferFrom(alice, makeAddr("carol"), 1);

        uint256[] memory noBalances;
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert(TBAGuard.OwnershipChanged.selector);
        guard.settle{value: 1 ether}(id, noAssets, noBalances);
    }

    function test_ExpiredListingReverts() public {
        vm.startPrank(alice);
        col.setApprovalForAll(address(guard), true);
        uint256 id = guard.list(address(col), 1, 1 ether, uint64(block.timestamp + 100), noAssets);
        vm.stopPrank();

        vm.warp(block.timestamp + 101);
        uint256[] memory noBalances;
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert(TBAGuard.ListingExpired.selector);
        guard.settle{value: 1 ether}(id, noAssets, noBalances);
    }

    function test_CancelPreventsSettle() public {
        uint256 id = _list(1 ether);
        vm.prank(alice);
        guard.cancel(id);
        uint256[] memory noBalances;
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert(TBAGuard.InactiveListing.selector);
        guard.settle{value: 1 ether}(id, noAssets, noBalances);
    }

    function test_IsFillableReflectsDrain() public {
        uint256 id = _list(1 ether);
        uint256[] memory noBalances;
        assertTrue(guard.isFillable(id, noAssets, noBalances));
        _drainEth(alice, 0.05 ether);
        assertFalse(guard.isFillable(id, noAssets, noBalances));
    }
}
