import { onchainTable, index, primaryKey } from "ponder";

/// A deployed collection (from the factory's CollectionCreated event).
export const collection = onchainTable(
  "collection",
  (t) => ({
    address: t.hex().primaryKey(),
    creator: t.hex().notNull(),
    configHash: t.hex().notNull(),
    name: t.text(),
    symbol: t.text(),
    backingAsset: t.hex(), // address(0) => native ETH held in TBAs
    createdAt: t.bigint().notNull(),
    createdBlock: t.bigint().notNull(),
    // Denormalized counters maintained incrementally by handlers.
    totalMinted: t.integer().notNull().default(0),
    uniqueMinters: t.integer().notNull().default(0),
    holderCount: t.integer().notNull().default(0),
    salesCount: t.integer().notNull().default(0),
    volumeWei: t.bigint().notNull().default(0n), // secondary (settled sales)
    mintVolumeWei: t.bigint().notNull().default(0n), // primary (mints, incl. Dutch auctions)
    coinAddress: t.hex(), // fungible CollectionCoin vault, if a market is enabled
    pairAddress: t.hex(), // SushiSwap coin/ETH pair, if liquidity has been seeded
  }),
  (t) => ({ creatorIdx: index().on(t.creator) }),
);

/// One row per minted token, carrying its computed token-bound-account address.
export const token = onchainTable(
  "token",
  (t) => ({
    id: t.text().primaryKey(), // `${collection}:${tokenId}`
    collection: t.hex().notNull(),
    tokenId: t.bigint().notNull(),
    owner: t.hex().notNull(),
    tba: t.hex(), // ERC-6551 account address
    minter: t.hex(),
    mintedAt: t.bigint(),
  }),
  (t) => ({
    collIdx: index().on(t.collection),
    ownerIdx: index().on(t.owner),
    tbaIdx: index().on(t.tba),
  }),
);

/// Current balance of one asset held inside one token-bound account.
/// asset == zeroAddress denotes native ETH.
export const tbaHolding = onchainTable(
  "tba_holding",
  (t) => ({
    id: t.text().primaryKey(), // `${tba}:${asset}`
    tba: t.hex().notNull(),
    tokenRef: t.text().notNull(), // -> token.id
    asset: t.hex().notNull(),
    amount: t.bigint().notNull().default(0n),
    updatedAt: t.bigint(),
  }),
  (t) => ({ tbaIdx: index().on(t.tba), tokenIdx: index().on(t.tokenRef) }),
);

/// Raw ERC-721 transfer log — the substrate for holder counts and wash-trade
/// detection. Mints have from == zeroAddress.
export const transferEvent = onchainTable(
  "transfer_event",
  (t) => ({
    id: t.text().primaryKey(), // `${tx}:${logIndex}`
    collection: t.hex().notNull(),
    tokenId: t.bigint().notNull(),
    from: t.hex().notNull(),
    to: t.hex().notNull(),
    blockNumber: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
    txHash: t.hex().notNull(),
  }),
  (t) => ({
    collIdx: index().on(t.collection),
    pairIdx: index().on(t.collection, t.from, t.to),
    tsIdx: index().on(t.timestamp),
  }),
);

/// A completed secondary sale via TBAGuard — the trustworthy volume signal
/// (settled price, real buyer/seller), distinct from raw transfers.
export const sale = onchainTable(
  "sale",
  (t) => ({
    id: t.text().primaryKey(), // `${tx}:${logIndex}`
    listingId: t.bigint().notNull(),
    collection: t.hex(),
    tokenId: t.bigint(),
    buyer: t.hex().notNull(),
    seller: t.hex().notNull(),
    priceWei: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
    blockNumber: t.bigint().notNull(),
  }),
  (t) => ({
    collIdx: index().on(t.collection),
    tsIdx: index().on(t.timestamp),
  }),
);

/// One row per primary mint (from the collection's Minted event), carrying the
/// ETH actually paid (post-refund). This is the substrate the trending view uses
/// to decay-weight primary-sale volume — the signal that captures a live drop /
/// Dutch auction, distinct from secondary settled sales.
export const mintEvent = onchainTable(
  "mint_event",
  (t) => ({
    id: t.text().primaryKey(), // `${tx}:${logIndex}`
    collection: t.hex().notNull(),
    minter: t.hex().notNull(),
    quantity: t.integer().notNull(),
    paidWei: t.bigint().notNull(),
    fundingWei: t.bigint().notNull(),
    phaseId: t.integer().notNull(),
    timestamp: t.bigint().notNull(),
    blockNumber: t.bigint().notNull(),
  }),
  (t) => ({
    collIdx: index().on(t.collection),
    tsIdx: index().on(t.timestamp),
  }),
);

