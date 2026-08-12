# Vessel services

Backend services layer: metadata, auth, IPFS, pricing, and the cache/rate-limit
substrate. Built on Hono (Node).

## What's here

- **Metadata (EIP-7572 + per-token).** `GET /contract/:address` and
  `GET /token/:collection/:tokenId`. The token document folds the NFT's
  token-bound-account holdings in as attributes with a live **USD total** (via
  Chainlink), so any marketplace reading `tokenURI` shows "this NFT holds $X".
  Cached aggressively — `tokenURI` is hit constantly.
- **Auth — Sign-In With Ethereum (EIP-4361).** `GET /auth/nonce`,
  `POST /auth/verify`, `GET /auth/me`, `POST /auth/logout`. No passwords, no
  email. Verified sessions are HS256 JWTs in an httpOnly cookie.
- **IPFS (Pinata).** `POST /pin/json`, `POST /pin/file` — auth-gated so only a
  signed-in creator can pin collection art/metadata.
- **Pricing.** Chainlink aggregator reads via viem, mapping asset → feed from
  `PRICE_FEEDS`. Powers the USD values above.
- **Cache + rate limit (Redis).** Per-IP fixed-window limiter and a cache-aside
  helper, both with an in-memory fallback so local dev runs without Redis. Do not
  run production without `REDIS_URL`.

## Run

```bash
cp .env.example .env    # set INDEXER_API_URL, SESSION_SECRET, PINATA_JWT, PRICE_FEEDS...
pnpm install
pnpm dev                # http://localhost:8080
```

`tokenURI` on a collection should point its base at
`https://<this-service>/token/<collection>/` so tokens resolve here, with the
contract's on-chain fallback covering any downtime.

## Endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/contract/:address` | – | EIP-7572 contract metadata |
| GET | `/token/:collection/:tokenId` | – | ERC-721 metadata + TBA holdings + USD |
| GET | `/auth/nonce` | – | SIWE nonce |
| POST | `/auth/verify` | – | SIWE verify → session cookie |
| GET | `/auth/me` | cookie | current address or null |
| POST | `/pin/json` · `/pin/file` | session | pin to IPFS |
