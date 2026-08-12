# Production environment variables

Signapad is live on **Robinhood Chain mainnet (chain 4663)**, contracts deployed at
block **34671304**. Copy each block into the matching dashboard. Contract addresses
are public (on-chain), so they are safe to store as plain env vars.

---

## 1) Vercel — the `web` frontend

Project → **Settings → General → Root Directory** = `web`
Project → **Settings → Environment Variables** (Production + Preview):

```
NEXT_PUBLIC_CHAIN_ID=4663
NEXT_PUBLIC_RPC_URL=https://rpc.mainnet.chain.robinhood.com
NEXT_PUBLIC_FACTORY=0xE9f3C226EB834f57caC14e63a4f9f63f68DcCCCe
NEXT_PUBLIC_TOKEN_LAUNCHER=0xB43F644d78e230BDe09217c83e15175c3CEfE48e
NEXT_PUBLIC_GUARD=0xFCAEDB4B770AB46cE316138F08e20c71a40E534b
NEXT_PUBLIC_FEE_SPLITTER=0x9C38eF1F37574d658A15865128945B8621291e86
NEXT_PUBLIC_COIN_FACTORY=0x50F14380495989353865bDa4Da9df2E7A38FE292
NEXT_PUBLIC_MARKET_DEPLOYER=0x600803023700743b7a697ED3909c58598dE763CB
NEXT_PUBLIC_LIQUIDITY_LAUNCHER=0xAE1da370c817D10cA2a3DA913A6aBC3Ed87756e5
NEXT_PUBLIC_BONDING_CURVE=0x515402397d263a42D3053C0b3C4bbD2C1aA27587
```

Set **after** Railway is live (below):
```
NEXT_PUBLIC_API_URL=https://<your-railway-indexer-domain>
```

Optional:
```
# Reown/WalletConnect id (https://cloud.reown.com). Without it, browser wallet only.
NEXT_PUBLIC_WC_PROJECT_ID=
# Metadata/SIWE service, only if you host services/ somewhere.
NEXT_PUBLIC_SERVICES_URL=
```

Then **Deployments → ⋯ → Redeploy**.

---

## 2) Railway — the `indexer` (token-board data)

Service → **Settings → Root Directory** = `indexer`
(the committed `indexer/railway.json` sets the build + start command)

Add a **PostgreSQL** database (New → Database → PostgreSQL), then set the service
**Variables**:

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
CHAIN_ID=4663
ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com
START_BLOCK=34671304
FACTORY_ADDRESS=0xE9f3C226EB834f57caC14e63a4f9f63f68DcCCCe
GUARD_ADDRESS=0xFCAEDB4B770AB46cE316138F08e20c71a40E534b
FEE_SPLITTER_ADDRESS=0x9C38eF1F37574d658A15865128945B8621291e86
COIN_FACTORY_ADDRESS=0x50F14380495989353865bDa4Da9df2E7A38FE292
MARKET_DEPLOYER_ADDRESS=0x600803023700743b7a697ED3909c58598dE763CB
BONDING_CURVE_ADDRESS=0x515402397d263a42D3053C0b3C4bbD2C1aA27587
TOKEN_LAUNCHER_ADDRESS=0xB43F644d78e230BDe09217c83e15175c3CEfE48e
```

Then **Settings → Networking → Generate Domain** so Vercel can reach it, and put
that domain into Vercel's `NEXT_PUBLIC_API_URL`.

`PORT` is injected by Railway automatically; the start command
(`pnpm start -- --port $PORT`) binds Ponder to it.
