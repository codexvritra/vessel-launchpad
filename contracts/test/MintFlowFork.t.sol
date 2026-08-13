// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {CollectionFactory} from "../src/CollectionFactory.sol";
import {LaunchpadERC721A} from "../src/LaunchpadERC721A.sol";
import {LaunchpadTypes} from "../src/LaunchpadTypes.sol";

/// @notice Proves the launch -> mint flow works against the LIVE deployed
///         CollectionFactory on Robinhood Chain MAINNET, using a fork (a local
///         simulation over real chain state — nothing is broadcast, no ETH spent).
///
/// Run:  ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com \
///         forge test --match-path test/MintFlowFork.t.sol -vv
contract MintFlowForkTest is Test {
    // Live on Robinhood mainnet (chain 4663).
    address internal constant FACTORY = 0xE9f3C226EB834f57caC14e63a4f9f63f68DcCCCe;

    address internal creator = makeAddr("creator");
    address internal minter = makeAddr("minter");

    function setUp() public {
        string memory rpc = vm.envOr("ROBINHOOD_RPC_URL", string(""));
        if (bytes(rpc).length > 0) {
            try vm.createSelectFork(rpc) {} catch {}
        }
    }

    function test_Fork_LaunchAndMint() public {
        if (block.chainid != 4663) return; // fork unavailable -> skip
        assertGt(FACTORY.code.length, 0, "factory not live on mainnet");

        uint256 price = 0.001 ether;

        // A plain public-mint collection (no allowlist, no funded wallet) — exactly
        // what the simplified launch form deploys.
        LaunchpadTypes.MintPhase[] memory phases = new LaunchpadTypes.MintPhase[](1);
        phases[0] = LaunchpadTypes.MintPhase({
            merkleRoot: bytes32(0),
            price: price,
            endPrice: 0,
            startTime: 0,
            endTime: uint64(block.timestamp + 365 days),
            perWalletCap: 0,
            maxMintable: 0
        });

        LaunchpadTypes.CollectionConfig memory config = LaunchpadTypes.CollectionConfig({
            name: "Signapad Test",
            symbol: "TEST",
            maxSupply: 100,
            mintPrice: price,
            royaltyBps: 500,
            tbaFundingBps: 0,
            backingAsset: address(0),
            mintPhases: phases
        });

        // 1) Launch — deploy fee is 0 on this factory.
        vm.prank(creator);
        address collection =
            CollectionFactory(FACTORY).createCollection(config, "", "", false);
        assertGt(collection.code.length, 0, "collection clone not deployed");
        assertTrue(CollectionFactory(FACTORY).isCollection(collection), "not registered");
        console2.log("Launched collection:", collection);

        // 2) Mint 3 from a fresh buyer, paying price x 3.
        vm.deal(minter, 1 ether);
        vm.prank(minter);
        LaunchpadERC721A(collection).mint{value: price * 3}(0, 3, new bytes32[](0));

        // 3) The buyer owns 3 and supply advanced.
        assertEq(LaunchpadERC721A(collection).totalMinted(), 3, "supply != 3");
        assertEq(LaunchpadERC721A(collection).balanceOf(minter), 3, "buyer != 3 NFTs");
        console2.log("Minted OK. totalMinted =", LaunchpadERC721A(collection).totalMinted());
    }
}
