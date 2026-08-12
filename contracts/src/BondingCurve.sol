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

/// @title BondingCurve
/// @notice A pump.fun / bankr-style token launchpad with **virtual liquidity**. A
///         new token launches with virtual ETH + token reserves, so it has an
///         instant price and is buyable/sellable the moment it exists — no LP
///         provider needed. Pricing is constant-product (xy = k) over
///         (virtualEth + realEth, tokenReserve).
///
///         - Anyone can {buy}/{sell} from any wallet; no site connection required.
///         - A flat 1% fee on every buy and sell goes to the protocol wallet.
///         - Launching costs a USD-denominated fee (default $3, via Chainlink).
///         - When the curve raises `gradThreshold` of real ETH it GRADUATES: the
///           accumulated ETH + remaining tokens seed a real SushiSwap pair (which
///           DexScreener indexes) and the curve closes.
/// @dev    Rounding always favors the curve so the invariant
///         (virtualEth + realEth) * tokenReserve >= k holds after every trade.
contract BondingCurve is Ownable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    // --------------------------------------------------------------------- //
    //                               Errors                                  //
    // --------------------------------------------------------------------- //
    error UnknownToken();
    error Graduated();
    error InsufficientLaunchFee();
    error SlippageBuy();
    error SlippageSell();
    error ZeroAmount();
    error FeeTransferFailed();
    error PayoutFailed();

    // --------------------------------------------------------------------- //
    //                              Constants                                //
    // --------------------------------------------------------------------- //
    uint256 public constant SUPPLY = 1_000_000_000e18; // 1B tokens
    uint16 public constant FEE_BPS = 100; // 1% on buys and sells

    // --------------------------------------------------------------------- //
    //                          Owner-set config                            //
    // --------------------------------------------------------------------- //
    address public immutable tokenImplementation;
    IAggregatorV3 public ethUsdFeed;
    address public protocolRecipient; // receives the 1% trade fee + launch fee
    IMarketDeployer public marketDeployer; // SushiSwap seeder for graduation
    address public liquidityLock; // receives graduation LP tokens

    uint256 public launchFeeUsd = 3e18; // $3, 18-decimals
    uint256 public virtualEth = 1 ether; // sets the starting price
    uint256 public gradThreshold = 10 ether; // real ETH raised to graduate

    // --------------------------------------------------------------------- //
    //                              Per-token                               //
    // --------------------------------------------------------------------- //
    struct Curve {
        bool exists;
        bool graduated;
        address creator;
        uint256 virtualEth; // constant for this token
        uint256 realEth; // accumulated real ETH
        uint256 tokenReserve; // tokens still held by the curve
        uint256 k; // virtualEth * SUPPLY (constant product)
    }

    mapping(address => Curve) public curves; // token => curve
    address[] public allTokens;

    // --------------------------------------------------------------------- //
    //                                Events                                 //
    // --------------------------------------------------------------------- //
    event Launched(address indexed token, address indexed creator, string name, string symbol);
    event Trade(
        address indexed token,
        address indexed trader,
        bool isBuy,
        uint256 ethAmount, // net ETH in/out (excl. fee)
        uint256 tokenAmount,
        uint256 feeWei,
        uint256 priceX18, // ETH per token, 1e18-scaled, after the trade
        uint256 realEthAfter
    );
    event GraduatedToDex(
        address indexed token, address indexed pair, uint256 ethSeeded, uint256 tokensSeeded
    );
    event ConfigUpdated();

    constructor(address owner_, address tokenImplementation_, address ethUsdFeed_, address protocolRecipient_)
        Ownable(owner_)
    {
        tokenImplementation = tokenImplementation_;
        ethUsdFeed = IAggregatorV3(ethUsdFeed_);
        protocolRecipient = protocolRecipient_;
        liquidityLock = protocolRecipient_;
    }

    // --------------------------------------------------------------------- //
    //                                Launch                                 //
    // --------------------------------------------------------------------- //

    /// @notice Launch a new token. Charges the USD launch fee; any extra ETH is
    ///         used as an initial buy for the creator.
    function launch(string calldata name_, string calldata symbol_)
        external
        payable
        nonReentrant
        returns (address token)
    {
        uint256 fee = launchFeeWei();
        if (msg.value < fee) revert InsufficientLaunchFee();

        token = Clones.clone(tokenImplementation);
        LaunchToken(token).initialize(name_, symbol_, SUPPLY, address(this));

        curves[token] = Curve({
            exists: true,
            graduated: false,
            creator: msg.sender,
            virtualEth: virtualEth,
            realEth: 0,
            tokenReserve: SUPPLY,
            k: virtualEth * SUPPLY
        });
        allTokens.push(token);
        emit Launched(token, msg.sender, name_, symbol_);

        _payFee(fee);

        uint256 initialBuy = msg.value - fee;
        if (initialBuy > 0) _buy(token, initialBuy, 0, msg.sender);
    }

    // --------------------------------------------------------------------- //
    //                              Buy / Sell                               //
    // --------------------------------------------------------------------- //

    /// @notice Buy `token` with the attached ETH. Permissionless.
    function buy(address token, uint256 minTokensOut)
        external
        payable
        nonReentrant
        returns (uint256 tokensOut)
    {
        return _buy(token, msg.value, minTokensOut, msg.sender);
    }

    /// @dev Reached only via the nonReentrant `buy`/`launch` entrypoints; curve
    ///      state is updated before the external fee/transfer/graduate calls (CEI).
    // slither-disable-next-line reentrancy-eth
    function _buy(address token, uint256 ethIn, uint256 minTokensOut, address to)
        private
        returns (uint256 tokensOut)
    {
        Curve storage c = curves[token];
        if (!c.exists) revert UnknownToken();
        if (c.graduated) revert Graduated();
        if (ethIn == 0) revert ZeroAmount();

        uint256 fee = (ethIn * FEE_BPS) / 10_000;
        uint256 ethForCurve = ethIn - fee;

        uint256 ethReserve = c.virtualEth + c.realEth;
        // (ethReserve + ethForCurve) * (tokenReserve - tokensOut) = k. Ceil the new
        // reserve so the buyer gets slightly fewer tokens and the product stays >= k
        // (rounding favors the curve, never drains it).
        uint256 newTokenReserve = _ceilDiv(c.k, ethReserve + ethForCurve);
        tokensOut = c.tokenReserve - newTokenReserve;
        if (tokensOut < minTokensOut) revert SlippageBuy();

        c.realEth += ethForCurve;
        c.tokenReserve = newTokenReserve;

        _payFee(fee);
        IERC20(token).safeTransfer(to, tokensOut);

        emit Trade(token, to, true, ethForCurve, tokensOut, fee, _priceX18(c), c.realEth);

        if (c.realEth >= gradThreshold) _graduate(token, c);
    }

    /// @notice Sell `tokenAmount` of `token` back to the curve. Permissionless.
    function sell(address token, uint256 tokenAmount, uint256 minEthOut)
        external
        nonReentrant
        returns (uint256 ethOut)
    {
        Curve storage c = curves[token];
        if (!c.exists) revert UnknownToken();
        if (c.graduated) revert Graduated();
        if (tokenAmount == 0) revert ZeroAmount();

        IERC20(token).safeTransferFrom(msg.sender, address(this), tokenAmount);

        uint256 ethReserve = c.virtualEth + c.realEth;
        uint256 newTokenReserve = c.tokenReserve + tokenAmount;
        // (ethReserve - ethOutGross) * newTokenReserve = k ; ceil favors the curve
        uint256 ethReserveAfter = _ceilDiv(c.k, newTokenReserve);
        uint256 ethOutGross = ethReserve - ethReserveAfter;

        uint256 fee = (ethOutGross * FEE_BPS) / 10_000;
        ethOut = ethOutGross - fee;
        if (ethOut < minEthOut) revert SlippageSell();

        c.realEth -= ethOutGross;
        c.tokenReserve = newTokenReserve;

        _payFee(fee);
        (bool ok,) = msg.sender.call{value: ethOut}("");
        if (!ok) revert PayoutFailed();

        emit Trade(token, msg.sender, false, ethOut, tokenAmount, fee, _priceX18(c), c.realEth);
    }

    // --------------------------------------------------------------------- //
    //                              Graduation                               //
    // --------------------------------------------------------------------- //

    function _graduate(address token, Curve storage c) private {
        c.graduated = true;
        uint256 ethSeed = c.realEth;
        uint256 tokenSeed = c.tokenReserve;
        c.realEth = 0;
        c.tokenReserve = 0;

        address pair;
        if (address(marketDeployer) != address(0) && ethSeed > 0 && tokenSeed > 0) {
            IERC20(token).forceApprove(address(marketDeployer), tokenSeed);
            // marketDeployer is the owner-configured SushiSwap seeder, not arbitrary.
            // slither-disable-next-line arbitrary-send-eth
            (pair,) = marketDeployer.createMarket{value: ethSeed}(token, tokenSeed, 0, 0, liquidityLock);
        }
        emit GraduatedToDex(token, pair, ethSeed, tokenSeed);
    }

    // --------------------------------------------------------------------- //
    //                                Views                                  //
    // --------------------------------------------------------------------- //

    /// @notice Current launch fee in wei, from the USD target and the ETH/USD feed.
    function launchFeeWei() public view returns (uint256) {
        (, int256 answer,,,) = ethUsdFeed.latestRoundData();
        if (answer <= 0) return 0;
        uint256 dec = ethUsdFeed.decimals();
        // usd18 = ethWei * price / 10^dec  =>  ethWei = usd18 * 10^dec / price
        return (launchFeeUsd * (10 ** dec)) / uint256(answer);
    }

    /// @notice Spot price in ETH per token, 1e18-scaled.
    function priceX18(address token) external view returns (uint256) {
        return _priceX18(curves[token]);
    }

    function _priceX18(Curve storage c) private view returns (uint256) {
        if (c.tokenReserve == 0) return 0;
        return ((c.virtualEth + c.realEth) * 1e18) / c.tokenReserve;
    }

    /// @notice Quote tokens out for an ETH-in buy (net of fee).
    function quoteBuy(address token, uint256 ethIn) external view returns (uint256 tokensOut) {
        Curve storage c = curves[token];
        if (!c.exists || c.graduated) return 0;
        uint256 ethForCurve = ethIn - (ethIn * FEE_BPS) / 10_000;
        uint256 newTokenReserve = _ceilDiv(c.k, c.virtualEth + c.realEth + ethForCurve);
        tokensOut = c.tokenReserve - newTokenReserve;
    }

    function tokensCount() external view returns (uint256) {
        return allTokens.length;
    }

    // --------------------------------------------------------------------- //
    //                          Owner administration                         //
    // --------------------------------------------------------------------- //

    function setProtocolRecipient(address r) external onlyOwner {
        protocolRecipient = r;
        emit ConfigUpdated();
    }

    function setMarketDeployer(address d) external onlyOwner {
        marketDeployer = IMarketDeployer(d);
        emit ConfigUpdated();
    }

    function setLiquidityLock(address l) external onlyOwner {
        liquidityLock = l;
        emit ConfigUpdated();
    }

    function setCurveParams(uint256 launchFeeUsd_, uint256 virtualEth_, uint256 gradThreshold_)
        external
        onlyOwner
    {
        launchFeeUsd = launchFeeUsd_;
        virtualEth = virtualEth_;
        gradThreshold = gradThreshold_;
        emit ConfigUpdated();
    }

    function setEthUsdFeed(address f) external onlyOwner {
        ethUsdFeed = IAggregatorV3(f);
        emit ConfigUpdated();
    }

    // --------------------------------------------------------------------- //
    //                               Internal                                //
    // --------------------------------------------------------------------- //

    function _payFee(uint256 fee) private {
        if (fee == 0) return;
        (bool ok,) = protocolRecipient.call{value: fee}("");
        if (!ok) revert FeeTransferFailed();
    }

    function _ceilDiv(uint256 a, uint256 b) private pure returns (uint256) {
        return (a + b - 1) / b;
    }
}
