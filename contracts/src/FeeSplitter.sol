// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IFeeSplitter} from "./interfaces/IFeeSplitter.sol";

/// @title FeeSplitter
/// @notice Accrues the platform's mint cut, creator proceeds, and swap reward
///         splits under a strict pull-payment model. ETH is credited to internal
///         balances and withdrawn by each beneficiary via {claim}; the contract
///         never pushes ETH to arbitrary addresses, which would be a griefing and
///         reentrancy vector during minting.
/// @dev    Accounting invariant: the sum of all `balances` plus already-claimed
///         funds always equals total ETH ever received. Every deposit path splits
///         its msg.value exactly, with any integer-division remainder assigned to
///         the creator/first account so no wei is ever stranded.
contract FeeSplitter is IFeeSplitter, Ownable, ReentrancyGuardTransient {
    error LengthMismatch();
    error SumMismatch();
    error NothingToClaim();
    error TransferFailed();
    error InvalidBps();

    /// @notice Protocol fee on mint proceeds, in basis points.
    uint16 public protocolFeeBps;
    /// @notice Address credited with the protocol share.
    address public protocolRecipient;

    /// @notice Unclaimed, accrued ETH per beneficiary.
    mapping(address => uint256) public balances;

    event MintProceedsDeposited(
        address indexed collection, address indexed creator, uint256 creatorAmount, uint256 protocolAmount
    );
    event SplitsDeposited(uint256 total, uint256 parts);
    event Claimed(address indexed account, uint256 amount);
    event ProtocolFeeUpdated(uint16 bps, address indexed recipient);

    constructor(address owner_, address protocolRecipient_, uint16 protocolFeeBps_) Ownable(owner_) {
        if (protocolFeeBps_ > 10_000) revert InvalidBps();
        if (protocolRecipient_ == address(0)) revert TransferFailed();
        protocolRecipient = protocolRecipient_;
        protocolFeeBps = protocolFeeBps_;
    }

    /// @inheritdoc IFeeSplitter
    function depositMintProceeds(address collection, address creator) external payable {
        uint256 protocolAmount = (msg.value * protocolFeeBps) / 10_000;
        uint256 creatorAmount = msg.value - protocolAmount; // remainder to creator; no leak
        if (protocolAmount > 0) balances[protocolRecipient] += protocolAmount;
        if (creatorAmount > 0) balances[creator] += creatorAmount;
        emit MintProceedsDeposited(collection, creator, creatorAmount, protocolAmount);
    }

    /// @inheritdoc IFeeSplitter
    /// @dev Used by the hook for per-swap reward splits (creator / referrers /
    ///      protocol / LP). Amounts must sum exactly to msg.value.
    function depositSplits(address[] calldata accounts, uint256[] calldata amounts) external payable {
        if (accounts.length != amounts.length) revert LengthMismatch();
        uint256 sum = 0;
        for (uint256 i; i < accounts.length; ++i) {
            balances[accounts[i]] += amounts[i];
            sum += amounts[i];
        }
        if (sum != msg.value) revert SumMismatch();
        emit SplitsDeposited(msg.value, accounts.length);
    }

    /// @inheritdoc IFeeSplitter
    function claim() external nonReentrant returns (uint256 amount) {
        amount = balances[msg.sender];
        if (amount == 0) revert NothingToClaim();
        balances[msg.sender] = 0; // effect before interaction
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Claimed(msg.sender, amount);
    }

    /// @inheritdoc IFeeSplitter
    function balanceOf(address account) external view returns (uint256) {
        return balances[account];
    }

    function setProtocolFee(uint16 bps, address recipient) external onlyOwner {
        if (bps > 10_000) revert InvalidBps();
        if (recipient == address(0)) revert TransferFailed();
        protocolFeeBps = bps;
        protocolRecipient = recipient;
        emit ProtocolFeeUpdated(bps, recipient);
    }
}