/// Active/expired listings, for floor computation.
export const listing = onchainTable(
  "listing",
  (t) => ({
    id: t.text().primaryKey(), // listingId as text
    collection: t.hex().notNull(),
    tokenId: t.bigint().notNull(),
    seller: t.hex().notNull(),
    priceWei: t.bigint().notNull(),
    tba: t.hex(),
    active: t.boolean().notNull().default(true),
    createdAt: t.bigint().notNull(),
  }),
  (t) => ({ collActiveIdx: index().on(t.collection, t.active) }),
);

/// Per-swap reward accrual from the V4 hook.
export const swapReward = onchainTable("swap_reward", (t) => ({
  id: t.text().primaryKey(),
  poolId: t.hex().notNull(),
  currency: t.hex().notNull(),
  fee: t.bigint().notNull(),
  creator: t.bigint().notNull(),
  tradeReferrer: t.bigint().notNull(),
  createReferrer: t.bigint().notNull(),
  protocol: t.bigint().notNull(),
  lpLocked: t.bigint().notNull(),
  lpReward: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
}));

/// Reverse lookup: CollectionCoin address -> the collection it vaults. Lets the
/// market-deployer handler attribute a seeded pair back to its collection.
export const coinLink = onchainTable("coin_link", (t) => ({
  coin: t.hex().primaryKey(),
  collection: t.hex().notNull(),
}));

/// Fast reverse lookup: TBA address -> owning token id. Populated when a TBA is
/// funded, so the ERC-20 Transfer handler can attribute movements to a token.
export const tbaLink = onchainTable("tba_link", (t) => ({
  tba: t.hex().primaryKey(),
  tokenRef: t.text().notNull(),
  collection: t.hex().notNull(),
}));

/// Per-owner token balance within a collection, for holder counting.
export const ownerBalance = onchainTable("owner_balance", (t) => ({
  id: t.text().primaryKey(), // `${collection}:${owner}`
  collection: t.hex().notNull(),
  owner: t.hex().notNull(),
  balance: t.integer().notNull().default(0),
}));

/// Seen-set for unique-minter counting.
export const minterSeen = onchainTable("minter_seen", (t) => ({
  id: t.text().primaryKey(), // `${collection}:${minter}`
}));

/// A bonding-curve token (from the BondingCurve's Launched event).
export const launchToken = onchainTable(
  "launch_token",
  (t) => ({
    address: t.hex().primaryKey(),
    name: t.text(),
    symbol: t.text(),
    creator: t.hex().notNull(),
    createdAt: t.bigint().notNull(),
    graduated: t.boolean().notNull().default(false),
    pair: t.hex(),
    lastPriceX18: t.bigint().notNull().default(0n),
    realEthWei: t.bigint().notNull().default(0n), // ETH raised on the curve
    volumeWei: t.bigint().notNull().default(0n), // cumulative traded ETH
    tradeCount: t.integer().notNull().default(0),
  }),
  (t) => ({ creatorIdx: index().on(t.creator) }),
);

/// One row per buy/sell on the curve — the order-history + chart substrate.
export const trade = onchainTable(
  "trade",
  (t) => ({
    id: t.text().primaryKey(), // `${tx}:${logIndex}`
    token: t.hex().notNull(),
    trader: t.hex().notNull(),
    isBuy: t.boolean().notNull(),
    ethAmount: t.bigint().notNull(),
    tokenAmount: t.bigint().notNull(),
    feeWei: t.bigint().notNull(),
    priceX18: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
    blockNumber: t.bigint().notNull(),
  }),
  (t) => ({
    tokenIdx: index().on(t.token),
    tokenTsIdx: index().on(t.token, t.timestamp),
  }),
);

/// Creator/protocol earnings ledger from the FeeSplitter.
export const feeEvent = onchainTable(
  "fee_event",
  (t) => ({
    id: t.text().primaryKey(),
    kind: t.text().notNull(), // 'mint_creator' | 'mint_protocol' | 'claim'
    collection: t.hex(),
    account: t.hex().notNull(),
    amountWei: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
  }),
  (t) => ({ accountIdx: index().on(t.account) }),
);
