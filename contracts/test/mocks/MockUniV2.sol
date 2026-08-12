// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IERC20Like {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @dev Minimal UniswapV2 LP token; only the router may mint.
contract MockUniV2Pair {
    string public constant name = "Mock-LP";
    string public constant symbol = "MLP";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    address public immutable token0;
    address public immutable token1;
    address public immutable router;

    constructor(address t0, address t1, address router_) {
        token0 = t0;
        token1 = t1;
        router = router_;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == router, "only router");
        totalSupply += amount;
        balanceOf[to] += amount;
    }
}

contract MockUniV2Factory {
    address public router;
    mapping(address => mapping(address => address)) public pairs;

    function setRouter(address r) external {
        router = r;
    }

    function getPair(address a, address b) external view returns (address) {
        return pairs[a][b];
    }

    function createPair(address a, address b) external returns (address pair) {
        pair = address(new MockUniV2Pair(a, b, router));
        pairs[a][b] = pair;
        pairs[b][a] = pair;
    }
}

/// @dev Minimal UniswapV2 router: pulls the token, mints LP == msg.value to `to`,
///      and keeps the ETH. Enough to exercise the SushiMarketDeployer wiring.
contract MockUniV2Router {
    address public immutable factory;
    address public immutable WETH;

    constructor(address factory_, address weth_) {
        factory = factory_;
        WETH = weth_;
    }

    function addLiquidityETH(address token, uint256 amountTokenDesired, uint256, uint256, address to, uint256)
        external
        payable
        returns (uint256 amountToken, uint256 amountETH, uint256 liquidity)
    {
        address pair = MockUniV2Factory(factory).getPair(token, WETH);
        if (pair == address(0)) pair = MockUniV2Factory(factory).createPair(token, WETH);

        // Pull all desired tokens into the pair (no dust in this mock).
        IERC20Like(token).transferFrom(msg.sender, pair, amountTokenDesired);

        liquidity = msg.value; // arbitrary but deterministic
        MockUniV2Pair(pair).mint(to, liquidity);
        return (amountTokenDesired, msg.value, liquidity);
    }
}
