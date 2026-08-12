# Vessel — audit-readiness package

Prepared for an external security audit **before** any mainnet deployment. This
document is the map an auditor needs: scope, trust model, invariants, external
dependencies, and the specific places we most want scrutinized.

> Status: **not yet audited.** The contracts are extensively unit- and
> integration-tested (55 tests) but have received no external review. Do not deploy
> to mainnet on the strength of the internal tests alone.

## 1. Scope

Solidity `0.8.26`, EVM `cancun` (uses transient storage). In scope:

| File | Role | Privileged? |
|---|---|---|
| `src/CollectionFactory.sol` | EIP-1167 clone factory + registry | Owner (platform) |
| `src/LaunchpadERC721A.sol` | Cloneable collection; mint + TBA funding | Creator (per collection) |
| `src/LaunchpadHook.sol` | Uniswap V4 hook (snipe tax, fee lock, splits) | Immutable config; permissionless ops |
| `src/TBAGuard.sol` | Marketplace guard (snapshot-on-list) | None |
| `src/FeeSplitter.sol` | Pull-payment fee accrual | Owner (fee params) |
| `src/CollectionCoin.sol` | Fungible NFT vault (deposit/redeem), 1 NFT = 1 coin | None |
| `src/CoinFactory.sol` | Permissionless coin deployment per collection | Owner (impl/deployer) |
| `src/SushiMarketDeployer.sol` | Seeds a SushiSwap (UniV2) coin/ETH pool | None (non-custodial) |
| `src/libraries/SnipeTax.sol` | Pure decay curve | — |
| `src/libraries/RewardSplit.sol` | Pure fee-split math | — |
| `src/LaunchpadTypes.sol` | Structs | — |

Out of scope (dependencies, assumed sound): OpenZeppelin v5.1, ERC721A-Upgradeable
v4.3, the ERC-6551 reference registry + account, Uniswap v4-core.

## 2. Trust model & roles

- **Factory owner** (should be a multisig + timelock): sets `collectionImplementation`,
  `accountImplementation`, `feeSplitter`, `swapper`, `accountSalt` — for **future**
  clones only. Already-deployed clones captured their references at `initialize`
  and are unaffected by later changes. The owner cannot mint, cannot move user
  funds, and cannot alter a live collection's economics.
- **Collection creator**: per-collection admin — `setBaseURI`, `setContractURI`,
  `rescueETH`. Cannot change supply, price, phases, or funding after deploy.
- **FeeSplitter owner**: sets `protocolFeeBps` and `protocolRecipient`.
- **TBAGuard**: no privileged roles at all.

No logic upgradeability: clones are EIP-1167 minimal proxies delegating to a single
fixed implementation; there is no proxy admin or `upgradeTo`.

## 3. Core invariants (targets for fuzzing / formal review)

1. **Mint value conservation**: for any mint, `Σ(TBA funding) + splitter proceeds == msg.value`, and `address(collection).balance == 0` afterwards. (fuzzed: `testFuzz_FeeSplitConservation`)
2. **Fee-split conservation**: `RewardSplit.split` outputs always sum to `fee`, no wei leak, for any inputs. (fuzzed: `testFuzz_NoWeiLeaks`)
3. **Account-implementation integrity**: the factory never reads the 6551 account implementation from creator input; every clone uses the owner-set impl.
4. **Drain defence**: `TBAGuard.settle` reverts unless every declared asset (and ETH) in the TBA is `>=` its listing snapshot.
5. **Snipe-tax monotonicity**: `SnipeTax.feePips` is non-increasing in elapsed time and always within `[baseFee, maxFee]`; never reverts.
6. **Reentrancy**: `mint`, `FeeSplitter.claim`, `TBAGuard.settle`/`withdraw`, `LaunchpadHook.claim` are `nonReentrant` (transient-storage guard) and follow checks-effects-interactions.

## 4. Areas we most want scrutinized

- **Hook `afterSwap` settlement** (`LaunchpadHook.afterSwap` + `unlockCallback`).
  It takes a fee on the output currency via `poolManager.take` and returns a
  positive `int128` delta; `flushLockedLiquidity` donates via `unlock`→`donate`→
  `sync`→`settle`. Integration-tested against a live PoolManager, but the exact-
  output path is deliberately skipped (`amountSpecified >= 0` early-return) — please
  confirm no delta mismatch or stuck-balance edge case, and that skipping
  exact-output cannot be abused to dodge fees.
- **Swapper slippage**: `LaunchpadERC721A._fundTokenAccount` calls
  `swapper.swapETHForAsset(asset, tba, 0)` with `minAmountOut = 0`. Slippage
  protection is delegated to the adapter. **The production adapter MUST enforce a
  Chainlink-derived `minAmountOut`**; a naive adapter here is a sandwich vector.
  Auditors should treat the adapter as security-critical and in-scope for the
  deployed instance.
- **Merkle leaf encoding**: `mint` uses `keccak256(bytes.concat(keccak256(abi.encode(sender))))`
  with sorted-pair hashing — must match the off-chain `@openzeppelin/merkle-tree`
  `StandardMerkleTree` used by the allowlist service. Confirm no second-preimage /
  sorted-pair ambiguity.
- **TBAGuard griefing**: a seller can drain post-listing to force a buyer's `settle`
  to revert (funds-safe, gas-only griefing). Documented in `docs/TBAGuard.md` §5 —
  confirm no path lets a drain also complete the sale.
- **6551 assumptions**: correctness depends on the canonical registry at
  `0x000000006551c19487814612e58FE06813775758` and the fixed account impl. Confirm
  the deployed account impl cannot be induced to drain on transfer.
- **Coin vault (`CollectionCoin`)**: 1 NFT = 1 coin, deposit/redeem. Confirm the
  held-id bookkeeping (`_held`/`_heldIndex` swap-and-pop) can't desync from custody,
  that `redeem` burns before transferring (it does), and that a fee-on-transfer or
  reentrant collection can't break the invariant `heldCount * UNIT == totalSupply`.
  Reentrancy is guarded with the transient guard (Slither doesn't model it — see
  `STATIC-ANALYSIS.md`).
- **`SushiMarketDeployer`**: non-custodial seeder. Confirm dust refunds and that
  `minTokenOut`/`minEthOut` are surfaced to the caller (the UI should not pass 0 on
  mainnet). The router/factory are trusted (SushiSwap on the target chain).
- **`rescueETH`**: creator can sweep the collection's ETH balance. Proceeds normally
  leave in the same tx, so this should always be ~0 — confirm it can't capture
  in-flight mint funds.

## 5. Test coverage (internal)

55 tests across `test/` — clone economics, mint + TBA funding, atomic swap,
reentrancy-on-mint, Merkle allow/deny, malicious-impl rejection, fee invariants
(fuzzed), the full drain-before-transfer matrix, snipe-tax boundary conditions
(block 0 / 1 / 10s / after), reward-split conservation (fuzzed), and a live V4
PoolManager integration (init → liquidity → swap → fee → split → donate).

Reproduce: `cd contracts && forge test -vvv`.

## 6. Deployment & operational security

- Deploy the factory/splitter **owner as a multisig behind a timelock**; the single
  privileged surface is future-clone configuration and protocol-fee params.
- Verify all contracts on the explorer (see `DEPLOY.md`).
- Wire only an audited swapper adapter with oracle-based slippage before enabling
  atomic backing-asset swaps; until then leave `swapper = address(0)` (TBAs hold ETH).
- Run this repo's CI (`forge test`, `forge fmt --check`, Slither, Aderyn) green, and
  resolve every audit finding, before mainnet.
