# Vessel — legal briefing for counsel

> **This is not legal advice.** I am not a lawyer. This document exists to brief a
> qualified lawyer efficiently: it describes what the platform does in plain terms
> and lists the questions to put to them. Get a written opinion from counsel
> licensed in your jurisdiction **before any mainnet launch**, not after.

## Why this matters before mainnet (and not on testnet)

There is a material legal difference between:

- **What we have now** — code, tests, and a public writeup deployed only to a
  **testnet** with **mock/valueless tokens**. No real assets, no public offering,
  no fees taken from the public. This is the low-exposure state.
- **Mainnet** — operating a live venue where third parties issue, to the public,
  NFTs that hold real value (ETH, or tokenized equities), and where the operator
  **takes a fee** for providing that issuance venue. This is where financial-
  services and securities regimes plausibly attach.

Minting some NFTs yourself is participation. Running the machine that lets *others*
issue asset-backed instruments to the public, for a cut, makes you an **issuance
venue / intermediary** — a categorically different posture.

## What the platform does (for counsel)

1. Anyone can deploy an NFT collection permissionlessly (one transaction).
2. On mint, a configurable share of the mint price is deposited into a per-token
   **ERC-6551 token-bound account** — so each NFT literally holds assets.
3. That deposit can be **swapped into a "backing asset"** in the same transaction
   (e.g. a tokenized equity), so the NFT holds a financial asset.
4. The platform **takes a protocol fee** on mints and on secondary-market activity.
5. A secondary market lets people buy/sell these asset-holding NFTs.
6. An optional Uniswap-V4 liquidity layer lets collections trade as fungible pools.

The differentiator vs. content-coin launchpads is exactly the thing that raises the
stakes: the NFT is a **funded wallet**, potentially holding **securities-like
assets**.

## Questions to put to counsel (Australia / ASIC-oriented, but ask for cross-border too)

- **Financial product classification** — do these asset-backed NFTs constitute a
  *financial product* (e.g. interests in a managed investment scheme, derivatives,
  or securities) under the Corporations Act? Does it change if the backing asset is
  ETH vs. a tokenized equity vs. nothing?
- **AFSL** — does operating the platform (issuance venue, secondary market,
  advice-like surfaces such as "trending") require an **Australian Financial
  Services Licence**, or a market-operator licence?
- **Managed investment scheme** — could pooling/backing mechanics be characterised
  as an MIS requiring registration and a responsible entity?
- **Tokenized securities** — if creators point `backingAsset` at a tokenized equity,
  what obligations attach to the operator vs. the creator vs. the token issuer?
- **Disclosure** — are product disclosure statement / prospectus obligations
  triggered for creators or for the platform?
- **AML/CTF (AUSTRAC)** — does funding wallets and running a secondary market make
  the operator a reporting entity with KYC/AML obligations?
- **Consumer protection & marketing** — constraints on how mint pages, "funded
  value", and "trending" are presented (misleading-conduct exposure).
- **Cross-border** — the chain and users are global; which other regimes (US
  securities law, EU MiCA, etc.) attach based on who can access the front end?
- **Operator liability** — does non-custodial architecture (the platform never holds
  user assets; TBAs are user-controlled) meaningfully reduce exposure, and how far?

## Risk-reduction levers to discuss (not a substitute for advice)

- Constrain or allowlist `backingAsset` (e.g. exclude tokenized securities entirely
  at launch; ETH-only).
- Geofencing / eligibility gating on the front end.
- KYC/AML integration if advised.
- Clear, prominent risk disclosures; avoid investment-return framing in copy.
- Keep the protocol non-custodial (it already is) and document that.
- Consider launching first as a **testnet demo + public writeup** (current state),
  which carries little of this exposure, while the opinion is obtained.

## Bottom line

The engineering can be mainnet-ready and still be legally premature to launch.
Treat the counsel opinion as a hard gate on mainnet, in series with an external
security audit (`contracts/docs/AUDIT.md`).
