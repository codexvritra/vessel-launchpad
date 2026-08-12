import { ponder } from "ponder:registry";
import schema from "ponder:schema";

const ZERO = "0x0000000000000000000000000000000000000000";

// Minimal read ABI for enriching collection rows on creation.
const collectionReadAbi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "backingAsset", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

// --------------------------------------------------------------------------- //
//                         Factory: collection creation                        //
// --------------------------------------------------------------------------- //

ponder.on("CollectionFactory:CollectionCreated", async ({ event, context }) => {
  const address = event.args.collection;
  let name: string | null = null;
  let symbol: string | null = null;
  let backingAsset: `0x${string}` | null = null;
  try {
    [name, symbol, backingAsset] = await Promise.all([
      context.client.readContract({ address, abi: collectionReadAbi, functionName: "name" }),
      context.client.readContract({ address, abi: collectionReadAbi, functionName: "symbol" }),
      context.client.readContract({ address, abi: collectionReadAbi, functionName: "backingAsset" }),
    ]);
  } catch {
    /* enrichment is best-effort; metadata service can backfill */
  }

  await context.db.insert(schema.collection).values({
    address,
    creator: event.args.creator,
    configHash: event.args.configHash,
    name,
    symbol,
    backingAsset,
    createdAt: event.block.timestamp,
    createdBlock: event.block.number,
  });
});

// --------------------------------------------------------------------------- //
//                       Collection: ERC-721 transfers                         //
// --------------------------------------------------------------------------- //

ponder.on("Collection:Transfer", async ({ event, context }) => {
  const coll = event.log.address;
  const { from, to, tokenId } = event.args;
  const tokenRef = `${coll}:${tokenId}`;
  const isMint = from.toLowerCase() === ZERO;

  // Record the raw transfer (substrate for wash-trade analysis).
  await context.db.insert(schema.transferEvent).values({
    id: `${event.transaction.hash}:${event.log.logIndex}`,
    collection: coll,
    tokenId,
    from,
    to,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });

  if (isMint) {
    await context.db.insert(schema.token).values({
      id: tokenRef,
      collection: coll,
      tokenId,
      owner: to,
      minter: to,
      mintedAt: event.block.timestamp,
    });
    // unique minters
    const seenId = `${coll}:${to}`;
    const seen = await context.db.find(schema.minterSeen, { id: seenId });
    if (!seen) {
      await context.db.insert(schema.minterSeen).values({ id: seenId });
      await context.db.update(schema.collection, { address: coll }).set((r) => ({
        totalMinted: r.totalMinted + 1,
        uniqueMinters: r.uniqueMinters + 1,
      }));
    } else {
      await context.db.update(schema.collection, { address: coll }).set((r) => ({
        totalMinted: r.totalMinted + 1,
      }));
    }
  } else {
    await context.db
      .update(schema.token, { id: tokenRef })
      .set({ owner: to })
      .catch(() => {});
  }

  // Maintain per-owner balances and holderCount deltas.
  if (from.toLowerCase() !== ZERO) await adjustBalance(context, coll, from, -1);
  if (to.toLowerCase() !== ZERO) await adjustBalance(context, coll, to, +1);
});

async function adjustBalance(context: any, coll: string, owner: string, delta: number) {
  const id = `${coll}:${owner}`;
  const row = await context.db.find(schema.ownerBalance, { id });
  const prev = row?.balance ?? 0;
  const next = prev + delta;
  if (!row) {
    await context.db.insert(schema.ownerBalance).values({ id, collection: coll, owner, balance: next });
  } else {
    await context.db.update(schema.ownerBalance, { id }).set({ balance: next });
  }
  // holderCount changes only on 0<->positive transitions.
  if (prev <= 0 && next > 0) {
    await context.db.update(schema.collection, { address: coll }).set((r: any) => ({ holderCount: r.holderCount + 1 }));
  } else if (prev > 0 && next <= 0) {
    await context.db.update(schema.collection, { address: coll }).set((r: any) => ({ holderCount: Math.max(0, r.holderCount - 1) }));
  }
}

// --------------------------------------------------------------------------- //
//                    Collection: primary mint (volume signal)                 //
// --------------------------------------------------------------------------- //

