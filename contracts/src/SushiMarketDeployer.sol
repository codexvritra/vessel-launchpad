// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IMarketDeployer} from "./interfaces/IMarketDeployer.sol";
import {IUniswapV2Router02, IUniswapV2Factory} from "./interfaces/IUniswapV2.sol";

/// @title SushiMarketDeployer
/// @notice Creates and seeds a SushiSwap (UniswapV2) coin/ETH pool for a collection
///         coin, so the collection has an on-chain market the moment liquidity is
///         added. The router address is injected, so this works against SushiSwap on
///         Robinhood Chain (once its contracts are live) or any UniswapV2-compatible
///         router — and against a mock in tests.
/// @dev    Non-custodial: it holds nothing across calls. It pulls the coins for the
///         one call, adds liquidity, sends LP to `to`, and refunds any dust.
contract SushiMarketDeployer is IMarketDeployer, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    error RefundFailed();

    IUniswapV2Router02 public immutable router;
    IUniswapV2Factory public immutable factory;
    address public immutable weth;

    event MarketCreated(
        address indexed token, address indexed pair, uint256 tokenIn, uint256 ethIn, uint256 liquidity
    );

    constructor(address router_) {
        router = IUniswapV2Router02(router_);
        factory = IUniswapV2Factory(IUniswapV2Router02(router_).factory());
        weth = IUniswapV2Router02(router_).WETH();
    }

    /// @inheritdoc IMarketDeployer
    function createMarket(
        address token,
        uint256 tokenAmount,
        uint256 minTokenOut,
        uint256 minEthOut,
        address to
    ) external payable nonReentrant returns (address pair, uint256 liquidity) {
        // Pull the coins to seed (caller must have approved this contract).
        IERC20(token).safeTransferFrom(msg.sender, address(this), tokenAmount);
        IERC20(token).forceApprove(address(router), tokenAmount);

        uint256 amountToken;
        uint256 amountETH;
        (amountToken, amountETH, liquidity) = router.addLiquidityETH{value: msg.value}(
            token, tokenAmount, minTokenOut, minEthOut, to, block.timestamp
        );

        pair = factory.getPair(token, weth);

        // Refund any unused coins and ETH to the caller.
        uint256 tokenDust = tokenAmount - amountToken;
        if (tokenDust > 0) IERC20(token).safeTransfer(msg.sender, tokenDust);
        uint256 ethDust = address(this).balance;
        if (ethDust > 0) {
            // Refund unused ETH to the caller (their own funds), not an arbitrary
            // destination. Guarded by nonReentrant.
            // slither-disable-next-line arbitrary-send-eth
            (bool ok,) = msg.sender.call{value: ethDust}("");
            if (!ok) revert RefundFailed();
        }

        emit MarketCreated(token, pair, amountToken, amountETH, liquidity);
    }

    /// @inheritdoc IMarketDeployer
    function pairFor(address token) external view returns (address) {
        return factory.getPair(token, weth);
    }

    receive() external payable {} // accept ETH dust refunded by the router
}
