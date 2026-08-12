# Vessel — web

The frontend for **Vessel**, a permissionless NFT launchpad where every NFT owns
an ERC-6551 token-bound account (TBA) funded at mint. An NFT here is a wallet
with assets inside it — the art is the certificate, the value is held within.

## Design direction

The UI deliberately rejects the default dark-mode-purple neon-gradient
glassmorphism crypto look. Instead it is a **financial passbook / letterpress
almanac / stock certificate**:

- **Warm paper palette**, light-first: cream `#F5F1E8`, surface `#FBF8F1`, ink
  `#1A1714`, muted `#6B6459`. Single vermilion accent `#D4462A`; a sparse deep
  teal `#1F4E46` for positive/value figures. Hairline rules `#D8D0C0`.
- **Dark "ink paper" theme** (`#16130F` background) via
  `prefers-color-scheme` plus a `data-theme` toggle in the header.
- **Typography**: robust system serif stack (`Georgia, 'Times New Roman', serif`)
  for display headings — no external fonts (the environment is offline / CSP
  strict). Monospace with **tabular numerals** for every money/number figure.
  Clean system sans for body.
- **Motifs**: thin double-rules under section headers, certificate-style borders
  on token cards, uppercase small-caps ledger labels with letter-spacing,
  ruled ledger tables, generous whitespace. Numbers are the hero.

The design system lives entirely in `app/globals.css` using Tailwind CSS v4's
CSS-first approach (`@import "tailwindcss";` + `@theme` + runtime CSS variables)
— there is no `tailwind.config.js` theme.

## Screens

| Route | Purpose |
| --- | --- |
| `/` | Explore / trending — ranked collection grid, backing-asset filter, wash-trust indicator |
| `/create` | No-code multi-step collection deployment → `CollectionFactory.createCollection` |
| `/collection/[address]` | Phase-aware mint widget, live supply, holder ledger, verification badge |
| `/token/[collection]/[id]` | The differentiated screen — the NFT and its TBA contents with live USD value |
| `/profile/[address]` | Created collections + held tokens + claimable earnings |
| `/portfolio/[address]` | Aggregate TBA value across all held tokens |

## Stack

Next.js 15 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS v4 ·
wagmi + viem · RainbowKit · @tanstack/react-query · pnpm.

## Getting started

```bash
pnpm install
cp .env.example .env.local   # optional — every var has a safe default
pnpm dev                     # http://localhost:3000
```

Build & typecheck:

```bash
pnpm build
pnpm exec tsc --noEmit
```

The app is built to **render even with no chain, indexer, or wallet available**.
Every data fetch has a graceful fallback (skeletons + empty states) and never
throws during SSR/build. Dynamic screens use `export const dynamic = "force-dynamic"`
and client components so the build never statically fetches live data.

## Environment variables

All are `NEXT_PUBLIC_*` and have sane fallbacks (see `.env.example`):

| Var | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_CHAIN_ID` | `31337` | Chain id for the "Robinhood Chain" viem definition |
| `NEXT_PUBLIC_RPC_URL` | `http://127.0.0.1:8545` | JSON-RPC endpoint |
| `NEXT_PUBLIC_FACTORY` | `zeroAddress` | `CollectionFactory` address |
| `NEXT_PUBLIC_GUARD` | `zeroAddress` | `TBAGuard` address |
| `NEXT_PUBLIC_FEE_SPLITTER` | `zeroAddress` | `FeeSplitter` address |
| `NEXT_PUBLIC_API_URL` | `http://localhost:42069` | Indexer (Ponder) REST base |
| `NEXT_PUBLIC_WC_PROJECT_ID` | placeholder | WalletConnect Cloud project id |

When a contract address is the zero address, the relevant on-chain action is
disabled with an explanatory notice rather than failing (e.g. deploy is gated on
`NEXT_PUBLIC_FACTORY`).

## Data + realtime

`lib/api.ts` is a small typed client for the indexer's REST endpoints
(`/trending`, `/collections/:a`, `/tokens/:c/:id`, `/portfolio/:owner`,
`/creators/:a`). Every call is wrapped in `try/catch` and returns an empty
default, so a down indexer degrades to empty states.

Freshness is achieved with react-query `refetchInterval` polling (15–20s).

### TODOs / stubs

- **Realtime**: websocket push for live TBA balance/holder deltas is a documented
  follow-up; today we poll. Marked `TODO(realtime)` in `lib/api.ts`.
- **Pricing**: USD values prefer an indexer-supplied `usd` field (Chainlink via
  the pricing service). Absent that, native ETH holdings use a static reference
  price (`REFERENCE_ETH_USD` in `lib/pricing.ts`) — a placeholder, not a live
  quote. Unknown ERC-20s contribute `0` until enriched.
- **Allowlist proofs**: the mint widget submits an empty Merkle proof; wiring a
  real allowlist proof source is left as a follow-up. Public phases mint fine.
- **Floor price**: shown when the API provides `floor_eth`; otherwise `—`.
