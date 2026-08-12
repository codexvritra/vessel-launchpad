// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IMarketDeployer} from "./interfaces/IMarketDeployer.sol";

interface ICoinFactoryLike {
    function coinOf(address collection) external view returns (address);
    function marketDeployer() external view returns (address);
}

interface ICollectionCoinLike {
    function deposit(uint256[] calldata tokenIds) external returns (uint256 minted);
}

/// @title LiquidityLauncher
/// @notice One-click "provide liquidity": in a single transaction it pulls a
///         creator's NFTs, wraps them into the collection's fungible coin, and
///         seeds a SushiSwap coin/ETH pool — the last step of the launch flow.
///
///         The caller approves this launcher as an operator on the collection once
///         (standard ERC-721 approval), then calls {launch} with ETH attached. LP
///         tokens and any dust go back to the caller; the launcher custodies nothing
///         across transactions.
contract LiquidityLauncher is ReentrancyGuardTransient, IERC721Receiver {
    using SafeERC20 for IERC20;

    error NoCoin();
    error NoMarketDeployer();
    error NothingToDeposit();
    error RefundFailed();

    ICoinFactoryLike public immutable coinFactory;

    event LiquidityLaunched(
        address indexed collection,
        address indexed coin,
        address indexed provider,
        address pair,
        uint256 coins,
        uint256 ethIn,
        uint256 liquidity
    );

    constructor(address coinFactory_) {
        coinFactory = ICoinFactoryLike(coinFactory_);
    }

    /// @notice Deposit `tokenIds` into the collection's coin vault and seed a
    ///         SushiSwap pool with the resulting coins + attached ETH, atomically.
    /// @param collection  The NFT collection (must have a coin market enabled).
    /// @param tokenIds    Tokens the caller owns; the launcher must be approved.
    /// @param minTokenOut Slippage floor for coins added.
    /// @param minEthOut   Slippage floor for ETH added.
    function launch(address collection, uint256[] calldata tokenIds, uint256 minTokenOut, uint256 minEthOut)
        external
        payable
        nonReentrant
        returns (address pair, uint256 liquidity)
    {
        if (tokenIds.length == 0) revert NothingToDeposit();
        address coin = coinFactory.coinOf(collection);
        if (coin == address(0)) revert NoCoin();
        address deployer = coinFactory.marketDeployer();
        if (deployer == address(0)) revert NoMarketDeployer();

        // 1. Pull the NFTs from the caller into this launcher.
        for (uint256 i; i < tokenIds.length; ++i) {
            IERC721(collection).transferFrom(msg.sender, address(this), tokenIds[i]);
        }
        // 2. Let the coin vault pull them; deposit mints coins to this launcher.
        if (!IERC721(collection).isApprovedForAll(address(this), coin)) {
            IERC721(collection).setApprovalForAll(coin, true);
        }
        uint256 coins = ICollectionCoinLike(coin).deposit(tokenIds);

        // 3. Seed the SushiSwap pool; LP goes to the caller.
        IERC20(coin).forceApprove(deployer, coins);
        (pair, liquidity) = IMarketDeployer(deployer).createMarket{value: msg.value}(
            coin, coins, minTokenOut, minEthOut, msg.sender
        );

        // 4. Return any dust (coins/ETH the deployer refunded to us) to the caller.
        uint256 coinDust = IERC20(coin).balanceOf(address(this));
        if (coinDust > 0) IERC20(coin).safeTransfer(msg.sender, coinDust);
        uint256 ethDust = address(this).balance;
        if (ethDust > 0) {
            (bool ok,) = msg.sender.call{value: ethDust}("");
            if (!ok) revert RefundFailed();
        }

        emit LiquidityLaunched(collection, coin, msg.sender, pair, coins, msg.value, liquidity);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {}
}
