// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {SnipeTax} from "../src/libraries/SnipeTax.sol";
import {RewardSplit} from "../src/libraries/RewardSplit.sol";
import {DutchAuction} from "../src/libraries/DutchAuction.sol";

contract DutchAuctionTest is Test {
    uint256 constant START = 1 ether;
    uint256 constant FLOOR = 0.1 ether;
    uint64 constant T0 = 1_000_000;
    uint64 constant T1 = 1_000_100; // 100s auction

    function _p(uint256 nowTime) internal pure returns (uint256) {
        return DutchAuction.priceAt(START, FLOOR, T0, T1, nowTime);
    }

    function test_StartIsCeiling() public pure {
        assertEq(_p(T0), START);
        assertEq(_p(T0 - 10), START); // before start
    }

    function test_EndIsFloor() public pure {
        assertEq(_p(T1), FLOOR);
        assertEq(_p(T1 + 500), FLOOR); // after end
    }

    function test_MidpointIsHalfway() public pure {
        // Halfway through, price is halfway between start and floor.
        assertEq(_p(T0 + 50), START - ((START - FLOOR) * 50) / 100);
    }

    function test_MonotonicNonIncreasing() public pure {
        uint256 prev = type(uint256).max;
        for (uint256 t; t <= 100; t += 5) {
            uint256 p = _p(T0 + t);
            assertLe(p, prev);
            assertGe(p, FLOOR);
            assertLe(p, START);
            prev = p;
        }
    }

    function test_DefensiveClamps() public pure {
        assertEq(DutchAuction.priceAt(START, START, T0, T1, T0 + 50), START); // floor==start
        assertEq(DutchAuction.priceAt(START, FLOOR, T0, T0, T0 + 50), START); // zero window
        assertEq(DutchAuction.priceAt(START, FLOOR, T1, T0, T0 + 50), START); // end<=start
    }

    function testFuzz_WithinBounds(uint32 dt) public pure {
        uint256 p = _p(T0 + uint256(dt));
        assertGe(p, FLOOR);
        assertLe(p, START);
    }
}

contract SnipeTaxTest is Test {
    uint256 constant BASE = 10_000; // 1% in pips
    uint256 constant MAXF = 990_000; // 99% in pips
    uint256 constant WINDOW = 10; // 10 seconds
    uint256 constant INIT = 1_000_000; // arbitrary init timestamp

    function _fee(uint256 nowTs) internal pure returns (uint256) {
        return SnipeTax.feePips(INIT, nowTs, BASE, MAXF, WINDOW);
    }

    // --- Boundary conditions required by the spec ---

    function test_Block0_IsMaxFee() public pure {
        assertEq(SnipeTax.feePips(INIT, INIT, BASE, MAXF, WINDOW), MAXF);
    }

    function test_Block1_JustAfterInit_DecaysFromMax() public pure {
        // 1 second after init: fee has stepped down by exactly (spread * 1 / 10).
        uint256 expected = MAXF - ((MAXF - BASE) * 1) / WINDOW;
        assertEq(SnipeTax.feePips(INIT, INIT + 1, BASE, MAXF, WINDOW), expected);
        assertLt(expected, MAXF);
    }

    function test_Exactly10s_IsBaseFee() public pure {
        assertEq(SnipeTax.feePips(INIT, INIT + WINDOW, BASE, MAXF, WINDOW), BASE);
    }

    function test_After10s_StaysBaseFee() public pure {
        assertEq(SnipeTax.feePips(INIT, INIT + WINDOW + 1, BASE, MAXF, WINDOW), BASE);
        assertEq(SnipeTax.feePips(INIT, INIT + 10_000, BASE, MAXF, WINDOW), BASE);
    }

    function test_Midpoint_IsHalfway() public pure {
        // At 5s the fee should be roughly the midpoint of [base, max].
        uint256 f = SnipeTax.feePips(INIT, INIT + 5, BASE, MAXF, WINDOW);
        assertEq(f, MAXF - ((MAXF - BASE) * 5) / WINDOW);
    }

    // --- Curve properties ---

    function test_MonotonicNonIncreasing() public pure {
        uint256 prev = type(uint256).max;
        for (uint256 t; t <= WINDOW + 2; ++t) {
            uint256 f = SnipeTax.feePips(INIT, INIT + t, BASE, MAXF, WINDOW);
            assertLe(f, prev, "fee must not increase over time");
            assertGe(f, BASE, "fee never below base");
            assertLe(f, MAXF, "fee never above max");
            prev = f;
        }
    }

    function test_DefensiveClamps() public pure {
        // Degenerate configs must not revert on the swap hot path.
        assertEq(SnipeTax.feePips(INIT, INIT + 3, BASE, BASE, WINDOW), BASE); // max == base
        assertEq(SnipeTax.feePips(INIT, INIT + 3, BASE, MAXF, 0), BASE); // zero window
        assertEq(SnipeTax.feePips(INIT, INIT - 5, BASE, MAXF, WINDOW), MAXF); // now < init
    }

    function testFuzz_AlwaysWithinBounds(uint32 elapsed) public pure {
        uint256 f = SnipeTax.feePips(INIT, INIT + uint256(elapsed), BASE, MAXF, WINDOW);
        assertGe(f, BASE);
        assertLe(f, MAXF);
    }
}

