// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Base} from "./Base.t.sol";
import {LaunchpadERC721A} from "../src/LaunchpadERC721A.sol";
import {CollectionFactory} from "../src/CollectionFactory.sol";
import {FeeSplitter} from "../src/FeeSplitter.sol";
import {LaunchpadTypes} from "../src/LaunchpadTypes.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {MockERC20, MockSwapper, ReentrantSwapper, BenignAccount} from "./mocks/Mocks.sol";

/// @notice Phase-1 core: the deploy -> mint -> TBA-funded -> view loop, plus the
///         required security cases (reentrancy, merkle bypass, malicious impl,
///         fee accounting invariants).
contract CoreFlowTest is Base {
    function setUp() public {
        _deployStack();
    }

    // ------------------------------------------------------------------ //
    //                    Deploy / clone economics                        //
    // ------------------------------------------------------------------ //

    function test_CloneIsCheap() public {
        // (1) The raw EIP-1167 clone deployment — the number the spec targets —
        //     must be ~50k, not the ~2M of a full implementation deployment.
        uint256 g0 = gasleft();
        address clone = Clones.clone(address(collectionImpl));
        uint256 cloneGas = g0 - gasleft();
        assertTrue(clone != address(0));
        assertLt(cloneGas, 60_000, "raw clone deploy should be ~50k");
        emit log_named_uint("raw clone deploy gas", cloneGas);

        // (2) A full fresh implementation deployment for comparison (the cost the
        //     clone avoids on every collection).
        g0 = gasleft();
        LaunchpadERC721A fresh = new LaunchpadERC721A();
        uint256 freshGas = g0 - gasleft();
        assertGt(freshGas, 1_500_000, "sanity: full deploy is expensive");
        emit log_named_uint("full implementation deploy gas", freshGas);
        assertTrue(address(fresh) != address(0));

        // (3) createCollection (clone + initialize + factory bookkeeping) is still
        //     an order of magnitude below a fresh deploy.
        LaunchpadTypes.CollectionConfig memory c = _defaultConfig(0.01 ether, 5000);
        vm.prank(creator);
        g0 = gasleft();
        address col = factory.createCollection(c, "", "", false);
        uint256 createGas = g0 - gasleft();
        emit log_named_uint("createCollection gas", createGas);
        assertLt(createGas, freshGas / 2, "createCollection should be far below full deploy");
        assertTrue(col != address(0));
    }

    function test_PredictedAddressMatches() public {
        vm.prank(creator);
        address predicted = factory.predictCollectionAddress(creator);
        LaunchpadERC721A col = _create(_defaultConfig(0.01 ether, 5000));
        assertEq(address(col), predicted, "prediction mismatch");
    }

    function test_DeployFeeChargedAndWithdrawable() public {
        vm.prank(owner);
        factory.setDeployFee(0.002 ether);

        LaunchpadTypes.CollectionConfig memory c = _defaultConfig(0.01 ether, 5000);

        // Wrong fee reverts.
        vm.prank(creator);
        vm.expectRevert(CollectionFactory.IncorrectDeployFee.selector);
        factory.createCollection(c, "", "", false);

        // Correct fee succeeds and accrues to the factory.
        vm.deal(creator, 0.002 ether);
        vm.prank(creator);
        factory.createCollection{value: 0.002 ether}(c, "", "", false);
        assertEq(address(factory).balance, 0.002 ether);

        // Owner withdraws.
        uint256 before = owner.balance;
        vm.prank(owner);
        factory.withdrawFees(owner);
        assertEq(owner.balance, before + 0.002 ether);
    }

    function test_EnumerationRegistered() public {
        LaunchpadERC721A col = _create(_defaultConfig(0.01 ether, 5000));
        assertTrue(factory.isCollection(address(col)));
        assertEq(factory.collectionsCount(), 1);
        (address metaCreator,,,,,,,) = _meta(address(col));
        assertEq(metaCreator, creator);
    }

    // ------------------------------------------------------------------ //
    //                    Mint + TBA funding (the loop)                   //
    // ------------------------------------------------------------------ //

    function test_MintFundsTokenBoundAccounts() public {
        uint256 price = 0.01 ether;
        uint16 fundingBps = 6000; // 60% of price into the TBA
        LaunchpadERC721A col = _create(_defaultConfig(price, fundingBps));

        uint256 qty = 3;
        uint256 cost = price * qty;
        vm.deal(alice, cost);
        vm.prank(alice);
        bytes32[] memory none;
        col.mint{value: cost}(0, qty, none);

        assertEq(col.balanceOf(alice), qty);
        assertEq(col.totalMinted(), qty);

        uint256 fundingPerToken = (price * fundingBps) / 10_000;
        for (uint256 id = 1; id <= qty; ++id) {
            address tba = col.accountOf(id);
            assertEq(tba.balance, fundingPerToken, "TBA not funded");
            assertGt(tba.code.length, 0, "TBA not deployed");
            assertEq(col.ownerOf(id), alice);
        }

        // Remaining proceeds are accrued (pull) to creator + protocol, exactly.
        uint256 proceeds = cost - fundingPerToken * qty;
        uint256 protocolCut = (proceeds * PROTOCOL_FEE_BPS) / 10_000;
        assertEq(feeSplitter.balanceOf(protocol), protocolCut);
        assertEq(feeSplitter.balanceOf(creator), proceeds - protocolCut);
    }

    function test_ClaimIsPullOnly() public {
        LaunchpadERC721A col = _create(_defaultConfig(0.01 ether, 5000));
        vm.deal(alice, 0.01 ether);
        vm.prank(alice);
        bytes32[] memory none;
        col.mint{value: 0.01 ether}(0, 1, none);

        uint256 before = creator.balance;
        uint256 owed = feeSplitter.balanceOf(creator);
        vm.prank(creator);
        feeSplitter.claim();
        assertEq(creator.balance, before + owed);
        assertEq(feeSplitter.balanceOf(creator), 0);
    }

    function test_AtomicSwapIntoBackingAsset() public {
        MockERC20 equity = new MockERC20();
        MockSwapper mockSwap = new MockSwapper(equity, 2); // 2 asset-wei per input-wei
        vm.prank(owner);
        factory.setSwapper(address(mockSwap));

        LaunchpadTypes.CollectionConfig memory c = _defaultConfig(0.01 ether, 5000);
        c.backingAsset = address(equity);
        LaunchpadERC721A col = _create(c);

        vm.deal(alice, 0.01 ether);
        vm.prank(alice);
        bytes32[] memory none;
        col.mint{value: 0.01 ether}(0, 1, none);

        address tba = col.accountOf(1);
        uint256 fundingPerToken = (0.01 ether * 5000) / 10_000;
        assertEq(equity.balanceOf(tba), fundingPerToken * 2, "swap did not deliver asset to TBA");
        assertEq(tba.balance, 0, "TBA should hold asset, not ETH");
    }

    function test_IncorrectPaymentReverts() public {
        LaunchpadERC721A col = _create(_defaultConfig(0.01 ether, 5000));
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        bytes32[] memory none;
        vm.expectRevert(LaunchpadERC721A.IncorrectPayment.selector);
        col.mint{value: 0.009 ether}(0, 1, none);
    }

    // ------------------------------------------------------------------ //
    //                         Merkle allowlist                           //
    // ------------------------------------------------------------------ //

    function test_AllowlistAcceptsProofRejectsBypass() public {
        (bytes32 root, bytes32[] memory proofAlice) = _merkle2(alice, bob);

        LaunchpadTypes.MintPhase[] memory ph = new LaunchpadTypes.MintPhase[](1);
        ph[0] = LaunchpadTypes.MintPhase({
            merkleRoot: root,
            price: 0.01 ether,
            endPrice: 0,
            startTime: uint64(block.timestamp),
            endTime: uint64(block.timestamp + 1 days),
            perWalletCap: 0,
            maxMintable: 0
        });
        LaunchpadTypes.CollectionConfig memory c = _defaultConfig(0.01 ether, 5000);
        c.mintPhases = ph;
        LaunchpadERC721A col = _create(c);

        // Allowlisted alice with valid proof: ok.
        vm.deal(alice, 0.01 ether);
        vm.prank(alice);
        col.mint{value: 0.01 ether}(0, 1, proofAlice);
        assertEq(col.balanceOf(alice), 1);

        // Non-allowlisted carol with alice's proof: rejected (proof is address-bound).
        address carol = makeAddr("carol");
        vm.deal(carol, 0.01 ether);
        vm.prank(carol);
        vm.expectRevert(LaunchpadERC721A.NotAllowlisted.selector);
        col.mint{value: 0.01 ether}(0, 1, proofAlice);

        // Empty proof: rejected.
        vm.deal(carol, 0.01 ether);
        vm.prank(carol);
        bytes32[] memory none;
        vm.expectRevert(LaunchpadERC721A.NotAllowlisted.selector);
        col.mint{value: 0.01 ether}(0, 1, none);
    }

    // ------------------------------------------------------------------ //
    //              Malicious 6551 account impl is not creator-settable   //
    // ------------------------------------------------------------------ //

    function test_CreatorCannotSupplyAccountImplementation() public {
        // The config struct has NO account-implementation field: creators cannot
        // pass one at all. Every clone inherits the factory's fixed impl.
        LaunchpadERC721A col = _create(_defaultConfig(0.01 ether, 5000));
        assertEq(col.accountImplementation(), accountImpl, "clone must use factory-fixed impl");
    }

    function test_OnlyOwnerCanSetAccountImplementation() public {
        address evil = address(new BenignAccount());
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, creator));
        factory.setAccountImplementation(evil);

        vm.prank(owner);
        factory.setAccountImplementation(evil);
        assertEq(factory.accountImplementation(), evil);
    }

    // ------------------------------------------------------------------ //
    //              Reentrancy on mint via malicious TBA funding          //
    // ------------------------------------------------------------------ //

    function test_ReentrancyOnMintBlocked() public {
        // A malicious swapper reenters mint() during TBA funding (a real untrusted
        // external call in the mint path). The transient-storage nonReentrant guard
        // must block it, reverting the whole transaction.
        ReentrantSwapper evil = new ReentrantSwapper();
        vm.prank(owner);
        factory.setSwapper(address(evil));

        uint256 price = 0.01 ether;
        MockERC20 equity = new MockERC20();
        LaunchpadTypes.CollectionConfig memory c = _defaultConfig(price, 5000);
        c.backingAsset = address(equity); // route funding through the swapper
        LaunchpadERC721A col = _create(c);

        evil.arm(address(col), 0, price);
        vm.deal(address(evil), price); // fund the reentry so it fails on the GUARD, not on balance

        vm.deal(alice, price);
        vm.prank(alice);
        bytes32[] memory none;
        vm.expectRevert(); // ReentrancyGuardReentrantCall bubbles up
        col.mint{value: price}(0, 1, none);

        assertEq(col.totalMinted(), 0, "no tokens should have minted");
    }

    // ------------------------------------------------------------------ //
    //                    Fee accounting invariants                       //
    // ------------------------------------------------------------------ //

    function testFuzz_FeeSplitConservation(uint96 priceRaw, uint16 fundingBps, uint8 qtyRaw) public {
        uint256 price = uint256(priceRaw) % 10 ether;
        vm.assume(price > 0);
        fundingBps = uint16(bound(fundingBps, 0, 10_000));
        uint256 qty = uint256(bound(qtyRaw, 1, 20));

        LaunchpadERC721A col = _create(_defaultConfig(price, fundingBps));
        uint256 cost = price * qty;
        vm.deal(alice, cost);
        vm.prank(alice);
        bytes32[] memory none;
        col.mint{value: cost}(0, qty, none);

        uint256 fundingPerToken = (price * fundingBps) / 10_000;
        uint256 tbaTotal;
        for (uint256 id = 1; id <= qty; ++id) {
            tbaTotal += col.accountOf(id).balance;
        }
        uint256 splitterBal = address(feeSplitter).balance;

        // Nothing is stranded in the collection; every wei is either in a TBA or
        // accrued in the splitter. Sum of accrued balances == splitter ETH.
        assertEq(address(col).balance, 0, "collection retained ETH");
        assertEq(tbaTotal, fundingPerToken * qty, "TBA funding mismatch");
        assertEq(tbaTotal + splitterBal, cost, "value not conserved");
        assertEq(
            feeSplitter.balanceOf(creator) + feeSplitter.balanceOf(protocol), splitterBal, "accrued != held"
        );
    }

    // ------------------------------------------------------------------ //
    //                      Dutch auction mint phase                       //
    // ------------------------------------------------------------------ //

    function _auctionCollection() internal returns (LaunchpadERC721A col, uint64 t0, uint64 t1) {
        t0 = uint64(block.timestamp);
        t1 = uint64(block.timestamp + 100); // 100s auction
        LaunchpadTypes.MintPhase[] memory ph = new LaunchpadTypes.MintPhase[](1);
        ph[0] = LaunchpadTypes.MintPhase({
            merkleRoot: bytes32(0),
            price: 1 ether, // start / ceiling
            endPrice: 0.1 ether, // floor
            startTime: t0,
            endTime: t1,
            perWalletCap: 0,
            maxMintable: 0
        });
        LaunchpadTypes.CollectionConfig memory c = _defaultConfig(1 ether, 5000);
        c.mintPhases = ph;
        col = _create(c);
    }

    function test_DutchAuctionPriceDecaysAndRefunds() public {
        (LaunchpadERC721A col, uint64 t0,) = _auctionCollection();

        // Halfway through: price is the midpoint (0.55 ETH).
        vm.warp(t0 + 50);
        uint256 expected = 1 ether - ((1 ether - 0.1 ether) * 50) / 100;
        assertEq(col.currentPrice(0), expected, "current price mismatch");

        // Overpay by sending the ceiling; expect a refund down to the live price.
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        bytes32[] memory none;
        col.mint{value: 1 ether}(0, 1, none);

        assertEq(col.ownerOf(1), alice);
        assertEq(alice.balance, 1 ether - expected, "overpayment not refunded");

        // TBA funded at the price actually paid.
        uint256 fundingPerToken = (expected * 5000) / 10_000;
        address tba = col.accountOf(1);
        assertEq(tba.balance, fundingPerToken, "TBA funded at wrong price");

        // Conservation: TBA + splitter hold exactly the price paid.
        assertEq(tba.balance + address(feeSplitter).balance, expected, "value not conserved");
        assertEq(address(col).balance, 0, "collection retained ETH");
    }

    function test_DutchAuctionNearFloorLateInWindow() public {
        (LaunchpadERC721A col,, uint64 t1) = _auctionCollection();
        vm.warp(t1 - 1); // last second the auction is live
        uint256 p = col.currentPrice(0);
        assertGe(p, 0.1 ether); // at/above the floor (the floor is the end asymptote)
        assertLe(p, 0.11 ether); // and essentially at it

        vm.deal(bob, p);
        vm.prank(bob);
        bytes32[] memory none;
        col.mint{value: p}(0, 1, none);
        assertEq(col.ownerOf(1), bob);
        assertEq(bob.balance, 0);
    }

    function test_DutchAuctionClosedAfterWindow() public {
        (LaunchpadERC721A col,, uint64 t1) = _auctionCollection();
        vm.warp(uint256(t1) + 1); // auction (and phase) is over
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        bytes32[] memory none;
        vm.expectRevert(LaunchpadERC721A.PhaseNotActive.selector);
        col.mint{value: 1 ether}(0, 1, none);
    }

    function test_DutchAuctionUnderpaymentReverts() public {
        (LaunchpadERC721A col, uint64 t0,) = _auctionCollection();
        vm.warp(t0 + 10); // price ~0.91 ETH
        vm.deal(alice, 0.5 ether);
        vm.prank(alice);
        bytes32[] memory none;
        vm.expectRevert(LaunchpadERC721A.IncorrectPayment.selector);
        col.mint{value: 0.5 ether}(0, 1, none);
    }

    // ---- helper to read the packed meta tuple ----
    function _meta(address col)
        internal
        view
        returns (
            address c_,
            address backing,
            uint96 roy,
            uint16 fund,
            uint256 max,
            bytes32 hash_,
            uint64 createdAt,
            bool exists
        )
    {
        return factory.collections(col);
    }
}
