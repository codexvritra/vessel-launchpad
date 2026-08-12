// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title DutchAuction
/// @notice Linear descending-price curve for a Dutch-auction mint phase, inspired
///         by the mechanics of MISO-style initial offerings adapted to NFTs.
///
///         Price starts at `startPrice` and decays linearly to `floorPrice` across
///         [startTime, endTime]; a minter pays the price at the block they mint in
///         and is refunded any excess. Undersubscribed auctions simply clear at the
///         floor. There is no batch/clearing-price settlement, so each token can be
///         minted and its token-bound account funded atomically — unlike a batch
///         auction, which would require deferring the mint to an end-of-sale claim.
///
/// @dev Pure and total (never reverts) — it runs on the mint hot path. Monotonically
///      non-increasing in time and always within [floorPrice, startPrice].
library DutchAuction {
    /// @param startPrice The price at (and before) `startTime` — the ceiling.
    /// @param floorPrice The price at (and after) `endTime` — the floor.
    /// @param startTime  Auction start (seconds).
    /// @param endTime    Auction end (seconds); must be > startTime for a live curve.
    /// @param nowTime    Current block time (seconds).
    /// @return price     The effective mint price at `nowTime`.
    function priceAt(
        uint256 startPrice,
        uint256 floorPrice,
        uint64 startTime,
        uint64 endTime,
        uint256 nowTime
    ) internal pure returns (uint256 price) {
        // Defensive clamps for degenerate configs.
        if (floorPrice >= startPrice || endTime <= startTime) return startPrice;
        if (nowTime <= startTime) return startPrice;
        if (nowTime >= endTime) return floorPrice;

        uint256 elapsed = nowTime - startTime;
        uint256 duration = uint256(endTime) - startTime;
        uint256 drop = ((startPrice - floorPrice) * elapsed) / duration;
        price = startPrice - drop;
    }
}