contract RewardSplitTest is Test {
    using RewardSplit for RewardSplit.SplitConfig;

    function _cfg() internal pure returns (RewardSplit.SplitConfig memory) {
        // creator 40% | tradeRef 10% | createRef 10% | protocol 10% | lock 20% | LP 10%
        return RewardSplit.SplitConfig({
            creatorBps: 4000,
            tradeReferrerBps: 1000,
            createReferrerBps: 1000,
            protocolBps: 1000,
            lockBps: 2000
        });
    }

    function test_ConservationWithBothReferrers() public pure {
        RewardSplit.SplitConfig memory c = _cfg();
        RewardSplit.SplitResult memory r = RewardSplit.split(1 ether, c, address(0xA11CE), address(0xB0B));
        uint256 sum = r.creator + r.tradeReferrer + r.createReferrer + r.protocol + r.lpLocked + r.lpReward;
        assertEq(sum, 1 ether, "splits must sum to fee");
        assertEq(r.creator, 0.4 ether);
        assertEq(r.tradeReferrer, 0.1 ether);
        assertEq(r.createReferrer, 0.1 ether);
        assertEq(r.protocol, 0.1 ether);
        assertEq(r.lpLocked, 0.2 ether);
        assertEq(r.lpReward, 0.1 ether);
    }

    function test_MissingReferrersRedirectToLockedLiquidity() public pure {
        RewardSplit.SplitConfig memory c = _cfg();
        RewardSplit.SplitResult memory r = RewardSplit.split(1 ether, c, address(0), address(0));
        assertEq(r.tradeReferrer, 0);
        assertEq(r.createReferrer, 0);
        // Both referral shares (10% + 10%) fold into locked liquidity (20% + 20%).
        assertEq(r.lpLocked, 0.4 ether);
        uint256 sum = r.creator + r.tradeReferrer + r.createReferrer + r.protocol + r.lpLocked + r.lpReward;
        assertEq(sum, 1 ether);
    }

    /// @dev External boundary so expectRevert observes a lower call depth than the
    ///      cheatcode (internal library calls otherwise inline into the test).
    function callValidate(RewardSplit.SplitConfig memory c) external pure {
        RewardSplit.validate(c);
    }

    function test_RejectsOverAllocation() public {
        RewardSplit.SplitConfig memory c = RewardSplit.SplitConfig({
            creatorBps: 6000,
            tradeReferrerBps: 2000,
            createReferrerBps: 2000,
            protocolBps: 1000,
            lockBps: 1000
        }); // sums to 120%
        vm.expectRevert(RewardSplit.InvalidSplitConfig.selector);
        this.callValidate(c);
    }

    function testFuzz_NoWeiLeaks(uint96 fee, bool haveTrade, bool haveCreate) public pure {
        RewardSplit.SplitConfig memory c = _cfg();
        RewardSplit.SplitResult memory r = RewardSplit.split(
            fee, c, haveTrade ? address(0xA11CE) : address(0), haveCreate ? address(0xB0B) : address(0)
        );
        uint256 sum = r.creator + r.tradeReferrer + r.createReferrer + r.protocol + r.lpLocked + r.lpReward;
        assertEq(sum, fee, "no wei may leak for any fee");
    }
}
