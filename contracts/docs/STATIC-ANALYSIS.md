# Static analysis — Slither triage

Slither (`slither . --config-file slither.config.json`, dependencies filtered out)
is run in CI and was run locally during development. This document records how each
detector class was resolved: **fixed**, or **acknowledged** with rationale.

**Current state: 51 results, of which 0 are High or Medium severity.** Every
remaining finding is Low/Informational and either design-inherent or intentional.
CI (`fail-on: high`) passes. All 79 Foundry tests remain green.

The bonding-curve engine (`BondingCurve`, `LaunchToken`) is under the same bar:
`arbitrary-send-eth` (the owner-configured SushiSwap seeder at graduation) and
`reentrancy-eth` (in `_buy`, reached only via the `nonReentrant` `buy`/`launch`
entrypoints, state updated before external calls) are guarded/trusted false
positives, annotated inline with justification.

The coin + SushiSwap market layer (`CollectionCoin`, `CoinFactory`,
`SushiMarketDeployer`) was added under this same bar:
- `unchecked-transfer` — cleared by using OpenZeppelin `SafeERC20`
  (`safeTransferFrom`/`safeTransfer`/`forceApprove`) in `SushiMarketDeployer`.
- `reentrancy-no-eth` on `CoinFactory.enableMarket` — cleared by a CEI reorder.
- `arbitrary-send-eth` on `SushiMarketDeployer.createMarket` (the ETH-dust refund to
  `msg.sender`) and `reentrancy-no-eth` on `CollectionCoin.deposit`/`redeem` — these
  are guarded/caller-safe (the transient `nonReentrant` guard is not modelled by
  Slither), annotated inline with justification.

## Fixed

| Detector | Where | Fix |
|---|---|---|
| `shadowing-local` | `interfaces/IERC6551Registry.sol` | Renamed return param `account` → `accountAddress` (no longer shadows the `account()` function). |
| `missing-zero-check` | `TBAGuard` constructor | Reverts `ZeroAddress` on zero `registry`/`accountImplementation`. |
| `missing-zero-check` | `LaunchpadERC721A.rescueETH` | Reverts on `to == address(0)`. |
| `uninitialized-local` | `FeeSplitter.depositSplits` | `sum` explicitly initialized to 0. |
| `unindexed-event-address` | `FeeSplitter.ProtocolFeeUpdated` | `recipient` marked `indexed`. |
| `reentrancy-benign` | `CollectionFactory.createCollection` | Reordered to checks-effects-interactions: registry writes now precede the `initialize()` call. |

## Acknowledged (justified, annotated inline with `slither-disable-next-line`)

- **`arbitrary-send-eth`** — `LaunchpadERC721A._fundTokenAccount`. The ETH
  destinations are (a) the **deterministic ERC-6551 account** for the token,
  derived from the canonical registry, and (b) the **owner-configured swapper**
  adapter. Neither is attacker-supplied, so this High is a false positive for the
  funding pattern. (The production swapper must enforce oracle-based slippage — see
  `AUDIT.md` §4.)
- **`divide-before-multiply`** — `mint`: `fundingPerToken = price*bps/1e4` then
  `*quantity`. Intentional: each TBA receives exactly the floored per-token amount
  and proceeds are the exact remainder, so value is conserved to the wei
  (`testFuzz_FeeSplitConservation`).
- **`incorrect-equality`** — `rescueETH`'s `bal == 0` guard. Comparing a balance to
  zero for a "nothing to rescue" check is safe.
- **`unused-return`** — `LaunchpadHook.flushLockedLiquidity`/`unlockCallback` ignore
  the return of `unlock`/`donate`/`settle`. The donate is balanced by the explicit
  `sync` + `transfer` + `settle` that follows; the returned values are not needed.

## Acknowledged (design-inherent, left as-is — all Low/Informational)

- **`missing-zero-check`** — `CollectionFactory.setSwapper(address(0))` is
  **intentionally** allowed: passing the zero address disables atomic swaps so TBAs
  simply hold ETH. Not a defect.
- **`timestamp`** — mint phase windows and listing expiry compare against
  `block.timestamp`. Second-level validator drift is acceptable for these gates.
- **`calls-loop`** — `mint` funds one TBA per token, and `TBAGuard` reads one
  `balanceOf` per declared asset, inside loops. This is inherent to per-token
  accounts and per-asset snapshots; bounds are the mint quantity (per-wallet caps)
  and `MAX_ASSETS = 32`.
- **`reentrancy-benign` / `reentrancy-events`** — `LaunchpadHook.afterSwap` writes
  reward state after `poolManager.take`. `afterSwap` is only callable by the
  PoolManager (`onlyPoolManager`) inside its own lock and cannot be re-entered by a
  third party; effects follow a trusted-callee call.
- **`low-level-calls`** — deliberate `.call{value:}` for ETH transfers (pull
  payments and TBA funding), the standard pattern.
- **`cyclomatic-complexity`** — `mint` (13): phase/allowlist/cap/supply checks in one
  function; readable and fully branch-tested.
- **`missing-inheritance`** — Slither suggests `CollectionFactory` inherit the
  `ICollectionFactoryLike` shape declared inside `LaunchpadHook`. That interface is a
  local convenience for the hook's referral check; the factory already exposes the
  `isCollection` selector it needs. Informational only.

## Aderyn

The CI also runs Aderyn (`aderyn .`). It requires a Rust toolchain to install
locally; where unavailable, rely on the CI job. Any new Aderyn findings are triaged
into this document before mainnet.
