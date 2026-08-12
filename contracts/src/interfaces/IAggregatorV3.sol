// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Minimal Chainlink price-feed surface (ETH/USD) used to denominate the
///         launch fee in dollars.
interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
