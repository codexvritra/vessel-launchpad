// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title ITBASwapper
/// @notice Adapter that atomically swaps the ETH funding a token-bound account
///         into the collection's backing asset (e.g. a tokenized equity) in the
///         same mint transaction. Kept behind an interface so unit tests run
///         without a live Uniswap deployment and so the router can be upgraded
///         per-collection without touching the token contract.
interface ITBASwapper {
    /// @notice Swap the attached ETH into `asset` and deliver it to `recipient`.
    /// @param asset      The ERC-20 backing asset to acquire.
    /// @param recipient  The token-bound account that should receive the asset.
    /// @param minAmountOut Slippage floor; adapter must revert if not met.
    /// @return amountOut  Units of `asset` delivered to `recipient`.
    function swapETHForAsset(address asset, address recipient, uint256 minAmountOut)
        external
        payable
        returns (uint256 amountOut);
}
