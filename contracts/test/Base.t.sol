// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC6551Registry} from "erc6551/ERC6551Registry.sol";

import {CollectionFactory} from "../src/CollectionFactory.sol";
import {LaunchpadERC721A} from "../src/LaunchpadERC721A.sol";
import {FeeSplitter} from "../src/FeeSplitter.sol";
import {LaunchpadTypes} from "../src/LaunchpadTypes.sol";
import {BenignAccount} from "./mocks/Mocks.sol";

/// @notice Shared harness: deploys the full core stack and provides config/merkle
///         helpers. Registry is a local ERC-6551 registry; on a fork we would use
///         the canonical address instead.
abstract contract Base is Test {
    ERC6551Registry internal registry;
    address internal accountImpl;
    LaunchpadERC721A internal collectionImpl;
    FeeSplitter internal feeSplitter;
    CollectionFactory internal factory;

    address internal owner = makeAddr("owner");
    address internal protocol = makeAddr("protocol");
    address internal creator = makeAddr("creator");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    uint16 internal constant PROTOCOL_FEE_BPS = 500; // 5%

    function _deployStack(address accountImplementation) internal {
        registry = new ERC6551Registry();
        accountImpl = accountImplementation;
        collectionImpl = new LaunchpadERC721A();
        feeSplitter = new FeeSplitter(owner, protocol, PROTOCOL_FEE_BPS);
        factory = new CollectionFactory(
            owner, address(registry), address(collectionImpl), accountImpl, address(feeSplitter)
        );
    }

    function _deployStack() internal {
        _deployStack(address(new BenignAccount()));
    }

    // ---- config helpers ----

    function _publicPhase(uint256 price) internal view returns (LaunchpadTypes.MintPhase memory) {
        return LaunchpadTypes.MintPhase({
            merkleRoot: bytes32(0),
            price: price,
            endPrice: 0,
            startTime: uint64(block.timestamp),
            endTime: uint64(block.timestamp + 30 days),
            perWalletCap: 0,
            maxMintable: 0
        });
    }

    function _defaultConfig(uint256 price, uint16 tbaFundingBps)
        internal
        view
        returns (LaunchpadTypes.CollectionConfig memory c)
    {
        LaunchpadTypes.MintPhase[] memory ph = new LaunchpadTypes.MintPhase[](1);
        ph[0] = _publicPhase(price);
        c = LaunchpadTypes.CollectionConfig({
            name: "Flagship",
            symbol: "FLAG",
            maxSupply: 1000,
            mintPrice: price,
            royaltyBps: 500,
            tbaFundingBps: tbaFundingBps,
            backingAsset: address(0),
            mintPhases: ph
        });
    }

    function _create(LaunchpadTypes.CollectionConfig memory c) internal returns (LaunchpadERC721A col) {
        vm.prank(creator);
        col = LaunchpadERC721A(payable(factory.createCollection(c, "", "", false)));
    }

    // ---- merkle helpers (2-leaf commutative-sorted tree, OZ-compatible) ----

    function _leaf(address a) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(a))));
    }

    function _hashPair(bytes32 x, bytes32 y) internal pure returns (bytes32) {
        return x < y ? keccak256(abi.encodePacked(x, y)) : keccak256(abi.encodePacked(y, x));
    }

    /// @return root  Merkle root for {a, b}
    /// @return proofForA  proof proving membership of `a`
    function _merkle2(address a, address b) internal pure returns (bytes32 root, bytes32[] memory proofForA) {
        bytes32 la = _leaf(a);
        bytes32 lb = _leaf(b);
        root = _hashPair(la, lb);
        proofForA = new bytes32[](1);
        proofForA[0] = lb;
    }
}
