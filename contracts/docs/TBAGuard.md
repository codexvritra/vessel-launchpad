# TBAGuard — defending token-bound-account trades against drain-before-transfer

> The most interesting security problem in this project. An NFT that is *also a
> wallet* breaks an assumption every NFT marketplace quietly relies on: that the
> thing you are buying cannot have its value removed by the seller between the
> moment you commit and the moment you settle.

## 1. The attack

A Vessel NFT owns an ERC-6551 token-bound account (TBA) that holds assets — ETH,
or a tokenized backing asset. The NFT and its wallet are separable at the
permission layer: whoever owns the NFT can, *at any time*, execute calls from the
TBA and move its contents out.

That creates a settlement race on any secondary sale:

```
1. Seller lists NFT #42, advertising "this vessel holds 0.05 ETH".
2. Buyer sees the funded wallet and commits 1 ETH to buy it.
3. Before settlement mines, the seller calls TBA.execute(seller, 0.05 ETH, "")
   and empties the wallet.
4. Buyer receives NFT #42 — now an empty vessel — for 1 ETH.
```

A naive marketplace (list → buyer pays → contract transfers NFT) settles step 4
happily: the NFT did transfer, the payment did clear. Nothing in a standard
ERC-721 escrow checks *what the NFT's wallet contains*. The buyer is robbed in
broad daylight, and it looks like a valid trade on-chain.

This is not a hypothetical edge case. It is the default outcome of composing
ERC-6551 with any marketplace that settles on NFT ownership alone.

## 2. The defence we ship: snapshot-on-list

`TBAGuard` gates settlement on a **balance invariant** captured at list time.

### List

```solidity
list(collection, tokenId, price, expiry, address[] assets)
```

At list time the guard reads, for the token's deterministic TBA:

- `tba.balance` (native ETH), stored as `snapshotEth`, and
- `IERC20(asset).balanceOf(tba)` for each declared `asset`,

and stores a commitment `balanceCommit = keccak256(abi.encode(assets, balances))`.
The seller declares which assets they are *guaranteeing to deliver*. We cannot
enumerate every ERC-20 a TBA might hold on-chain, so the guarantee set is explicit
and self-selected; anything not declared is simply not promised.

The guard takes **no custody** — not of the NFT, not of the TBA's assets. The
seller keeps everything. The guard holds only a commitment and an operator
approval to move the NFT on a valid fill.

### Settle

```solidity
settle(listingId, address[] assets, uint256[] balances) payable
```

The buyer (or their client) re-supplies the committed `assets`/`balances`. The
guard:

1. verifies `keccak256(abi.encode(assets, balances)) == balanceCommit` — the
   snapshot cannot be forged or substituted;
2. asserts `tba.balance >= snapshotEth` **and** `balanceOf(tba) >= balances[i]`
   for every declared asset — the invariant;
3. asserts the seller still owns the token (no out-of-band transfer);
4. sets the listing inactive, credits the seller under a pull-payment balance, and
   only then `safeTransferFrom`s the NFT to the buyer.

If the seller drained the TBA in step 3 of the attack, the invariant fails and
`settle` reverts `BalancesChanged()`. **The buyer's ETH is returned by the revert
and no NFT changes hands.** The seller cannot both empty the wallet and complete
the sale.

### Why `>=` and not `==`

Deposits into the TBA after listing are strictly good for the buyer, so the
invariant is a floor, not an equality. Using `==` would let anyone grief a listing
by donating 1 wei to the TBA to force a mismatch. Using `>=` means only a
*shortfall* — an actual drain — can block settlement.

### The 6551 `state()` nonce

We also snapshot the account's `state()` nonce for analytics/telemetry, but we do
**not** gate on it. `state()` increments on deposits too, so gating on "state
unchanged" would revert honest top-ups. Balances are the authoritative signal.

## 3. Threat cases covered (see `test/TBAGuard.t.sol`)

| Case | Expectation |
|---|---|
| Seller drains all ETH after listing | `settle` reverts `BalancesChanged`, buyer funds safe |
| Seller drains *part* of the ETH | reverts — the floor catches partial drains too |
| Seller drains a declared ERC-20 | reverts `BalancesChanged` |
| Buyer supplies a forged snapshot | reverts `CommitMismatch` |
| Seller moves the NFT out of band | reverts `OwnershipChanged` |
| Third party tops up the TBA after listing | settles fine (`>=` floor) |
| Listing expired / cancelled | reverts `ListingExpired` / `InactiveListing` |
| Honest trade | NFT + still-funded wallet transfer atomically; seller pulls proceeds |

## 4. The alternative: escrow-on-list

The other credible design escrows value at list time instead of checking it at
settle time. Two variants:

- **Escrow the NFT.** Seller transfers the NFT into the guard on listing. This
  removes the seller's ability to `execute` from the TBA at all (execution
  authority follows NFT ownership), so the wallet is frozen for the listing's
  duration. Settlement just releases the NFT to the buyer.
- **Escrow the assets.** Sweep the TBA's contents into a guard-held escrow on
  listing and release them to the buyer's TBA on settlement.

### Tradeoffs

| | Snapshot-on-list (shipped) | Escrow-on-list |
|---|---|---|
| Custody | None — non-custodial | Guard holds NFT (or assets) |
| Seller UX | Seller keeps using the asset until it sells | Asset frozen/removed while listed |
| Drain prevention | Detected at settle; buyer never loses funds | Structurally impossible while escrowed |
| Griefing | Seller can drain to make a fill revert (wastes buyer gas, no fund loss) | None |
| Failure mode | A drained listing is unfillable (fails safe) | Escrow contract becomes a custody honeypot |
| Composability | NFT stays liquid/usable elsewhere | NFT locked; can't be used in other protocols while listed |
| Gas | One `keccak` + N `balanceOf` at settle | Extra transfer in and out |
| Attack surface | Minimal (holds nothing) | Larger (holds value; upgrade/withdraw logic to secure) |

### Why snapshot-on-list is the default

The whole premise of Vessel is that **an NFT is a usable wallet**. Escrow-on-list
contradicts that premise for the entire time a token is listed: it freezes or
strips the wallet, which is exactly the utility the buyer is paying for. Snapshot
keeps the token live and self-custodial and still makes the buyer whole in every
drain scenario. The cost is a griefing vector — a malicious seller can drain to
force a buyer's `settle` to revert — but that burns only gas, never principal, and
a seller who does it forfeits the sale. That is an acceptable trade for
non-custodial, composable listings.

For high-value or OTC trades where griefing-resistance matters more than
composability, escrow-on-list is the right tool, and the two can coexist: the same
front end can offer "instant listing" (snapshot) and "locked listing" (escrow) as
a per-listing choice. Escrow-on-list is scoped as a follow-up module; the snapshot
guard is the one implemented and tested here.

## 5. Residual risks & notes

- **Undeclared assets are not guaranteed.** If a seller lists declaring only ETH
  but the TBA also holds an ERC-20, the buyer is only protected on ETH. The client
  must declare (and display) the full asset set. The indexer already computes every
  TBA's holdings, so the front end can pre-populate the declared set from ground
  truth rather than trusting the seller.
- **Approvals.** Settlement needs the guard approved as an operator. A seller who
  revokes approval after listing causes `safeTransferFrom` to revert — a fail-safe,
  not a loss.
- **Front-running a fill with a drain** is the griefing vector above: fails safe,
  costs only gas.
- **Price is paid in ETH** and held under pull-payment (`withdraw()`), never pushed
  — consistent with `FeeSplitter` and for the same anti-griefing reason.
