// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Minimal SushiSwap / Uniswap-V2 router + factory surface. SushiSwap
///         classic is a UniswapV2 fork, so the same interface targets either. The
///         concrete router address is configured per deployment (Sushi's router on
///         Robinhood Chain, or a mock in tests).
interface IUniswapV2Router02 {
    function factory() external view returns (address);
    function WETH() external view returns (address);

    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity);
}

interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
    function createPair(address tokenA, address tokenB) external returns (address pair);
}
