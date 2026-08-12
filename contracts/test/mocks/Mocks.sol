// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC6551Account} from "../../src/interfaces/IERC6551Account.sol";
import {ITBASwapper} from "../../src/interfaces/ITBASwapper.sol";
import {LaunchpadERC721A} from "../../src/LaunchpadERC721A.sol";

/// @dev Minimal ERC-20 for backing-asset / swap tests.
contract MockERC20 {
    string public name = "Mock Equity";
    string public symbol = "mNVDA";
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

/// @dev Mock Chainlink ETH/USD aggregator.
contract MockAggregator {
    int256 private _answer;
    uint8 private _decimals;

    constructor(int256 answer_, uint8 decimals_) {
        _answer = answer_;
        _decimals = decimals_;
    }

    function setAnswer(int256 a) external {
        _answer = a;
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (0, _answer, 0, block.timestamp, 0);
    }
}

/// @dev Deterministic mock swapper: pays out `rate` asset units per wei of ETH.
contract MockSwapper is ITBASwapper {
    MockERC20 public immutable asset;
    uint256 public immutable rate; // asset units (wei) per input wei

    error SlippageMock();

    constructor(MockERC20 asset_, uint256 rate_) {
        asset = asset_;
        rate = rate_;
    }

    function swapETHForAsset(address, address recipient, uint256 minAmountOut)
        external
        payable
        returns (uint256 amountOut)
    {
        amountOut = msg.value * rate;
        if (amountOut < minAmountOut) revert SlippageMock();
        asset.mint(recipient, amountOut);
    }
}

/// @dev Benign token-bound account: accepts ETH, exposes 6551 surface. Mirrors the
///      shape of the reference implementation used as the platform's fixed impl.
contract BenignAccount is IERC6551Account {
    uint256 private _state;

    receive() external payable {
        _state++;
    }

    function token() external view returns (uint256, address, uint256) {
        return (block.chainid, address(0), 0);
    }

    function state() external view returns (uint256) {
        return _state;
    }

    function isValidSigner(address, bytes calldata) external pure returns (bytes4) {
        return 0x1626ba7e;
    }
}

/// @dev Malicious swapper that reenters mint() during TBA funding — a real
///      untrusted external call in the mint path. Proves the nonReentrant guard.
contract ReentrantSwapper is ITBASwapper {
    address public target;
    uint256 public phaseId;
    uint256 public price;

    function arm(address target_, uint256 phaseId_, uint256 price_) external {
        target = target_;
        phaseId = phaseId_;
        price = price_;
    }

    receive() external payable {}

    function swapETHForAsset(address, address, uint256) external payable returns (uint256) {
        bytes32[] memory proof;
        LaunchpadERC721A(payable(target)).mint{value: price}(phaseId, 1, proof);
        return 0;
    }
}

/// @dev Malicious account impl that tries to reenter mint() when funded. Used to
///      prove the collection's reentrancy guard blocks drain-on-funding, and to
///      demonstrate why the account implementation MUST be factory-fixed.
contract ReentrantAccount is IERC6551Account {
    uint256 private _state;
    address public target; // the collection to reenter
    uint256 public phaseId;
    uint256 public price;

    function arm(address target_, uint256 phaseId_, uint256 price_) external {
        target = target_;
        phaseId = phaseId_;
        price = price_;
    }

    receive() external payable {
        _state++;
        if (target != address(0)) {
            bytes32[] memory proof;
            // Attempt to reenter the mint function during TBA funding.
            LaunchpadERC721A(payable(target)).mint{value: price}(phaseId, 1, proof);
        }
    }

    function token() external view returns (uint256, address, uint256) {
        return (block.chainid, address(0), 0);
    }

    function state() external view returns (uint256) {
        return _state;
    }

    function isValidSigner(address, bytes calldata) external pure returns (bytes4) {
        return 0x1626ba7e;
    }
}
