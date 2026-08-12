// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {CollectionFactory} from "../src/CollectionFactory.sol";
import {LaunchpadERC721A} from "../src/LaunchpadERC721A.sol";
import {LaunchpadTypes} from "../src/LaunchpadTypes.sol";

/// @notice Seeds the platform's flagship collection ("Vessel Founders") and runs the
///         end-to-end loop: deploy collection -> mint -> verify each token-bound
///         account is funded. This is the cold-start seed — the platform's own
///         collection so the two-sided market is not empty on day one.
///
/// Env:
///   FACTORY        (address) — from Deploy
///   MINT_QTY       (uint, default 5)
contract SeedFlagship is Script {
    function run() external returns (address collection) {
        CollectionFactory factory = CollectionFactory(vm.envAddress("FACTORY"));
        uint256 qty = vm.envOr("MINT_QTY", uint256(5));

        uint256 price = 0.005 ether;

        LaunchpadTypes.MintPhase[] memory phases = new LaunchpadTypes.MintPhase[](1);
        phases[0] = LaunchpadTypes.MintPhase({
            merkleRoot: bytes32(0), // public
            price: price,
            endPrice: 0,
            startTime: uint64(block.timestamp),
            endTime: uint64(block.timestamp + 365 days),
            perWalletCap: 0,
            maxMintable: 0
        });

        LaunchpadTypes.CollectionConfig memory cfg = LaunchpadTypes.CollectionConfig({
            name: "Vessel Founders",
            symbol: "VSSL",
            maxSupply: 1000,
            mintPrice: price,
            royaltyBps: 500, // 5%
            tbaFundingBps: 5000, // 50% of each mint funds the token's wallet
            backingAsset: address(0), // hold ETH in the TBA on testnet
            mintPhases: phases
        });

        vm.startBroadcast();

        collection = factory.createCollection(
            cfg,
            vm.envOr("METADATA_BASE", string("")),
            vm.envOr("CONTRACT_URI", string("")),
            vm.envOr("ENABLE_COIN_MARKET", false)
        );
        LaunchpadERC721A col = LaunchpadERC721A(payable(collection));
        console2.log("Flagship 'Vessel Founders' deployed:", collection);

        // Mint the seed batch to the deployer.
        bytes32[] memory noProof;
        col.mint{value: price * qty}(0, qty, noProof);
        console2.log("Minted seed tokens:", qty);

        vm.stopBroadcast();

        // Verify each token-bound account was funded.
        uint256 fundingPerToken = (price * cfg.tbaFundingBps) / 10_000;
        for (uint256 id = 1; id <= qty; ++id) {
            address tba = col.accountOf(id);
            console2.log("token", id, "-> TBA", tba);
            console2.log("   funded (wei):", tba.balance);
            require(tba.balance == fundingPerToken, "TBA not funded as expected");
        }
        console2.log("Deploy-mint-view loop OK. Every vessel is funded.");
    }
}