ponder.on("Collection:Minted", async ({ event, context }) => {
  const coll = event.log.address;
  const { quantity, phaseId, totalTbaFunding, totalPaid } = event.args;

  await context.db.insert(schema.mintEvent).values({
    id: `${event.transaction.hash}:${event.log.logIndex}`,
    collection: coll,
    minter: event.args.minter,
    quantity: Number(quantity),
    paidWei: totalPaid,
    fundingWei: totalTbaFunding,
    phaseId: Number(phaseId),
    timestamp: event.block.timestamp,
    blockNumber: event.block.number,
  });

  await context.db
    .update(schema.collection, { address: coll })
    .set((r) => ({ mintVolumeWei: r.mintVolumeWei + totalPaid }))
    .catch(() => {});
});

// --------------------------------------------------------------------------- //
//                    Collection: token-bound account funding                  //
// --------------------------------------------------------------------------- //

ponder.on("Collection:TokenBoundAccountFunded", async ({ event, context }) => {
  const coll = event.log.address;
  const { tokenId, account, asset, amount } = event.args;
  const tokenRef = `${coll}:${tokenId}`;

  await context.db.update(schema.token, { id: tokenRef }).set({ tba: account }).catch(() => {});
  await context.db
    .insert(schema.tbaLink)
    .values({ tba: account, tokenRef, collection: coll })
    .onConflictDoNothing();

  const holdingId = `${account}:${asset}`;
  await context.db
    .insert(schema.tbaHolding)
    .values({
      id: holdingId,
      tba: account,
      tokenRef,
      asset,
      amount,
      updatedAt: event.block.timestamp,
    })
    .onConflictDoUpdate((r) => ({ amount: r.amount + amount, updatedAt: event.block.timestamp }));
});

// --------------------------------------------------------------------------- //
//               Backing asset: ERC-20 moving in/out of a TBA                  //
// --------------------------------------------------------------------------- //

ponder.on("BackingAsset:Transfer", async ({ event, context }) => {
  const asset = event.log.address;
  const { from, to, value } = event.args;

  const credit = await context.db.find(schema.tbaLink, { tba: to });
  if (credit) await bumpHolding(context, to, credit.tokenRef, asset, value, event.block.timestamp);

  const debit = await context.db.find(schema.tbaLink, { tba: from });
  if (debit) await bumpHolding(context, from, debit.tokenRef, asset, -value, event.block.timestamp);
});

async function bumpHolding(
  context: any,
  tba: string,
  tokenRef: string,
  asset: string,
  delta: bigint,
  ts: bigint,
) {
  const id = `${tba}:${asset}`;
  await context.db
    .insert(schema.tbaHolding)
    .values({ id, tba, tokenRef, asset, amount: delta > 0n ? delta : 0n, updatedAt: ts })
    .onConflictDoUpdate((r: any) => ({ amount: r.amount + delta, updatedAt: ts }));
}

// --------------------------------------------------------------------------- //
//                          Marketplace (TBAGuard)                             //
// --------------------------------------------------------------------------- //

ponder.on("TBAGuard:Listed", async ({ event, context }) => {
  await context.db.insert(schema.listing).values({
    id: event.args.listingId.toString(),
    collection: event.args.collection,
    tokenId: event.args.tokenId,
    seller: event.args.seller,
    priceWei: event.args.price,
    tba: event.args.account,
    active: true,
    createdAt: event.block.timestamp,
  });
});

ponder.on("TBAGuard:Settled", async ({ event, context }) => {
  const id = event.args.listingId.toString();
  const l = await context.db.find(schema.listing, { id });
  await context.db.update(schema.listing, { id }).set({ active: false }).catch(() => {});

  await context.db.insert(schema.sale).values({
    id: `${event.transaction.hash}:${event.log.logIndex}`,
    listingId: event.args.listingId,
    collection: l?.collection ?? null,
    tokenId: l?.tokenId ?? null,
    buyer: event.args.buyer,
    seller: event.args.seller,
    priceWei: event.args.price,
    timestamp: event.block.timestamp,
    blockNumber: event.block.number,
  });

  if (l?.collection) {
    await context.db.update(schema.collection, { address: l.collection }).set((r) => ({
      salesCount: r.salesCount + 1,
      volumeWei: r.volumeWei + event.args.price,
    }));
  }
});

// --------------------------------------------------------------------------- //
//                     Coin market (Zora-style + SushiSwap)                    //
// --------------------------------------------------------------------------- //

