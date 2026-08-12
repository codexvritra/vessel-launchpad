// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import {LaunchToken} from "./LaunchToken.sol";
import {IMarketDeployer} from "./interfaces/IMarketDeployer.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";

/// @title TokenLauncher
/// @notice Direct-to-DEX fair launch — NO bonding curve. In one transaction it
///         mints a fixed-supply ERC-20 and seeds a live SushiSwap pair with the
///         creator's ETH, so the token trades on a real DEX immediately and shows
///         up on DexScreener (on chains DexScreener indexes — i.e. mainnet). The LP
///         is sent to a lock address. A 1% buy/sell tax on the token routes to the
///         protocol wallet, and launching costs a USD-denominated fee (default $3).
/// @dev    Requires a SushiSwap (UniswapV2) router to be live on the chain, provided
///         via the configured {IMarketDeployer}.
contract TokenLauncher is Ownable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    error InsufficientLaunchFee();
    error NoLiquidity();
    error NoMarketDeployer();
    error FeeTransferFailed();

    uint256 public constant SUPPLY = 1_000_000_000e18; // 1B tokens, all into the pool
    uint16 public constant TAX_BPS = 100; // 1% buy/sell tax

    address public immutable tokenImplementation;
    IAggregatorV3 public ethUsdFeed;
    IMarketDeployer public marketDeployer;
    address public protocolRecipient; // launch fee + 1% trade tax
    address public liquidityLock; // receives LP tokens
    uint256 public launchFeeUsd = 3e18; // $3

    mapping(address => bool) public isLaunchToken;
    address[] public allTokens;

    event Launched(
        address indexed token,
        address indexed creator,
        address indexed pair,
        string name,
        string symbol,
        uint256 ethLiquidity
    );
    event ConfigUpdated();

    constructor(
        address owner_,
        address tokenImplementation_,
        address ethUsdFeed_,
        address marketDeployer_,
        address protocolRecipient_
    ) Ownable(owner_) {
        tokenImplementation = tokenImplementation_;
        ethUsdFeed = IAggregatorV3(ethUsdFeed_);
        marketDeployer = IMarketDeployer(marketDeployer_);
        protocolRecipient = protocolRecipient_;
        liquidityLock = protocolRecipient_;
    }

    /// @notice Fair-launch a token straight onto SushiSwap. `msg.value` must cover
    ///         the launch fee plus the ETH that seeds the pool.
    function launch(string calldata name_, string calldata symbol_)
        external
        payable
        nonReentrant
        returns (address token, address pair)
    {
        if (address(marketDeployer) == address(0)) revert NoMarketDeployer();
        uint256 fee = launchFeeWei();
        if (msg.value < fee) revert InsufficientLaunchFee();
        uint256 ethLiquidity = msg.value - fee;
        if (ethLiquidity == 0) revert NoLiquidity();

        // 1. Mint the whole supply to this launcher.
        token = Clones.clone(tokenImplementation);
        LaunchToken(token).initialize(name_, symbol_, SUPPLY, address(this));
        // 2. Arm the 1% trade tax (the pair is set after the pool exists).
        LaunchToken(token).setTax(TAX_BPS, protocolRecipient);

        // 3. Seed the SushiSwap pool with the full supply + the creator's ETH.
        IERC20(token).forceApprove(address(marketDeployer), SUPPLY);
        (pair,) = marketDeployer.createMarket{value: ethLiquidity}(token, SUPPLY, 0, 0, liquidityLock);

        // 4. Now that the pair exists, tax its trades.
        LaunchToken(token).setPair(pair);

        isLaunchToken[token] = true;
        allTokens.push(token);

        _payFee(fee);
        emit Launched(token, msg.sender, pair, name_, symbol_, ethLiquidity);
    }

    /// @notice Launch fee in wei from the USD target and the ETH/USD feed.
    function launchFeeWei() public view returns (uint256) {
        (, int256 answer,,,) = ethUsdFeed.latestRoundData();
        if (answer <= 0) return 0;
        uint256 dec = ethUsdFeed.decimals();
        return (launchFeeUsd * (10 ** dec)) / uint256(answer);
    }

    function tokensCount() external view returns (uint256) {
        return allTokens.length;
    }

    function setMarketDeployer(address d) external onlyOwner {
        marketDeployer = IMarketDeployer(d);
        emit ConfigUpdated();
    }

    function setProtocolRecipient(address r) external onlyOwner {
        protocolRecipient = r;
        emit ConfigUpdated();
    }

    function setLiquidityLock(address l) external onlyOwner {
        liquidityLock = l;
        emit ConfigUpdated();
    }

    function setLaunchFeeUsd(uint256 usd) external onlyOwner {
        launchFeeUsd = usd;
        emit ConfigUpdated();
    }

    function setEthUsdFeed(address f) external onlyOwner {
        ethUsdFeed = IAggregatorV3(f);
        emit ConfigUpdated();
    }

    function _payFee(uint256 fee) private {
        if (fee == 0) return;
        // protocolRecipient is owner-configured, not arbitrary.
        // slither-disable-next-line arbitrary-send-eth
        (bool ok,) = protocolRecipient.call{value: fee}("");
        if (!ok) revert FeeTransferFailed();
    }
}
