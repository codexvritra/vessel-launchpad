// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {FeeSplitter} from "../src/FeeSplitter.sol";

/// @dev A beneficiary that reverts on ETH receipt — used to prove pull-payment
///      isolation: one griefing claimant cannot block the whole system.
contract RevertingReceiver {
    FeeSplitter public splitter;

    constructor(FeeSplitter s) {
        splitter = s;
    }

    function claim() external {
        splitter.claim();
    }

    receive() external payable {
        revert("no ETH for you");
    }
}

contract FeeSplitterTest is Test {
    FeeSplitter internal splitter;
    address internal owner = makeAddr("owner");
    address internal protocol = makeAddr("protocol");
    address internal creator = makeAddr("creator");

    function setUp() public {
        splitter = new FeeSplitter(owner, protocol, 500); // 5%
    }

    function test_MintProceedsSplitExactly() public {
        splitter.depositMintProceeds{value: 1 ether}(address(0xC0), creator);
        assertEq(splitter.balanceOf(protocol), 0.05 ether);
        assertEq(splitter.balanceOf(creator), 0.95 ether);
        assertEq(address(splitter).balance, 1 ether);
    }

    function test_DepositSplitsMustSumToValue() public {
        address[] memory accts = new address[](2);
        accts[0] = creator;
        accts[1] = protocol;
        uint256[] memory amts = new uint256[](2);
        amts[0] = 0.6 ether;
        amts[1] = 0.4 ether;
        splitter.depositSplits{value: 1 ether}(accts, amts);
        assertEq(splitter.balanceOf(creator), 0.6 ether);
        assertEq(splitter.balanceOf(protocol), 0.4 ether);
    }

    function test_DepositSplitsSumMismatchReverts() public {
        address[] memory accts = new address[](1);
        accts[0] = creator;
        uint256[] memory amts = new uint256[](1);
        amts[0] = 0.9 ether; // != msg.value
        vm.expectRevert(FeeSplitter.SumMismatch.selector);
        splitter.depositSplits{value: 1 ether}(accts, amts);
    }

    function testFuzz_ConservationAcrossDeposits(uint96 a, uint96 b) public {
        vm.assume(uint256(a) + b > 0);
        vm.deal(address(this), uint256(a) + uint256(b)); // ensure the depositor can fund both
        splitter.depositMintProceeds{value: a}(address(0xC0), creator);
        splitter.depositMintProceeds{value: b}(address(0xC0), creator);
        // Every wei received is attributed to exactly protocol + creator.
        assertEq(splitter.balanceOf(protocol) + splitter.balanceOf(creator), address(splitter).balance);
    }

    function test_PullPaymentIsolatesGriefer() public {
        RevertingReceiver bad = new RevertingReceiver(splitter);
        // Credit both the griefer and the creator.
        address[] memory accts = new address[](2);
        accts[0] = address(bad);
        accts[1] = creator;
        uint256[] memory amts = new uint256[](2);
        amts[0] = 0.5 ether;
        amts[1] = 0.5 ether;
        splitter.depositSplits{value: 1 ether}(accts, amts);

        // The griefer's own claim reverts (they can only hurt themselves)...
        vm.expectRevert();
        bad.claim();

        // ...but the honest creator claims freely.
        uint256 before = creator.balance;
        vm.prank(creator);
        splitter.claim();
        assertEq(creator.balance, before + 0.5 ether);
    }

    function test_ClaimZeroReverts() public {
        vm.prank(creator);
        vm.expectRevert(FeeSplitter.NothingToClaim.selector);
        splitter.claim();
    }
}