ponder.on("CoinFactory:MarketEnabled", async ({ event, context }) => {
  const { collection, coin } = event.args;
  await context.db
    .insert(schema.coinLink)
    .values({ coin, collection })
    .onConflictDoNothing();
  await context.db
    .update(schema.collection, { address: collection })
    .set({ coinAddress: coin })
    .catch(() => {});
});

ponder.on("MarketDeployer:MarketCreated", async ({ event, context }) => {
  const { token, pair } = event.args;
  const link = await context.db.find(schema.coinLink, { coin: token });
  if (link) {
    await context.db
      .update(schema.collection, { address: link.collection })
      .set({ pairAddress: pair })
      .catch(() => {});
  }
});

// --------------------------------------------------------------------------- //
//                     Bonding curve — token launch + trades                   //
// --------------------------------------------------------------------------- //

ponder.on("BondingCurve:Launched", async ({ event, context }) => {
  await context.db.insert(schema.launchToken).values({
    address: event.args.token,
    name: event.args.name,
    symbol: event.args.symbol,
    creator: event.args.creator,
    createdAt: event.block.timestamp,
  });
});

ponder.on("BondingCurve:Trade", async ({ event, context }) => {
  const { token, trader, isBuy, ethAmount, tokenAmount, feeWei, priceX18, realEthAfter } =
    event.args;
  await context.db.insert(schema.trade).values({
    id: `${event.transaction.hash}:${event.log.logIndex}`,
    token,
    trader,
    isBuy,
    ethAmount,
    tokenAmount,
    feeWei,
    priceX18,
    timestamp: event.block.timestamp,
    blockNumber: event.block.number,
  });
  await context.db
    .update(schema.launchToken, { address: token })
    .set((r) => ({
      lastPriceX18: priceX18,
      realEthWei: realEthAfter,
      volumeWei: r.volumeWei + ethAmount,
      tradeCount: r.tradeCount + 1,
    }))
    .catch(() => {});
});

// Direct-to-DEX launch: the token is already on a SushiSwap pair at launch, so we
// record it as "graduated" with its pair (no bonding-curve trading phase).
ponder.on("TokenLauncher:Launched", async ({ event, context }) => {
  await context.db
    .insert(schema.launchToken)
    .values({
      address: event.args.token,
      name: event.args.name,
      symbol: event.args.symbol,
      creator: event.args.creator,
      createdAt: event.block.timestamp,
      graduated: true,
      pair: event.args.pair,
    })
    .onConflictDoNothing();
});

ponder.on("BondingCurve:GraduatedToDex", async ({ event, context }) => {
  await context.db
    .update(schema.launchToken, { address: event.args.token })
    .set({ graduated: true, pair: event.args.pair })
    .catch(() => {});
});

// --------------------------------------------------------------------------- //
//                       Hook swap rewards + fee events                        //
// --------------------------------------------------------------------------- //

ponder.on("LaunchpadHook:SwapRewarded", async ({ event, context }) => {
  await context.db.insert(schema.swapReward).values({
    id: `${event.transaction.hash}:${event.log.logIndex}`,
    poolId: event.args.poolId,
    currency: event.args.currency,
    fee: event.args.fee,
    creator: event.args.creator,
    tradeReferrer: event.args.tradeReferrer,
    createReferrer: event.args.createReferrer,
    protocol: event.args.protocol,
    lpLocked: event.args.lpLocked,
    lpReward: event.args.lpReward,
    timestamp: event.block.timestamp,
  });
});

ponder.on("FeeSplitter:MintProceedsDeposited", async ({ event, context }) => {
  const base = `${event.transaction.hash}:${event.log.logIndex}`;
  await context.db.insert(schema.feeEvent).values({
    id: `${base}:c`,
    kind: "mint_creator",
    collection: event.args.collection,
    account: event.args.creator,
    amountWei: event.args.creatorAmount,
    timestamp: event.block.timestamp,
  });
  await context.db.insert(schema.feeEvent).values({
    id: `${base}:p`,
    kind: "mint_protocol",
    collection: event.args.collection,
    account: event.log.address, // protocol recipient sink
    amountWei: event.args.protocolAmount,
    timestamp: event.block.timestamp,
  });
});

ponder.on("FeeSplitter:Claimed", async ({ event, context }) => {
  await context.db.insert(schema.feeEvent).values({
    id: `${event.transaction.hash}:${event.log.logIndex}`,
    kind: "claim",
    collection: null,
    account: event.args.account,
    amountWei: event.args.amount,
    timestamp: event.block.timestamp,
  });
});
