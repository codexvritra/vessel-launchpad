// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

/// @title CollectionCoin
/// @notice A per-collection fungible ERC-20 that makes a Vessel collection tradeable
///         on an AMM. It is an NFT vault: deposit a collection NFT and receive
///         `UNIT` coins; redeem `UNIT` coins to withdraw an NFT. Because every coin
///         is 1:1 backed by an NFT held in the vault, the coin/ETH pool on SushiSwap
///         is a genuine floor market for the collection — not a naked token.
///
///         This is how the launchpad gets a Zora-style "trades immediately at
///         launch" market while keeping the NFT as the primitive: the NFT stays the
///         object of ownership; the coin is a fungible wrapper for liquidity.
/// @dev    Cloneable (EIP-1167): no constructor, `initialize` once. Self-contained
///         ERC-20 so clones need no external upgradeable base. Reentrancy is guarded
///         with transient storage (clone-safe).
contract CollectionCoin is ReentrancyGuardTransient, IERC721Receiver {
    // --------------------------- ERC-20 --------------------------- //
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    // ---------------------------- Vault --------------------------- //
    /// @notice 1 NFT == UNIT coins.
    uint256 public constant UNIT = 1e18;
    /// @notice The ERC-721 collection this coin vaults.
    address public collection;

    uint256[] private _held; // token ids currently in the vault
    mapping(uint256 => uint256) private _heldIndex; // tokenId => index+1 (0 = absent)
    bool private _initialized;

    event Deposit(address indexed from, uint256[] tokenIds, uint256 coinsMinted);
    event Redeem(address indexed to, uint256[] tokenIds, uint256 coinsBurned);

    error AlreadyInitialized();
    error NotHeld(uint256 tokenId);
    error ZeroDeposit();
    error InsufficientBalance();

    /// @notice One-time clone setup.
    function initialize(address collection_, string calldata name_, string calldata symbol_) external {
        if (_initialized) revert AlreadyInitialized();
        _initialized = true;
        collection = collection_;
        name = name_;
        symbol = symbol_;
    }

    // ------------------------ Vault actions ----------------------- //

    /// @notice Deposit NFTs from the collection; mint `UNIT` coins each. Caller must
    ///         approve this contract as operator (or per-token) first.
    /// @dev Standard vault pattern: NFTs must be pulled (interaction) before coins can
    ///      be minted; guarded by the transient nonReentrant modifier.
    // slither-disable-next-line reentrancy-no-eth
    function deposit(uint256[] calldata tokenIds) external nonReentrant returns (uint256 minted) {
        uint256 n = tokenIds.length;
        if (n == 0) revert ZeroDeposit();
        for (uint256 i; i < n; ++i) {
            IERC721(collection).transferFrom(msg.sender, address(this), tokenIds[i]);
            _addHeld(tokenIds[i]);
        }
        minted = n * UNIT;
        _mint(msg.sender, minted);
        emit Deposit(msg.sender, tokenIds, minted);
    }

    /// @notice Burn `UNIT` coins per requested id and withdraw those exact NFTs.
    /// @dev Coins are burned up front (effect); NFT withdrawals follow. Guarded by
    ///      the transient nonReentrant modifier.
    // slither-disable-next-line reentrancy-no-eth
    function redeem(uint256[] calldata tokenIds) external nonReentrant returns (uint256 burned) {
        uint256 n = tokenIds.length;
        if (n == 0) revert ZeroDeposit();
        burned = n * UNIT;
        _burn(msg.sender, burned); // effects before interactions
        for (uint256 i; i < n; ++i) {
            if (_heldIndex[tokenIds[i]] == 0) revert NotHeld(tokenIds[i]);
            _removeHeld(tokenIds[i]);
            IERC721(collection).transferFrom(address(this), msg.sender, tokenIds[i]);
        }
        emit Redeem(msg.sender, tokenIds, burned);
    }

    function heldCount() external view returns (uint256) {
        return _held.length;
    }

    function heldAt(uint256 i) external view returns (uint256) {
        return _held[i];
    }

    function _addHeld(uint256 tokenId) private {
        _held.push(tokenId);
        _heldIndex[tokenId] = _held.length; // index+1
    }

    function _removeHeld(uint256 tokenId) private {
        uint256 idx = _heldIndex[tokenId] - 1;
        uint256 last = _held.length - 1;
        if (idx != last) {
            uint256 moved = _held[last];
            _held[idx] = moved;
            _heldIndex[moved] = idx + 1;
        }
        _held.pop();
        delete _heldIndex[tokenId];
    }

    // -------------------------- ERC-20 ---------------------------- //

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
            if (allowed < value) revert InsufficientBalance();
            allowance[from][msg.sender] = allowed - value;
        }
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) private {
        uint256 bal = balanceOf[from];
        if (bal < value) revert InsufficientBalance();
        unchecked {
            balanceOf[from] = bal - value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
    }

    function _mint(address to, uint256 value) private {
        totalSupply += value;
        unchecked {
            balanceOf[to] += value;
        }
        emit Transfer(address(0), to, value);
    }

    function _burn(address from, uint256 value) private {
        uint256 bal = balanceOf[from];
        if (bal < value) revert InsufficientBalance();
        unchecked {
            balanceOf[from] = bal - value;
            totalSupply -= value;
        }
        emit Transfer(from, address(0), value);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}
