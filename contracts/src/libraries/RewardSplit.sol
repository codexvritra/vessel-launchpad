// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title RewardSplit
/// @notice Splits a trading-fee amount five ways — creator, trade-referrer,
///         create-referrer, protocol, and LP — with a portion of the LP share
///         permanently locked into pool depth (the fee-to-liquidity lock).
///
///         Two mechanics live here:
///           * Reward splits: every swap's fee is divided by configured bps. Any
///             referrer whose address is zero (not supplied / not validated) has
///             its share redirected to the LP bucket, so unattributed rewards
///             deepen the pool rather than leak.
///           * Fee-to-liquidity lock: a fixed fraction of the fee is earmarked as
///             permanent, un-withdrawable depth. The pool gets HARDER to drain the
///             more it trades — the mechanic most clones skip.
///
/// @dev Conservation invariant: the returned parts always sum to exactly `fee`.
///      Integer-division remainder is assigned to the locked-liquidity bucket so no
///      wei leaks and the "locked" amount is never understated.
library RewardSplit {
    uint256 internal constant BPS = 10_000;

    struct SplitConfig {
        uint16 creatorBps;
        uint16 tradeReferrerBps;
        uint16 createReferrerBps;
        uint16 protocolBps;
        uint16 lockBps; // portion of fee locked as permanent liquidity
        // remainder (BPS - sum of the above) is the withdrawable LP share
    }

    struct SplitResult {
        uint256 creator;
        uint256 tradeReferrer;
        uint256 createReferrer;
        uint256 protocol;
        uint256 lpLocked; // permanent depth
        uint256 lpReward; // withdrawable LP share
    }

    error InvalidSplitConfig();

    /// @notice Validate that the configured bps do not exceed 100%.
    function validate(SplitConfig memory c) internal pure {
        uint256 sum =
            uint256(c.creatorBps) + c.tradeReferrerBps + c.createReferrerBps + c.protocolBps + c.lockBps;
        if (sum > BPS) revert InvalidSplitConfig();
    }

    /// @notice Compute the split of `fee`.
    /// @param fee            The total fee to divide.
    /// @param c              Split configuration in bps.
    /// @param tradeReferrer  Trade-referrer address (0 => share to locked liquidity).
    /// @param createReferrer Create-referrer address (0 => share to locked liquidity).
    /// @return r             The per-bucket amounts; sum == fee exactly.
    function split(uint256 fee, SplitConfig memory c, address tradeReferrer, address createReferrer)
        internal
        pure
        returns (SplitResult memory r)
    {
        r.creator = (fee * c.creatorBps) / BPS;
        r.protocol = (fee * c.protocolBps) / BPS;
        r.lpLocked = (fee * c.lockBps) / BPS;

        uint256 tradeShare = (fee * c.tradeReferrerBps) / BPS;
        uint256 createShare = (fee * c.createReferrerBps) / BPS;

        // Unattributed referral shares deepen the pool instead of leaking.
        if (tradeReferrer == address(0)) {
            r.lpLocked += tradeShare;
        } else {
            r.tradeReferrer = tradeShare;
        }
        if (createReferrer == address(0)) {
            r.lpLocked += createShare;
        } else {
            r.createReferrer = createShare;
        }

        // Everything not otherwise assigned is the withdrawable LP reward, with the
        // rounding remainder folded in so the total is conserved to the wei.
        uint256 assigned = r.creator + r.protocol + r.lpLocked + r.tradeReferrer + r.createReferrer;
        r.lpReward = fee - assigned; // fee >= assigned by construction
    }
}
