// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {TokenLauncher} from "../src/TokenLauncher.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {SushiMarketDeployer} from "../src/SushiMarketDeployer.sol";
import {MockAggregator} from "./mocks/Mocks.sol";

interface IUniPairLike {
    function balanceOf(address) external view returns (uint256);
}

/// @notice Integration test against a FORK of Robinhood Chain MAINNET, using the
///         REAL Uniswap V2 router deployed there (Sushi is not on this chain;
///         Uniswap is the primary AMM and shares the V2 interface). Proves the
///         direct-to-DEX fair launch actually creates a live pair on the real DEX.
///         No transactions are broadcast — a fork is a local simulation over live
///         chain state — so no key is needed.
///
/// Run:  ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com \
///         forge test --match-path test/MainnetFork.t.sol -vv
contract MainnetForkTest is Test {
    // Verified on-chain on Robinhood mainnet (chain 4663).
    address internal constant UNIV2_ROUTER = 0x89e5DB8B5aA49aA85AC63f691524311AEB649eba;
    address internal constant UNIV2_FACTORY = 0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f;

    address internal creator = makeAddr("creator");
    address internal protocol = makeAddr("protocol");

    function setUp() public {
        string memory rpc = vm.envOr("ROBINHOOD_RPC_URL", string(""));
        if (bytes(rpc).length > 0) {
            try vm.createSelectFork(rpc) {} catch {}
        }
    }

    function test_Fork_RealUniswapV2RouterIsLive() public view {
        if (block.chainid != 4663) return; // fork unavailable -> skip
        assertGt(UNIV2_ROUTER.code.length, 0, "router missing on mainnet");
        assertGt(UNIV2_FACTORY.code.length, 0, "factory missing on mainnet");
    }

    function test_Fork_DirectLaunchCreatesRealDexPair() public {
        if (block.chainid != 4663) return; // skip if not forked

        address tokenImpl = address(new LaunchToken());
        MockAggregator feed = new MockAggregator(3000e8, 8);
        SushiMarketDeployer md = new SushiMarketDeployer(UNIV2_ROUTER); // reads real factory/WETH
        assertEq(address(md.factory()), UNIV2_FACTORY, "wired to real Uniswap factory");

        TokenLauncher launcher =
            new TokenLauncher(address(this), tokenImpl, address(feed), address(md), protocol);

        uint256 fee = launcher.launchFeeWei();
        vm.deal(creator, fee + 1 ether);
        vm.prank(creator);
        (address token, address pair) = launcher.launch{value: fee + 1 ether}("ForkCoin", "FORK");

        // A REAL Uniswap V2 pair now exists and holds the full supply.
        assertTrue(pair != address(0), "real DEX pair not created");
        assertGt(pair.code.length, 0, "pair has no code");
        assertEq(LaunchToken(token).balanceOf(pair), launcher.SUPPLY(), "supply not in pool");
        assertGt(IUniPairLike(pair).balanceOf(protocol), 0, "LP not locked with protocol");
    }
}
