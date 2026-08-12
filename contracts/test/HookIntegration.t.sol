// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Deployers} from "v4-core/test/utils/Deployers.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";

import {LaunchpadHook} from "../src/LaunchpadHook.sol";
import {RewardSplit} from "../src/libraries/RewardSplit.sol";

contract MockFactoryReg {
    mapping(address => bool) public collections;

    function setCollection(address a, bool v) external {
        collections[a] = v;
    }

    function isCollection(address a) external view returns (bool) {
        return collections[a];
    }
}

/// @notice Full integration of LaunchpadHook against a live v4 PoolManager: init a
///         dynamic-fee pool, add liquidity, and swap. Asserts the decaying snipe
///         tax reaches the swap path, the hook fee is taken and split, and the
///         locked-liquidity donation settles.
contract HookIntegrationTest is Test, Deployers {
    LaunchpadHook internal hook;
    MockFactoryReg internal factory;

    uint256 constant BASE = 3000; // 0.3%
    uint256 constant MAXF = 990_000; // 99%
    uint256 constant WINDOW = 10;
    uint256 constant INIT_TS = 1_000_000;

    address internal creator = address(0xC0FFEE);
    address internal tradeRef = address(0x7EA);
    address internal createRef = address(0xC0);

    // Re-declared for expectEmit matching.
    event SnipeFeeApplied(PoolId indexed poolId, uint256 feePips);
    event LiquidityLockFlushed(PoolId indexed poolId, Currency currency, uint256 amount);

    function setUp() public {
        vm.warp(INIT_TS);
        deployFreshManagerAndRouters();
        (currency0, currency1) = deployMintAndApprove2Currencies();

        factory = new MockFactoryReg();
        factory.setCollection(creator, true);
        factory.setCollection(createRef, true);

        // Place the hook at an address whose low 14 bits encode its permission flags.
        uint160 flags = uint160(
            Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
                | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );
        address hookAddr = address((uint160(0x5555) << 14) | flags);

        RewardSplit.SplitConfig memory split = RewardSplit.SplitConfig({
            creatorBps: 4000,
            tradeReferrerBps: 1000,
            createReferrerBps: 1000,
            protocolBps: 1000,
            lockBps: 2000
        });

        deployCodeTo(
            "LaunchpadHook.sol:LaunchpadHook",
            abi.encode(manager, address(factory), uint16(100), BASE, MAXF, WINDOW, split),
            hookAddr
        );
        hook = LaunchpadHook(hookAddr);

        // Dynamic-fee pool so beforeSwap can override the LP fee per swap.
        (key,) = initPoolAndAddLiquidity(
            currency0, currency1, IHooks(hookAddr), LPFeeLibrary.DYNAMIC_FEE_FLAG, SQRT_PRICE_1_1
        );

        hook.registerPoolCreator(key, creator);
    }

    function _swap(int256 amount) internal {
        PoolSwapTest.TestSettings memory ts =
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false});
        SwapParams memory p = SwapParams({
            zeroForOne: true,
            amountSpecified: amount, // negative => exact input
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        });
        bytes memory hookData = abi.encode(tradeRef, createRef);
        swapRouter.swap(key, p, ts, hookData);
    }

    function test_SnipeTaxIsMaxAtInitThenDecays() public {
        // At init (block 0 of the pool) the snipe fee is the maximum.
        vm.expectEmit(false, false, false, true, address(hook));
        emit SnipeFeeApplied(key.toId(), MAXF);
        _swap(-1e15);

        // After the decay window the fee is the base fee.
        vm.warp(INIT_TS + WINDOW + 1);
        vm.expectEmit(false, false, false, true, address(hook));
        emit SnipeFeeApplied(key.toId(), BASE);
        _swap(-1e15);
    }

    function test_HookFeeTakenAndSplit() public {
        _swap(-1e15);

        // The hook took a fee on the output currency and split it: creator and the
        // (registered) create-referrer accrue; trade-referrer accrues; locked
        // liquidity accumulates.
        uint256 creatorBal = hook.accrued(currency1, creator);
        uint256 tradeBal = hook.accrued(currency1, tradeRef);
        uint256 createBal = hook.accrued(currency1, createRef);
        uint256 locked = hook.lockedLiquidity(key.toId(), currency1);

        assertGt(creatorBal, 0, "creator share not accrued");
        assertGt(tradeBal, 0, "trade referrer share not accrued");
        assertGt(createBal, 0, "create referrer share not accrued");
        assertGt(locked, 0, "no locked liquidity accrued");
    }

    function test_UnregisteredCreateReferrerRedirectsToLock() public {
        // Point the create-referrer at an address that is NOT a known collection.
        address fakeRef = address(0xBADBAD);
        PoolSwapTest.TestSettings memory ts =
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false});
        SwapParams memory p = SwapParams({
            zeroForOne: true, amountSpecified: -1e15, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        });
        swapRouter.swap(key, p, ts, abi.encode(tradeRef, fakeRef));

        // The unrecognized create-referrer earns nothing; its share went to the pool.
        assertEq(hook.accrued(currency1, fakeRef), 0, "unregistered referrer must not earn");
        assertGt(hook.lockedLiquidity(key.toId(), currency1), 0);
    }

    function test_ClaimTransfersAccruedFee() public {
        _swap(-1e15);
        uint256 owed = hook.accrued(currency1, creator);
        assertGt(owed, 0);

        uint256 before = MockERC20Like(Currency.unwrap(currency1)).balanceOf(creator);
        vm.prank(creator);
        hook.claim(currency1);
        uint256 afterBal = MockERC20Like(Currency.unwrap(currency1)).balanceOf(creator);
        assertEq(afterBal - before, owed, "claim did not transfer accrued fee");
        assertEq(hook.accrued(currency1, creator), 0);
    }

    function test_FlushLockedLiquidityDonates() public {
        _swap(-1e15);
        uint256 locked = hook.lockedLiquidity(key.toId(), currency1);
        assertGt(locked, 0);

        vm.expectEmit(true, false, false, false, address(hook));
        emit LiquidityLockFlushed(key.toId(), currency1, locked);
        hook.flushLockedLiquidity(key, currency1);

        assertEq(hook.lockedLiquidity(key.toId(), currency1), 0, "locked not flushed");
    }
}

interface MockERC20Like {
    function balanceOf(address) external view returns (uint256);
}
