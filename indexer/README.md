# Vessel indexer (Ponder)

The piece most people underestimate: **a token-bound account's contents are
on-chain but invisible to NFT metadata.** "This NFT holds $47 of NVDA" is not in
any `tokenURI` — it has to be *derived* by indexing balances per computed account
address. That's what this service does.

## What it indexes

- `CollectionCreated` from the factory — the primary event.
- `Transfer` from **every** collection the factory deploys, via Ponder's dynamic
  `factory()` registration (addresses aren't known ahead of time).
- `TokenBoundAccountFunded` — learns each token's TBA address and its opening
  balance.
- ERC-20 `Transfer` in/out of known TBAs (for collections with a backing asset).
- `SwapRewarded` from hook-attached pools.
- `Listed`/`Settled` from the marketplace guard, and `FeeSplitter` mint/claim
  events.

## What it derives

- Per-token TBA holdings (`tba_holding`) — the raw units; USD is applied in the
  pricing layer via Chainlink.
- Collection floor / volume / holder count / unique minters (denormalized counters
  + settled-sale rollups).
- **Trending, wash-trade-aware** — see `sql/views.sql`.
- Creator earnings and referral attribution.

## Trending — why not raw volume

Raw volume is wash-traded within a day of launch. `vw_trending` ranks on a
time-decayed blend of **unique buyers + holders + settled volume**, then multiplies
by `(1 - wash_penalty)`. The penalty comes from the transfer graph:

- **reciprocity** — the share of transfers that sit inside an `A↔B` back-and-forth
  loop (the classic wash pattern);
- **concentration** — few distinct wallets generating many transfers (a tight
  cluster trading with itself).

Volume is measured from *settled sales* (real ETH to a counterparty at a verified
price), not raw ERC-721 transfers — a much harder signal to fake. Rankings are SQL
views; the API never recomputes them.

The score also folds in **primary volume** — the ETH actually paid at mint (from the
collection's `Minted` event, post-refund, so Dutch-auction pricing is captured
exactly). A live drop or descending-price auction registers immediately, before any
secondary trade exists. Primary volume is decay-weighted like sales and co-weighted
with unique-minter breadth so a lone whale self-minting can't run away with the
ranking. See `sql/views.sql` (`mints` CTE + `vw_trending`).

## Run

```bash
cp .env.example .env      # fill in FACTORY_ADDRESS etc. from the Foundry deploy
pnpm install
pnpm codegen              # generate types from ponder.config + ponder.schema
pnpm dev                  # index + serve API on :42069
# after the schema is live, install the ranking views:
psql "$DATABASE_URL" -f sql/views.sql
```

Locally Ponder uses pglite (no Postgres needed). For production set `DATABASE_URL`
to a Supabase Postgres connection string.

## API (over the views)

| Endpoint | Purpose |
|---|---|
| `GET /trending?limit=&backing=` | Explore grid, wash-discounted, optional backing-asset filter |
| `GET /collections/:address` | Collection metrics + tokens |
| `GET /tokens/:collection/:tokenId` | **Token + its TBA holdings** (the differentiated view) |
| `GET /portfolio/:owner` | All held tokens + aggregate TBA holdings |
| `GET /creators/:address` | Created collections + earnings |
