// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC6551Account} from "erc6551/examples/simple/ERC6551Account.sol";

import {CollectionFactory} from "../src/CollectionFactory.sol";
import {LaunchpadERC721A} from "../src/LaunchpadERC721A.sol";
import {FeeSplitter} from "../src/FeeSplitter.sol";
import {LaunchpadTypes} from "../src/LaunchpadTypes.sol";

/// @notice Integration test against a FORK of Robinhood Chain testnet, using the
///         REAL canonical ERC-6551 registry deployed on-chain
///         (0x000000006551c19487814612e58FE06813775758). No transactions are
///         broadcast — a fork is a local simulation over live chain state — so this
///         verifies our contracts work against the actual registry without a key.
///
/// Run:  forge test --match-path test/Fork.t.sol \
///         --fork-url https://rpc.testnet.chain.robinhood.com/rpc -vv
/// It is skipped automatically when no fork URL / RPC is configured.
contract ForkTest is Test {
    address internal constant CANONICAL_6551 = 0x000000006551c19487814612e58FE06813775758;

    CollectionFactory internal factory;
    address internal creator = makeAddr("creator");
    address internal minter = makeAddr("minter");

    function setUp() public {
        // Opt-in: only fork when ROBINHOOD_TESTNET_RPC_URL is set (or forge is run
        // with --fork-url, which forks before setUp). The default `forge test` stays
        // fast and offline; these tests then self-skip via the chainid guard.
        string memory rpc = vm.envOr("ROBINHOOD_TESTNET_RPC_URL", string(""));
        if (bytes(rpc).length > 0) {
            try vm.createSelectFork(rpc) {} catch {}
        }
    }

    function test_Fork_CanonicalRegistryIsDeployed() public view {
        if (block.chainid != 46630) return; // not on the fork (RPC unavailable)
        assertGt(CANONICAL_6551.code.length, 0, "canonical 6551 registry missing on chain");
    }

    function test_Fork_CreateMintAndFundTBAViaRealRegistry() public {
        if (block.chainid != 46630) return; // skip if fork unavailable

        // Deploy our stack on the fork, pointing at the REAL registry.
        address accountImpl = address(new ERC6551Account());
        address collImpl = address(new LaunchpadERC721A());
        address feeSplitter = address(new FeeSplitter(address(this), address(this), 500));
        factory = new CollectionFactory(address(this), CANONICAL_6551, collImpl, accountImpl, feeSplitter);

        LaunchpadTypes.MintPhase[] memory phases = new LaunchpadTypes.MintPhase[](1);
        phases[0] = LaunchpadTypes.MintPhase({
            merkleRoot: bytes32(0),
            price: 0.01 ether,
            endPrice: 0,
            startTime: uint64(block.timestamp),
            endTime: uint64(block.timestamp + 1 days),
            perWalletCap: 0,
            maxMintable: 0
        });
        LaunchpadTypes.CollectionConfig memory cfg = LaunchpadTypes.CollectionConfig({
            name: "Fork Vessels",
            symbol: "FORK",
            maxSupply: 100,
            mintPrice: 0.01 ether,
            royaltyBps: 500,
            tbaFundingBps: 5000,
            backingAsset: address(0),
            mintPhases: phases
        });

        vm.prank(creator);
        address collection = factory.createCollection(cfg, "", "", false);
        LaunchpadERC721A col = LaunchpadERC721A(payable(collection));

        // Mint on the fork; each token's TBA is deployed by the REAL registry.
        vm.deal(minter, 0.05 ether);
        vm.prank(minter);
        bytes32[] memory none;
        col.mint{value: 0.05 ether}(0, 5, none);

        for (uint256 id = 1; id <= 5; ++id) {
            address tba = col.accountOf(id); // derived via the canonical registry
            assertEq(tba.balance, 0.005 ether, "TBA not funded on fork");
            assertGt(tba.code.length, 0, "TBA not deployed by real registry");
        }
    }
}
