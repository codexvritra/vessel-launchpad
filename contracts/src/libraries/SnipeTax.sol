// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title SnipeTax
/// @notice Decaying anti-snipe fee curve for a freshly initialized pool.
///
///         Philosophy: bots are not blocked, they are TAXED. At pool init the swap
///         fee is punitive (e.g. 99%); it decays linearly to the pool's base fee
///         over a short window (e.g. 10 seconds). A sniper who buys in block 0 pays
///         almost their entire trade as fee — and that fee funds the pool (see the
///         fee-to-liquidity lock) rather than being burned. There is no allowlist
///         to maintain and no MEV arms race: honest buyers simply wait a few
///         seconds for the fee to normalize.
///
/// @dev Fees are expressed in pips (hundredths of a basis point); 1_000_000 = 100%,
///      matching Uniswap v4's `LPFeeLibrary` units. The curve is pure and total-
///      ordering safe: monotonically non-increasing in elapsed time.
library SnipeTax {
    /// @notice 100% in pips.
    uint256 internal constant MAX_PIPS = 1_000_000;

    /// @param initTimestamp The pool initialization time (seconds).
    /// @param nowTimestamp  The current block time (seconds); must be >= init.
    /// @param baseFeePips   The pool's steady-state fee in pips.
    /// @param maxFeePips    The fee at t=init in pips (e.g. 990000 for 99%).
    /// @param decaySeconds  The linear decay window length in seconds.
    /// @return feePips_     The effective fee in pips at `nowTimestamp`.
    function feePips(
        uint256 initTimestamp,
        uint256 nowTimestamp,
        uint256 baseFeePips,
        uint256 maxFeePips,
        uint256 decaySeconds
    ) internal pure returns (uint256 feePips_) {
        // Defensive clamps: a well-configured pool never hits these, but the curve
        // must be total (never revert) since it runs on the swap hot path.
        if (maxFeePips <= baseFeePips || decaySeconds == 0) return baseFeePips;
        if (nowTimestamp <= initTimestamp) return maxFeePips; // block 0 / init
        uint256 elapsed = nowTimestamp - initTimestamp;
        if (elapsed >= decaySeconds) return baseFeePips; // fully decayed

        // Linear interpolation: fee = max - (max - base) * elapsed / window.
        uint256 spread = maxFeePips - baseFeePips;
        uint256 reduction = (spread * elapsed) / decaySeconds;
        feePips_ = maxFeePips - reduction;
    }
}
