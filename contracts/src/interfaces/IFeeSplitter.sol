// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IFeeSplitter
/// @notice Accrues protocol and creator proceeds under a pull-payment model.
///         Never pushes ETH to arbitrary addresses (griefing / reentrancy vector);
///         beneficiaries call `claim()` themselves.
interface IFeeSplitter {
    /// @notice Deposit mint proceeds for a collection, crediting creator and protocol
    ///         according to the splitter's configured protocol fee.
    /// @param collection The collection the proceeds originate from.
    /// @param creator    The address credited with the creator share.
    function depositMintProceeds(address collection, address creator) external payable;

    /// @notice Credit already-attributed shares in bulk (used by the hook for
    ///         swap reward splits). `accounts` and `amounts` must be equal length
    ///         and their amounts must sum to msg.value.
    function depositSplits(address[] calldata accounts, uint256[] calldata amounts) external payable;

    /// @notice Withdraw the caller's full accrued balance.
    function claim() external returns (uint256 amount);

    /// @notice Accrued, unclaimed balance for `account`.
    function balanceOf(address account) external view returns (uint256);
}
