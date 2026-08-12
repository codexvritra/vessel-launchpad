// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IERC6551Registry
/// @notice Canonical ERC-6551 registry interface. The registry is deployed
///         deterministically at 0x000000006551c19487814612e58FE06813775758 on
///         every EVM chain, including Robinhood Chain.
/// @dev We depend only on this minimal surface. `account()` is a pure address
///      derivation (CREATE2) and `createAccount()` deploys the token-bound
///      account clone. Both are idempotent.
interface IERC6551Registry {
    /// @notice Emitted when a token-bound account is created.
    event ERC6551AccountCreated(
        address account,
        address indexed implementation,
        bytes32 salt,
        uint256 chainId,
        address indexed tokenContract,
        uint256 indexed tokenId
    );

    error AccountCreationFailed();

    /// @notice Deploys (or returns the existing) token-bound account for a token.
    function createAccount(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external returns (address accountAddress);

    /// @notice Computes the counterfactual token-bound account address.
    function account(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external view returns (address accountAddress);
}
