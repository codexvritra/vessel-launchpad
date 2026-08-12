# Vessel

**A permissionless NFT launchpad where every token is a wallet.**

Vessel is a launchpad protocol for Robinhood Chain (an Ethereum L2 on the Arbitrum
stack). Anyone can deploy an NFT collection in one transaction. The twist: on mint,
each token id is paired with its own [ERC-6551](https://eips.ethereum.org/EIPS/eip-6551)
token-bound account, and a configurable slice of the mint price is routed straight
into that account — optionally swapped into a backing asset in the same transaction.

So a Vessel token isn't a JPEG with a price. It's a wallet with assets in it, wrapped
in an NFT you can trade.

> **Design lineage & licensing.** The launchpad *mechanics* (cheap clone factory,
> phased mints, a snipe-tax/fee-lock/reward-split trading hook, referral splits) are
> reimplemented from public documentation of content-coin launchpads. No third-party
> protocol's contract source was copied; those carry their own licenses. Vessel keeps
> the **NFT + token-bound-account** primitive instead of tokenizing content as fungible
> ERC-20s — that is the substantive product difference, not a cosmetic one. All
> branding, naming, and copy are original.

> **Legal posture.** This repository targets **testnet + a public writeup only**.
> Taking a fee to help other people issue asset-backed NFTs to the public has
> investment-venue characteristics and is regulated (in Australia, ASIC's territory).
> Do not point `backingAsset` at a real tokenized security and do not deploy to
> mainnet without a professional legal consultation first. On testnet the backing
> asset is a mock ERC-20.

---

## Status

| Phase | Component | State |
|---|---|---|
| 1 | `CollectionFactory` (EIP-1167 clones, fixed 6551 impl) | ✅ built + tested |
| 1 | `LaunchpadERC721A` (phases, merkle, TBA funding, Dutch-auction pricing) | ✅ built + tested |
| 1 | `FeeSplitter` (pull payments) | ✅ built + tested |
| 1 | `CollectionCoin` + `CoinFactory` + `SushiMarketDeployer` + `LiquidityLauncher` (Zora-style coin vault → one-click SushiSwap liquidity; auto-enable at creation) | ✅ built + tested |
| 1 | `TBAGuard` (snapshot-on-list, drain defence) | ✅ built + tested + [written up](contracts/docs/TBAGuard.md) |
| 1 | `LaunchpadHook` (V4: snipe tax, fee lock, reward splits) | ✅ built; unit + **live PoolManager integration** tested |
| 1 | Deploy + flagship-seed scripts | ✅ verified on live anvil |
| 2 | Ponder indexer + wash-trading-aware trending | ✅ built; codegen + typecheck clean |
| 3 | Metadata / API / SIWE / Redis | 🔜 API done (in indexer); metadata/auth/redis planned |
| 4 | Next.js frontend (6 screens) | 🔜 in progress |
| 5 | Testnet deploy, verification, CI (Slither/Aderyn) | ⬜ CI written; deploy needs RPC + key |

**Before mainnet** (hard gates, see [DEPLOY.md](DEPLOY.md)): (1) testnet E2E, (2)
static analysis green ([Slither config](contracts/slither.config.json)), (3) an
external **security audit** ([audit package](contracts/docs/AUDIT.md)), and (4) a
**legal opinion** from counsel ([briefing](LEGAL.md)). Mainnet is not code-gated —
it is audit- and legal-gated.

**50/50 contract tests passing.** The end-to-end deploy → mint → verify-funded-TBA
loop runs on a live chain (see below), and the V4 hook is exercised against a real
PoolManager (init → add liquidity → swap → snipe-tax fee → split → donate).

## Repository layout

```
contracts/   Foundry project — the protocol (Phase 1)
indexer/     Ponder indexer + SQL views (Phase 2)
services/    Metadata + API + auth (Phase 3)
web/         Next.js 15 app (Phase 4)
```

## The core economic thesis, in numbers

From `test/CoreFlow.t.sol:test_CloneIsCheap`:

```
raw EIP-1167 clone deploy gas   :    43,382
full implementation deploy gas  : 2,699,474
createCollection (clone+init)   :   651,638
```

Deploying a fresh ERC-721A per collection (~2.7M gas) makes an open launchpad
uneconomical. Cloning an audited implementation (~43k gas for the proxy itself)
is what makes "anyone can launch" viable. The factory clones; it never redeploys.

## Security invariants (non-negotiable)

- **The 6551 account implementation is factory-fixed.** The creator config struct
  has *no* account-implementation field. A malicious account impl could drain a
  token's TBA on transfer; allowing creators to supply one would make the platform
  a rug factory. Only the factory owner can change it.
- **Pull payments everywhere.** Mint proceeds, swap rewards, and sale proceeds are
  credited to internal balances and withdrawn by the beneficiary. Push-to-arbitrary
  is a griefing/reentrancy vector.
- **Reentrancy guarded on mint** via transient storage (EVM Cancun), which needs no
  per-clone init.
- **Fee conservation.** Every wei of a mint is either in a token's TBA or accrued in
  the splitter — nothing is stranded, no rounding leaks (fuzz-tested).
- **Drain-before-transfer** is defended by `TBAGuard` — [full writeup](contracts/docs/TBAGuard.md).

## Quickstart (contracts)

```bash
cd contracts
forge build
forge test -vv
```

Run the whole loop on a local node:

```bash
# terminal 1
anvil

# terminal 2
cd contracts
forge script script/Deploy.s.sol:Deploy \
  --rpc-url http://127.0.0.1:8545 \
  --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 --unlocked --broadcast

export FACTORY=<CollectionFactory address printed above>
forge script script/SeedFlagship.s.sol:SeedFlagship \
  --rpc-url http://127.0.0.1:8545 \
  --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 --unlocked --broadcast
```

The seed script deploys the flagship collection **"Vessel Founders"**, mints a
batch, and asserts every token-bound account is funded — the cold-start seed for a
two-sided marketplace.

### Prove the whole journey in one command

`script/LocalDemo.s.sol` deploys the full stack (with a mock SushiSwap router) and
runs the complete flow with assertions: **create a collection (coin market
auto-enabled) → mint (each token's 6551 wallet funded) → one-click provide liquidity
(NFTs → coins → a seeded SushiSwap pool).**

```bash
# with anvil running on :8546
forge script script/LocalDemo.s.sol:LocalDemo \
  --rpc-url http://127.0.0.1:8546 \
  --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 --unlocked --broadcast
```

Verified output: collection + auto-enabled coin deployed, token #1 TBA funded with
0.005 ETH, SushiSwap pair created with 3 coins + 1 ETH of liquidity.

## Chain facts (Robinhood Chain)

- Gas token is ETH; no native chain token.
- ~100ms blocks; 7-day L1 withdrawal (standard optimistic rollup).
- Uniswap V2/V3/V4 + UniswapX and Chainlink oracles are live.
- Canonical ERC-6551 registry at `0x000000006551c19487814612e58FE06813775758`
  (deterministic across EVM chains).

## Dependencies

OpenZeppelin v5.1 · ERC721A (upgradeable) v4.3 · ERC-6551 reference · Uniswap v4-core.
Solidity 0.8.26, EVM `cancun`.
