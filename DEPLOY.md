# Vessel — testnet deploy runbook (Phase 5)

End-to-end: deploy contracts → verify → wire the indexer/services/frontend → seed
the flagship → run the full loop in a browser.

> **Robinhood Chain is live and wired.** Verified network details:
> | | Chain ID | Public RPC | Explorer |
> |---|---|---|---|
> | Testnet | `46630` | `https://rpc.testnet.chain.robinhood.com` | `explorer.testnet.chain.robinhood.com` |
> | Mainnet | `4663` | `https://rpc.mainnet.chain.robinhood.com` | `robinhoodchain.blockscout.com` |
>
> The canonical ERC-6551 registry is confirmed deployed on testnet, and the full
> create → mint → TBA-funded flow **passes as a fork test against the live testnet**
> (`forge test --match-path test/Fork.t.sol --fork-url https://rpc.testnet.chain.robinhood.com`).
>
> **The only thing that must come from you** is a **funded deployer key**, which you
> hold yourself (import it into Foundry's keystore; it never enters this repo or is
> handled by anyone else). Fund it from the testnet faucet first. An Alchemy key is
> recommended over the rate-limited public RPC.

## 0. Prerequisites

- Foundry, Node 20+ (the indexer needs Ponder ≥ 0.17 for Node 24), pnpm.
- A funded deployer account on the target chain.

## Turnkey runner (recommended)

The whole contract deploy is wrapped in `contracts/script/deploy.sh`, which reads a
gitignored `.env.<network>` file and uses Foundry's **keystore** (`--account`) so
your private key is never in env, in this repo, or visible to anyone.

```bash
cd contracts

# 1. Import your deployer key ONCE into Foundry's encrypted keystore:
cast wallet import vessel-deployer --interactive

# 2. Configure the network:
cp .env.testnet.example .env.testnet     # fill in RPC, PROTOCOL_RECIPIENT, explorer creds
#   (DEPLOYER_ACCOUNT defaults to "vessel-deployer" to match step 1)

# 3. Deploy + verify + seed the flagship in one go:
./script/deploy.sh testnet --seed
```

For mainnet, `./script/deploy.sh mainnet` **refuses to broadcast** unless every gate
in `.env.mainnet` (`AUDIT_COMPLETE`, `LEGAL_OPINION`, `TESTNET_VERIFIED`,
`OWNER_IS_MULTISIG`) is set to `yes` and you type an explicit confirmation. This is
deliberate: mainnet is audit- and legal-gated, not code-gated.

The manual, step-by-step equivalents follow.

## 1. Deploy the contracts

```bash
cd contracts
export ROBINHOOD_TESTNET_RPC_URL=<your testnet rpc>
export PROTOCOL_RECIPIENT=<your protocol fee address>

forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$ROBINHOOD_TESTNET_RPC_URL" \
  --private-key "$PK" \
  --broadcast --slow
```

Note the printed addresses: `CollectionFactory`, `LaunchpadERC721A` (impl),
`FeeSplitter`, `TBAGuard`, `AccountImpl(6551)`, `Registry(6551)`.

On a chain that already has the canonical registry at
`0x000000006551c19487814612e58FE06813775758`, the script reuses it automatically.

## 2. Verify on the explorer

```bash
forge verify-contract <ADDRESS> src/CollectionFactory.sol:CollectionFactory \
  --verifier-url "$EXPLORER_API_URL" --etherscan-api-key "$EXPLORER_API_KEY" \
  --constructor-args $(cast abi-encode "constructor(address,address,address,address,address)" \
     <owner> <registry> <collectionImpl> <accountImpl> <feeSplitter>)
```

Repeat for each contract (adjust the constructor-args signature per contract; the
impl, FeeSplitter, and TBAGuard have their own).

## 3. Wire the services

Fill each `.env` from the deploy output:

- `indexer/.env`: `FACTORY_ADDRESS`, `GUARD_ADDRESS`, `FEE_SPLITTER_ADDRESS`,
  `HOOK_ADDRESS` (if a hook pool is live), `ROBINHOOD_RPC_URL`, `CHAIN_ID`,
  `START_BLOCK` (the deploy block), `DATABASE_URL` (Supabase), `BACKING_ASSETS`.
- `services/.env`: `INDEXER_API_URL`, `REDIS_URL`, `SESSION_SECRET`, `PINATA_JWT`,
  `PRICE_FEEDS` (asset→Chainlink aggregator, incl. the ETH feed under the zero
  address), `ROBINHOOD_RPC_URL`.
- `web/.env.local`: `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_RPC_URL`,
  `NEXT_PUBLIC_WS_RPC_URL` (enables true event push — new collections, mints, TBA
  funding), `NEXT_PUBLIC_FACTORY`, `NEXT_PUBLIC_GUARD`, `NEXT_PUBLIC_FEE_SPLITTER`,
  `NEXT_PUBLIC_API_URL` (the indexer), `NEXT_PUBLIC_SERVICES_URL` (metadata + allowlist
  proofs), `NEXT_PUBLIC_WC_PROJECT_ID`.

## 4. Start indexer + services

```bash
cd indexer && pnpm install && pnpm codegen && pnpm start &   # indexes + serves :42069
psql "$DATABASE_URL" -f sql/views.sql                        # install ranking views
cd ../services && pnpm install && pnpm start &               # metadata/auth :8080
```

## 5. Seed the flagship (cold start)

```bash
cd contracts
export FACTORY=<CollectionFactory address>
export METADATA_BASE="https://<services-host>/token/"   # so tokenURI resolves live
forge script script/SeedFlagship.s.sol:SeedFlagship \
  --rpc-url "$ROBINHOOD_TESTNET_RPC_URL" --private-key "$PK" --broadcast
```

This deploys "Vessel Founders", mints a batch, and asserts every token-bound
account is funded — the two-sided market is no longer empty.

## 6. End-to-end acceptance checklist

- [ ] `createCollection` from the Create page deploys a clone (~50k-gas proxy).
- [ ] Mint from the Collection page; tx succeeds; supply counter increments.
- [ ] Token page shows the NFT **and** its funded TBA balance with a USD value.
- [ ] Indexer `/tokens/:c/:id` returns holdings; `/trending` ranks the collection.
- [ ] List a token on `TBAGuard`, then attempt a drain → settlement reverts.
- [ ] (If a hook pool is live) a swap in the first 10s pays the snipe tax; rewards
      accrue and `claim`/`flushLockedLiquidity` work.
- [ ] Creator can `claim()` mint earnings from `FeeSplitter`.
- [ ] Create an allowlist phase with an address list; the on-chain root matches the
      client-computed root, and a listed address gets a valid proof from
      `GET /allowlist/proof` while a non-listed one is rejected at mint.
- [ ] With `NEXT_PUBLIC_WS_RPC_URL` set, a mint on one browser bumps the supply
      meter live on another without a manual refresh.

## 7. Hosting

- **Frontend** → Vercel (`web/`). Set the `NEXT_PUBLIC_*` env in the project.
- **Indexer** → Railway or Fly (`indexer/`), with the Supabase Postgres.
- **Services** → Railway/Fly (`services/`), with Redis.

## CI gate before mainnet

`.github/workflows/contracts.yml` runs `forge test`, `forge fmt --check`,
**Slither**, and **Aderyn**. Fix everything to green before even considering a
mainnet deploy — and get the legal consultation first.
