// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IMarketDeployer
/// @notice Abstraction over "create and seed an AMM market for this token". Kept
///         behind an interface (like {ITBASwapper}) so the venue is swappable — a
///         SushiSwap deployer today, another AMM tomorrow — without touching the
///         coin or the factory.
interface IMarketDeployer {
    /// @notice Seed a `token`/ETH pool: pulls `tokenAmount` of `token` from the
    ///         caller (who must approve first) and the attached ETH, adds liquidity,
    ///         and sends the LP tokens to `to`. Leftover token/ETH is refunded to the
    ///         caller.
    /// @return pair      The AMM pair address.
    /// @return liquidity LP tokens minted.
    function createMarket(
        address token,
        uint256 tokenAmount,
        uint256 minTokenOut,
        uint256 minEthOut,
        address to
    ) external payable returns (address pair, uint256 liquidity);

    /// @notice The (possibly not-yet-created) pair address for `token`/WETH.
    function pairFor(address token) external view returns (address);
}
