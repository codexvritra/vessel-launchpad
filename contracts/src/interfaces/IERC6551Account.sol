// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IERC6551Account
/// @notice Minimal token-bound account interface (ERC-6551). We rely on `token()`
///         to read the (chainId, tokenContract, tokenId) triple a TBA is bound to,
///         and `state()` as a monotonically increasing nonce used by TBAGuard to
///         detect mutation between listing and settlement.
interface IERC6551Account {
    /// @notice Returns the identifier of the token that owns this account.
    function token() external view returns (uint256 chainId, address tokenContract, uint256 tokenId);

    /// @notice Returns a value that changes each time the account state changes.
    function state() external view returns (uint256);

    /// @notice Returns 0x1626ba7e (isValidSigner selector) if `signer` may act for the account.
    function isValidSigner(address signer, bytes calldata context) external view returns (bytes4);

    receive() external payable;
}
