// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title LaunchToken
/// @notice A plain, cloneable ERC-20 for the launchpad. The whole supply is minted
///         once to the controller at initialization; the controller (a bonding curve
///         or a direct-to-DEX launcher) distributes it.
///
///         Optional trade tax: the controller may set a fee (bps) charged on
///         transfers to/from the AMM pair (i.e. buys and sells), routed to a
///         recipient wallet. With no tax set it behaves like any standard token.
/// @dev    Self-contained ERC-20 (no external base) so EIP-1167 clones need no
///         constructor. `initialize` can be called once.
contract LaunchToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address public controller; // curve or launcher that manages this token
    uint16 public taxBps; // 0 => no tax
    address public taxRecipient;
    address public pair; // the AMM pair; transfers to/from it are taxed

    bool private _initialized;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event TaxUpdated(uint16 bps, address recipient);
    event PairSet(address pair);

    error AlreadyInitialized();
    error NotController();
    error InsufficientBalance();
    error InsufficientAllowance();
    error TaxTooHigh();

    modifier onlyController() {
        if (msg.sender != controller) revert NotController();
        _;
    }

    /// @notice One-time setup: mint the whole `supply` to the controller.
    function initialize(string calldata name_, string calldata symbol_, uint256 supply, address controller_)
        external
    {
        if (_initialized) revert AlreadyInitialized();
        _initialized = true;
        name = name_;
        symbol = symbol_;
        controller = controller_;
        totalSupply = supply;
        balanceOf[controller_] = supply;
        emit Transfer(address(0), controller_, supply);
    }

    /// @notice Set the buy/sell tax (<= 5%). Controller only.
    function setTax(uint16 bps, address recipient) external onlyController {
        if (bps > 500) revert TaxTooHigh();
        taxBps = bps;
        taxRecipient = recipient;
        emit TaxUpdated(bps, recipient);
    }

    /// @notice Set the AMM pair whose trades are taxed. Controller only.
    function setPair(address pair_) external onlyController {
        pair = pair_;
        emit PairSet(pair_);
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < value) revert InsufficientAllowance();
            allowance[from][msg.sender] = allowed - value;
        }
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) private {
        uint256 bal = balanceOf[from];
        if (bal < value) revert InsufficientBalance();

        uint256 tax;
        // Tax buys/sells (transfers touching the pair), but never the controller's
        // own liquidity operations.
        if (
            taxBps > 0 && pair != address(0) && (from == pair || to == pair) && from != controller
                && to != controller
        ) {
            tax = (value * taxBps) / 10_000;
        }

        unchecked {
            balanceOf[from] = bal - value;
            balanceOf[to] += value - tax;
        }
        emit Transfer(from, to, value - tax);

        if (tax > 0) {
            unchecked {
                balanceOf[taxRecipient] += tax;
            }
            emit Transfer(from, taxRecipient, tax);
        }
    }
}
