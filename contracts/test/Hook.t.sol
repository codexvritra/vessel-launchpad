// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {LaunchpadHook} from "../src/LaunchpadHook.sol";
import {RewardSplit} from "../src/libraries/RewardSplit.sol";
import {SnipeTax} from "../src/libraries/SnipeTax.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BeforeSwapDelta} from "v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";

contract MockFactory {
    mapping(address => bool) public collections;

    function setCollection(address a, bool v) external {
        collections[a] = v;
    }

    function isCollection(address a) external view returns (bool) {
        return collections[a];
    }
}

/// @notice Unit tests for the hook logic that does not require a live PoolManager:
///         the decaying snipe-tax fee returned by beforeSwap, init-time recording,
///         permission-flag correctness, and creator validation. The test contract
///         impersonates the PoolManager so onlyPoolManager passes.
contract HookTest is Test {
    LaunchpadHook internal hook;
    MockFactory internal factory;

    uint256 constant BASE = 3000; // 0.3% in pips
    uint256 constant MAXF = 990_000; // 99%
    uint256 constant WINDOW = 10;

    function setUp() public {
        factory = new MockFactory();
        RewardSplit.SplitConfig memory split = RewardSplit.SplitConfig({
            creatorBps: 4000,
            tradeReferrerBps: 1000,
            createReferrerBps: 1000,
            protocolBps: 1000,
            lockBps: 2000
        });
        // poolManager := this test contract, so we can drive the hook callbacks.
        hook =
            new LaunchpadHook(IPoolManager(address(this)), address(factory), 100, BASE, MAXF, WINDOW, split);
    }

    function _key() internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(0xaaaa)),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
    }

    function _feeFromBeforeSwap() internal returns (uint256) {
        SwapParams memory p = SwapParams({zeroForOne: true, amountSpecified: -1e18, sqrtPriceLimitX96: 0});
        (,, uint24 feeWithFlag) = hook.beforeSwap(address(1), _key(), p, "");
        assertTrue(feeWithFlag & LPFeeLibrary.OVERRIDE_FEE_FLAG != 0, "override flag not set");
        return feeWithFlag & ~LPFeeLibrary.OVERRIDE_FEE_FLAG;
    }

    function test_PermissionsMatchIntendedFlags() public view {
        Hooks.Permissions memory p = hook.getHookPermissions();
        assertTrue(p.afterInitialize);
        assertTrue(p.beforeSwap);
        assertTrue(p.afterSwap);
        assertTrue(p.afterSwapReturnDelta);
        assertFalse(p.beforeSwapReturnDelta);
        assertFalse(p.beforeAddLiquidity);
    }

    function test_AfterInitializeRecordsDecayStart() public {
        vm.warp(1_000_000);
        hook.afterInitialize(address(1), _key(), 0, 0);
        // At init the snipe fee is at maximum.
        assertEq(_feeFromBeforeSwap(), MAXF);
    }

    function test_SnipeFeeDecaysOverWindow() public {
        vm.warp(1_000_000);
        hook.afterInitialize(address(1), _key(), 0, 0);
        assertEq(_feeFromBeforeSwap(), MAXF); // block 0

        vm.warp(1_000_000 + 1);
        assertEq(_feeFromBeforeSwap(), SnipeTax.feePips(1_000_000, 1_000_001, BASE, MAXF, WINDOW));

        vm.warp(1_000_000 + WINDOW); // exactly 10s
        assertEq(_feeFromBeforeSwap(), BASE);

        vm.warp(1_000_000 + WINDOW + 5); // after
        assertEq(_feeFromBeforeSwap(), BASE);
    }

    function test_OnlyPoolManagerGuards() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(LaunchpadHook.NotPoolManager.selector);
        hook.afterInitialize(address(1), _key(), 0, 0);
    }

    function test_RegisterPoolCreatorValidatesAgainstFactory() public {
        address creator = address(0xC0FFEE);
        // Not a known collection and caller != creator => rejected.
        vm.prank(address(0xBAD));
        vm.expectRevert("invalid creator");
        hook.registerPoolCreator(_key(), creator);

        // Registered collection creator is accepted, and set-once is enforced.
        factory.setCollection(creator, true);
        hook.registerPoolCreator(_key(), creator);
        vm.expectRevert("already set");
        hook.registerPoolCreator(_key(), creator);
    }
}
