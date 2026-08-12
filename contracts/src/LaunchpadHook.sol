// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";

import {SnipeTax} from "./libraries/SnipeTax.sol";
import {RewardSplit} from "./libraries/RewardSplit.sol";

interface ICollectionFactoryLike {
    function isCollection(address addr) external view returns (bool);
}

/// @title LaunchpadHook
/// @notice Uniswap V4 hook attached to the pool of any collection that opts into a
///         fungible liquidity layer. It implements three mechanics:
///
///           1. DECAYING SNIPE TAX — a punitive dynamic fee (e.g. 99%) at pool init
///              that decays linearly to the base fee over a short window. Bots are
///              taxed, not blocked, and the tax funds the pool. (see {SnipeTax})
///
///           2. FEE-TO-LIQUIDITY LOCK — a fixed fraction of every fee is donated
///              back to the pool as permanent depth, so the pool gets harder to
///              drain the more it trades. (see {RewardSplit.lockBps})
///
///           3. REWARD SPLITS — each swap fee is divided between creator, trade-
///              referrer, create-referrer, protocol, and LPs. Referral addresses
///              arrive as hook data and are validated against the factory registry;
///              unrecognized referrers have their share redirected into locked
///              liquidity rather than leaking.
///
/// @dev    The pool MUST be initialized as a dynamic-fee pool so {beforeSwap} can
///         override the LP fee per swap. The fee this hook takes in {afterSwap} is
///         separate from the LP fee: it is taken from the swap's output currency and
///         then split. Payout to beneficiaries is pull-based ({claim}); the locked
///         share is donated to the pool by anyone via {flushLockedLiquidity}.
///
///         The {afterSwap}/{unlockCallback} settlement paths are covered by a live
///         PoolManager integration test (test/HookIntegration.t.sol): init a
///         dynamic-fee pool, add liquidity, swap, and assert the snipe-tax fee,
///         reward split, and locked-liquidity donation. The pure fee math
///         ({SnipeTax}, {RewardSplit}) and referral validation are unit-tested too.
contract LaunchpadHook is IHooks, IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using LPFeeLibrary for uint24;
    using BalanceDeltaLibrary for BalanceDelta;

    error NotPoolManager();
    error NotSelf();
    error NothingToClaim();
    error UnsupportedCallback();

    uint256 internal constant BPS = 10_000;

    IPoolManager public immutable poolManager;
    ICollectionFactoryLike public immutable factory;

    /// @notice Fee (bps of swap output) this hook takes to fund the reward splits.
    uint16 public immutable hookFeeBps;
    /// @notice Snipe-tax curve parameters (pips).
    uint256 public immutable baseFeePips;
    uint256 public immutable maxFeePips;
    uint256 public immutable decaySeconds;
    /// @notice Reward split configuration.
    RewardSplit.SplitConfig public splitConfig;
    /// @notice The collection that owns each pool (creator reward routing).
    mapping(PoolId => address) public poolCreator;
    /// @notice Pool initialization time — start of the snipe-tax decay.
    mapping(PoolId => uint256) public poolInitTime;

    /// @notice Pull-payment balances: currency => beneficiary => amount held by hook.
    mapping(Currency => mapping(address => uint256)) public accrued;
    /// @notice Locked-liquidity awaiting donation back to the pool: poolId => currency => amount.
    mapping(PoolId => mapping(Currency => uint256)) public lockedLiquidity;
    /// @notice Cumulative permanently-locked depth per pool/currency (analytics).
    mapping(PoolId => mapping(Currency => uint256)) public lockedLiquidityTotal;

    event SnipeFeeApplied(PoolId indexed poolId, uint256 feePips);
    event SwapRewarded(
        PoolId indexed poolId,
        Currency currency,
        uint256 fee,
        uint256 creator,
        uint256 tradeReferrer,
        uint256 createReferrer,
        uint256 protocol,
        uint256 lpLocked,
        uint256 lpReward
    );
    event RewardClaimed(Currency indexed currency, address indexed who, uint256 amount);
    event LiquidityLockFlushed(PoolId indexed poolId, Currency currency, uint256 amount);

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    constructor(
        IPoolManager poolManager_,
        address factory_,
        uint16 hookFeeBps_,
        uint256 baseFeePips_,
        uint256 maxFeePips_,
        uint256 decaySeconds_,
        RewardSplit.SplitConfig memory split_
    ) {
        poolManager = poolManager_;
        factory = ICollectionFactoryLike(factory_);
        hookFeeBps = hookFeeBps_;
        baseFeePips = baseFeePips_;
        maxFeePips = maxFeePips_;
        decaySeconds = decaySeconds_;
        RewardSplit.validate(split_);
        splitConfig = split_;
    }

    // --------------------------------------------------------------------- //
    //                          Hook permissions                             //
    // --------------------------------------------------------------------- //

    /// @notice The callbacks this hook uses. The deployed hook ADDRESS must encode
    ///         exactly these flags in its low bits (mined via CREATE2 at deploy).
    function getHookPermissions() public pure returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: true, // record decay start
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true, // apply decaying snipe tax
            afterSwap: true, // take + split reward fee
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: true, // hook takes a fee on the output
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // --------------------------------------------------------------------- //
    //                            Hook callbacks                             //
    // --------------------------------------------------------------------- //

    function afterInitialize(address, PoolKey calldata key, uint160, int24)
        external
        onlyPoolManager
        returns (bytes4)
    {
        poolInitTime[key.toId()] = block.timestamp;
        return IHooks.afterInitialize.selector;
    }

    /// @notice Apply the decaying snipe tax as a per-swap dynamic fee override.
    function beforeSwap(address, PoolKey calldata key, SwapParams calldata, bytes calldata)
        external
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        PoolId id = key.toId();
        uint256 fee =
            SnipeTax.feePips(poolInitTime[id], block.timestamp, baseFeePips, maxFeePips, decaySeconds);
        emit SnipeFeeApplied(id, fee);
        // OR in the override flag so the manager uses this fee for just this swap.
        uint24 feeWithFlag = uint24(fee) | LPFeeLibrary.OVERRIDE_FEE_FLAG;
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, feeWithFlag);
    }

    /// @notice Take the hook reward fee on the output currency and split it.
    function afterSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) external onlyPoolManager returns (bytes4, int128) {
        // Only handle exact-input swaps (the launchpad buy path); leave exact-output
        // untouched to avoid ambiguous sign handling on the unspecified currency.
        if (params.amountSpecified >= 0 || hookFeeBps == 0) {
            return (IHooks.afterSwap.selector, 0);
        }

        // Output currency is the "unspecified" side for exact input.
        (Currency outCurrency, uint256 outAmount) = params.zeroForOne
            ? (key.currency1, _pos(delta.amount1()))
            : (key.currency0, _pos(delta.amount0()));
        if (outAmount == 0) return (IHooks.afterSwap.selector, 0);

        uint256 fee = (outAmount * hookFeeBps) / BPS;
        if (fee == 0) return (IHooks.afterSwap.selector, 0);

        // Take the fee out of the pool now (real tokens to the hook). Returning +fee
        // below balances the hook's currency delta to zero.
        poolManager.take(outCurrency, address(this), fee);

        _distribute(key.toId(), outCurrency, fee, hookData);

        return (IHooks.afterSwap.selector, int128(int256(fee)));
    }

    function _distribute(PoolId id, Currency currency, uint256 fee, bytes calldata hookData) private {
        (address tradeReferrer, address createReferrer) = _parseReferrers(hookData);

        RewardSplit.SplitResult memory r = RewardSplit.split(fee, splitConfig, tradeReferrer, createReferrer);

        address creator = poolCreator[id];
        if (creator != address(0) && r.creator > 0) accrued[currency][creator] += r.creator;
        else lockedLiquidity[id][currency] += r.creator; // no creator set => lock it

        if (r.tradeReferrer > 0) accrued[currency][tradeReferrer] += r.tradeReferrer;
        if (r.createReferrer > 0) accrued[currency][createReferrer] += r.createReferrer;
        if (r.protocol > 0) accrued[currency][address(this)] += r.protocol; // protocol = hook owner sink

        uint256 toLock = r.lpLocked + r.lpReward;
        if (toLock > 0) {
            lockedLiquidity[id][currency] += toLock;
            lockedLiquidityTotal[id][currency] += r.lpLocked;
        }

        emit SwapRewarded(
            id,
            currency,
            fee,
            r.creator,
            r.tradeReferrer,
            r.createReferrer,
            r.protocol,
            r.lpLocked,
            r.lpReward
        );
    }

    /// @dev Referrers arrive as abi.encode(tradeReferrer, createReferrer). A create-
    ///      referrer is honoured only if it is a registered collection; otherwise its
    ///      share is redirected to locked liquidity by passing address(0) downstream.
    function _parseReferrers(bytes calldata hookData)
        internal
        view
        returns (address tradeReferrer, address createReferrer)
    {
        if (hookData.length >= 64) {
            (tradeReferrer, createReferrer) = abi.decode(hookData, (address, address));
        }
        if (createReferrer != address(0) && !factory.isCollection(createReferrer)) {
            createReferrer = address(0); // unrecognized => share goes to the pool
        }
    }

    // --------------------------------------------------------------------- //
    //                          Claim / flush                                //
    // --------------------------------------------------------------------- //

    /// @notice Withdraw accrued rewards in `currency` (pull payment; tokens already
    ///         held by the hook, so this is a direct transfer).
    function claim(Currency currency) external returns (uint256 amount) {
        amount = accrued[currency][msg.sender];
        if (amount == 0) revert NothingToClaim();
        accrued[currency][msg.sender] = 0;
        currency.transfer(msg.sender, amount);
        emit RewardClaimed(currency, msg.sender, amount);
    }

    /// @notice Donate the pool's accrued locked liquidity back into the pool as
    ///         permanent depth. Permissionless.
    function flushLockedLiquidity(PoolKey calldata key, Currency currency) external {
        PoolId id = key.toId();
        uint256 amount = lockedLiquidity[id][currency];
        if (amount == 0) revert NothingToClaim();
        lockedLiquidity[id][currency] = 0;
        // Return payload is unused; the callback performs the donate + settle.
        // slither-disable-next-line unused-return
        poolManager.unlock(abi.encode(key, currency, amount));
        emit LiquidityLockFlushed(id, currency, amount);
    }

    /// @notice PoolManager unlock callback used only by {flushLockedLiquidity}.
    function unlockCallback(bytes calldata data) external onlyPoolManager returns (bytes memory) {
        (PoolKey memory key, Currency currency, uint256 amount) =
            abi.decode(data, (PoolKey, Currency, uint256));

        bool isZero = Currency.unwrap(currency) == Currency.unwrap(key.currency0);
        // Donate delta and settle-paid are not needed; the transfer+settle below
        // balances the donate exactly.
        // slither-disable-next-line unused-return
        poolManager.donate(key, isZero ? amount : 0, isZero ? 0 : amount, "");
        poolManager.sync(currency);
        currency.transfer(address(poolManager), amount);
        // slither-disable-next-line unused-return
        poolManager.settle();
        return "";
    }

    /// @notice One-time association of a pool with its collection creator, so creator
    ///         rewards route correctly. Callable once per pool by the creator.
    function registerPoolCreator(PoolKey calldata key, address creator) external {
        PoolId id = key.toId();
        require(poolCreator[id] == address(0), "already set");
        require(factory.isCollection(creator) || msg.sender == creator, "invalid creator");
        poolCreator[id] = creator;
    }

    function _pos(int128 x) private pure returns (uint256) {
        return x > 0 ? uint256(uint128(x)) : 0;
    }

    // --------------------------------------------------------------------- //
    //             Unused IHooks callbacks (disabled by permissions)         //
    // --------------------------------------------------------------------- //

    function beforeInitialize(address, PoolKey calldata, uint160) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    error HookNotImplemented();
}
