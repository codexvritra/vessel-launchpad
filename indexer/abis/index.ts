// Minimal, event-only ABIs for the Vessel launchpad. Kept hand-scoped to the
// events the indexer consumes so the config stays readable; full ABIs live in the
// Foundry `out/` artifacts.

export const CollectionFactoryAbi = [
  {
    type: "event",
    name: "CollectionCreated",
    inputs: [
      { name: "collection", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "configHash", type: "bytes32", indexed: false },
    ],
  },
] as const;

export const LaunchpadERC721Abi = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
    ],
  },
  {
    type: "event",
    name: "TokenBoundAccountFunded",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "account", type: "address", indexed: true },
      { name: "asset", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Minted",
    inputs: [
      { name: "minter", type: "address", indexed: true },
      { name: "startTokenId", type: "uint256", indexed: true },
      { name: "quantity", type: "uint256", indexed: false },
      { name: "phaseId", type: "uint256", indexed: true },
      { name: "totalTbaFunding", type: "uint256", indexed: false },
      { name: "totalPaid", type: "uint256", indexed: false },
    ],
  },
] as const;

export const TBAGuardAbi = [
  {
    type: "event",
    name: "Listed",
    inputs: [
      { name: "listingId", type: "uint256", indexed: true },
      { name: "collection", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "seller", type: "address", indexed: false },
      { name: "price", type: "uint256", indexed: false },
      { name: "account", type: "address", indexed: false },
      { name: "snapshotEth", type: "uint256", indexed: false },
      { name: "balanceCommit", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Settled",
    inputs: [
      { name: "listingId", type: "uint256", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "seller", type: "address", indexed: true },
      { name: "price", type: "uint256", indexed: false },
    ],
  },
] as const;

export const LaunchpadHookAbi = [
  {
    type: "event",
    name: "SwapRewarded",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "currency", type: "address", indexed: false },
      { name: "fee", type: "uint256", indexed: false },
      { name: "creator", type: "uint256", indexed: false },
      { name: "tradeReferrer", type: "uint256", indexed: false },
      { name: "createReferrer", type: "uint256", indexed: false },
      { name: "protocol", type: "uint256", indexed: false },
      { name: "lpLocked", type: "uint256", indexed: false },
      { name: "lpReward", type: "uint256", indexed: false },
    ],
  },
] as const;

export const FeeSplitterAbi = [
  {
    type: "event",
    name: "MintProceedsDeposited",
    inputs: [
      { name: "collection", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "creatorAmount", type: "uint256", indexed: false },
      { name: "protocolAmount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Claimed",
    inputs: [
      { name: "account", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;

export const CoinFactoryAbi = [
  {
    type: "event",
    name: "MarketEnabled",
    inputs: [
      { name: "collection", type: "address", indexed: true },
      { name: "coin", type: "address", indexed: true },
    ],
  },
] as const;

export const MarketDeployerAbi = [
  {
    type: "event",
    name: "MarketCreated",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "pair", type: "address", indexed: true },
      { name: "tokenIn", type: "uint256", indexed: false },
      { name: "ethIn", type: "uint256", indexed: false },
      { name: "liquidity", type: "uint256", indexed: false },
    ],
  },
] as const;

export const BondingCurveAbi = [
  {
    type: "event",
    name: "Launched",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "name", type: "string", indexed: false },
      { name: "symbol", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Trade",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "trader", type: "address", indexed: true },
      { name: "isBuy", type: "bool", indexed: false },
      { name: "ethAmount", type: "uint256", indexed: false },
      { name: "tokenAmount", type: "uint256", indexed: false },
      { name: "feeWei", type: "uint256", indexed: false },
      { name: "priceX18", type: "uint256", indexed: false },
      { name: "realEthAfter", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "GraduatedToDex",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "pair", type: "address", indexed: true },
      { name: "ethSeeded", type: "uint256", indexed: false },
      { name: "tokensSeeded", type: "uint256", indexed: false },
    ],
  },
] as const;

export const TokenLauncherAbi = [
  {
    type: "event",
    name: "Launched",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "pair", type: "address", indexed: true },
      { name: "name", type: "string", indexed: false },
      { name: "symbol", type: "string", indexed: false },
      { name: "ethLiquidity", type: "uint256", indexed: false },
    ],
  },
] as const;

// Standard ERC-20 Transfer — used to index backing-asset movements in/out of TBAs.
export const ERC20Abi = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;
