// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {BondingCurveNFT} from "../src/BondingCurveNFT.sol";
import {BondingCurveNFTFactory} from "../src/BondingCurveNFTFactory.sol";
import {MockAggregator} from "../test/mocks/Mocks.sol";

/// @notice Deploys the bonding-curve NFT launchpad (implementation + factory).
///         Reuses an existing ETH/USD feed if ETH_USD_FEED is set (e.g. the one
///         from the main deploy); otherwise deploys a $3000 mock. The $3 launch
///         fee and 1% buy/sell fee both route to PROTOCOL_RECIPIENT.
///
/// Env:  PROTOCOL_RECIPIENT (address, defaults to broadcaster)
///       ETH_USD_FEED       (address, optional — reuse the deployed mock feed)
contract DeployBCNFT is Script {
    function run() external returns (address impl, address factory, address feed) {
        address deployer = msg.sender;
        address protocolRecipient = vm.envOr("PROTOCOL_RECIPIENT", deployer);
        feed = vm.envOr("ETH_USD_FEED", address(0));

        vm.startBroadcast();

        if (feed == address(0) || feed.code.length == 0) {
            feed = address(new MockAggregator(3000e8, 8)); // $3000/ETH
            console2.log("Deployed mock ETH/USD feed:", feed);
        }

        impl = address(new BondingCurveNFT());
        factory = address(new BondingCurveNFTFactory(deployer, impl, feed, protocolRecipient));

        vm.stopBroadcast();

        console2.log("== Bonding-curve NFT launchpad deployed ==");
        console2.log("BondingCurveNFTFactory:", factory);
        console2.log("BondingCurveNFT impl  :", impl);
        console2.log("EthUsdFeed            :", feed);
        console2.log("ProtocolRecipient     :", protocolRecipient);
    }
}
