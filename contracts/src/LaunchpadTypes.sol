// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title LaunchpadTypes
/// @notice Shared structs for the launchpad. Kept in one library so the factory,
///         the cloneable token, and off-chain indexers agree on the exact ABI
///         encoding used to compute `configHash`.
library LaunchpadTypes {
    /// @notice A single mint phase. Phases are evaluated in array order; the first
    ///         phase whose [start, end) window contains block.timestamp and whose
    ///         proof requirement is satisfied is the active phase.
    /// @dev merkleRoot == bytes32(0) marks a public phase (no allowlist).
    struct MintPhase {
        bytes32 merkleRoot; // 0 => public phase
        uint256 price; // wei per token; the START price for a Dutch auction phase
        uint256 endPrice; // 0 => fixed-price phase; else the Dutch-auction floor (< price)
        uint64 startTime; // inclusive
        uint64 endTime; // exclusive
        uint32 perWalletCap; // 0 => no per-wallet cap in this phase
        uint32 maxMintable; // 0 => bounded only by collection maxSupply
    }

    /// @notice Creation config supplied by a creator to the factory.
    /// @dev NOTE: there is deliberately no `accountImplementation` field. The
    ///      6551 account implementation is fixed and factory-owned. Letting a
    ///      creator supply it would allow a malicious implementation that drains
    ///      the token-bound account on transfer — turning the platform into a rug
    ///      factory. This omission is a security invariant, not an oversight.
    struct CollectionConfig {
        string name;
        string symbol;
        uint256 maxSupply;
        uint256 mintPrice; // headline price; phases may override per-phase
        uint96 royaltyBps; // ERC-2981, basis points (max 10000)
        uint16 tbaFundingBps; // share of each mint price routed into the token's TBA
        address backingAsset; // address(0) => keep ETH in the TBA; else swap target
        MintPhase[] mintPhases;
    }

    /// @notice On-chain enumeration record kept by the factory per collection.
    struct CollectionMeta {
        address creator;
        address backingAsset;
        uint96 royaltyBps;
        uint16 tbaFundingBps;
        uint256 maxSupply;
        bytes32 configHash;
        uint64 createdAt;
        bool exists;
    }
}
