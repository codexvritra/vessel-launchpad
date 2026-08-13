/**
 * viem `as const` ABIs for the three Signapad contracts the frontend touches.
 * Keeping them minimal (only the members the UI calls) keeps type inference
 * fast and intent obvious.
 */

export const collectionFactoryAbi = [
  {
    type: "function",
    name: "createCollection",
    stateMutability: "payable",
    inputs: [
      {
        name: "config",
        type: "tuple",
        components: [
          { name: "name", type: "string" },
          { name: "symbol", type: "string" },
          { name: "maxSupply", type: "uint256" },
          { name: "mintPrice", type: "uint256" },
          { name: "royaltyBps", type: "uint96" },
          { name: "tbaFundingBps", type: "uint16" },
          { name: "backingAsset", type: "address" },
          {
            name: "mintPhases",
            type: "tuple[]",
            components: [
              { name: "merkleRoot", type: "bytes32" },
              { name: "price", type: "uint256" },
              { name: "endPrice", type: "uint256" },
              { name: "startTime", type: "uint64" },
              { name: "endTime", type: "uint64" },
              { name: "perWalletCap", type: "uint32" },
              { name: "maxMintable", type: "uint32" },
            ],
          },
        ],
      },
      { name: "baseTokenURI", type: "string" },
      { name: "contractURI", type: "string" },
      { name: "enableCoinMarket", type: "bool" },
    ],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "predictCollectionAddress",
    stateMutability: "view",
    inputs: [{ name: "creator", type: "address" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "deployFee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "isCollection",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
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

export const launchpadErc721aAbi = [
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
    type: "function",
    name: "mint",
    stateMutability: "payable",
    inputs: [
      { name: "phaseId", type: "uint256" },
      { name: "quantity", type: "uint256" },
      { name: "proof", type: "bytes32[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "totalMinted",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "maxSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "phaseCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "phase",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "merkleRoot", type: "bytes32" },
          { name: "price", type: "uint256" },
          { name: "endPrice", type: "uint256" },
          { name: "startTime", type: "uint64" },
          { name: "endTime", type: "uint64" },
          { name: "perWalletCap", type: "uint32" },
          { name: "maxMintable", type: "uint32" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "currentPrice",
    stateMutability: "view",
    inputs: [{ name: "phaseId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "accountOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "tbaFundingBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint16" }],
  },
  {
    type: "function",
    name: "backingAsset",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "mintPrice",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const tbaGuardAbi = [
  {
    type: "function",
    name: "list",
    stateMutability: "nonpayable",
    inputs: [
      { name: "collection", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "price", type: "uint256" },
      { name: "expiry", type: "uint64" },
      { name: "assets", type: "address[]" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "settle",
    stateMutability: "payable",
    inputs: [
      { name: "listingId", type: "uint256" },
      { name: "assets", type: "address[]" },
      { name: "balances", type: "uint256[]" },
    ],
    outputs: [],
  },
] as const;

export const coinFactoryAbi = [
  {
    type: "function",
    name: "enableMarket",
    stateMutability: "nonpayable",
    inputs: [{ name: "collection", type: "address" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "coinOf",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "marketDeployer",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

export const collectionCoinAbi = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [{ name: "tokenIds", type: "uint256[]" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "redeem",
    stateMutability: "nonpayable",
    inputs: [{ name: "tokenIds", type: "uint256[]" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "heldCount", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "value", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export const marketDeployerAbi = [
  {
    type: "function",
    name: "createMarket",
    stateMutability: "payable",
    inputs: [
      { name: "token", type: "address" },
      { name: "tokenAmount", type: "uint256" },
      { name: "minTokenOut", type: "uint256" },
      { name: "minEthOut", type: "uint256" },
      { name: "to", type: "address" },
    ],
    outputs: [
      { name: "pair", type: "address" },
      { name: "liquidity", type: "uint256" },
    ],
  },
] as const;

export const liquidityLauncherAbi = [
  {
    type: "function",
    name: "launch",
    stateMutability: "payable",
    inputs: [
      { name: "collection", type: "address" },
      { name: "tokenIds", type: "uint256[]" },
      { name: "minTokenOut", type: "uint256" },
      { name: "minEthOut", type: "uint256" },
    ],
    outputs: [
      { name: "pair", type: "address" },
      { name: "liquidity", type: "uint256" },
    ],
  },
] as const;

// ERC-721 operator approval on the collection, needed before depositing into the coin vault.
export const erc721ApprovalAbi = [
  {
    type: "function",
    name: "setApprovalForAll",
    stateMutability: "nonpayable",
    inputs: [{ name: "operator", type: "address" }, { name: "approved", type: "bool" }],
    outputs: [],
  },
  {
    type: "function",
    name: "isApprovedForAll",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "operator", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export const bondingCurveAbi = [
  {
    type: "function",
    name: "launch",
    stateMutability: "payable",
    inputs: [{ name: "name", type: "string" }, { name: "symbol", type: "string" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "buy",
    stateMutability: "payable",
    inputs: [{ name: "token", type: "address" }, { name: "minTokensOut", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "sell",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "tokenAmount", type: "uint256" },
      { name: "minEthOut", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "quoteBuy",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }, { name: "ethIn", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "priceX18",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "launchFeeWei",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const tokenLauncherAbi = [
  {
    type: "function",
    name: "launch",
    stateMutability: "payable",
    inputs: [{ name: "name", type: "string" }, { name: "symbol", type: "string" }],
    outputs: [
      { name: "token", type: "address" },
      { name: "pair", type: "address" },
    ],
  },
  {
    type: "function",
    name: "launchFeeWei",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// Bonding-curve NFT launchpad — factory.
export const bcnftFactoryAbi = [
  {
    type: "function",
    name: "launch",
    stateMutability: "payable",
    inputs: [
      { name: "name_", type: "string" },
      { name: "symbol_", type: "string" },
      { name: "basePrice_", type: "uint256" },
      { name: "slope_", type: "uint256" },
      { name: "maxSupply_", type: "uint256" },
      { name: "uri_", type: "string" },
    ],
    outputs: [{ name: "collection", type: "address" }],
  },
  { type: "function", name: "launchFeeWei", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "isCollection", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "bool" }] },
  {
    type: "event",
    name: "Launched",
    inputs: [
      { name: "collection", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "name", type: "string", indexed: false },
      { name: "symbol", type: "string", indexed: false },
      { name: "basePrice", type: "uint256", indexed: false },
      { name: "slope", type: "uint256", indexed: false },
      { name: "maxSupply", type: "uint256", indexed: false },
    ],
  },
] as const;

// Bonding-curve NFT collection — buy (mint at rising price) / sell (burn for current price).
export const bondingCurveNftAbi = [
  { type: "function", name: "buy", stateMutability: "payable", inputs: [{ name: "quantity", type: "uint256" }], outputs: [] },
  { type: "function", name: "sell", stateMutability: "nonpayable", inputs: [{ name: "tokenIds", type: "uint256[]" }], outputs: [] },
  { type: "function", name: "buyQuote", stateMutability: "view", inputs: [{ name: "q", type: "uint256" }], outputs: [{ name: "total", type: "uint256" }] },
  { type: "function", name: "sellQuote", stateMutability: "view", inputs: [{ name: "q", type: "uint256" }], outputs: [{ name: "net", type: "uint256" }] },
  { type: "function", name: "buyCost", stateMutability: "view", inputs: [{ name: "q", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "sellProceeds", stateMutability: "view", inputs: [{ name: "q", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "maxSupply", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "basePrice", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "slope", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "reserve", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "feeBps", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint16" }] },
  { type: "function", name: "creator", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "contractURI", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
    ],
  },
] as const;

// Minimal ERC-20 for a launch token (balance + approve for selling).
export const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "value", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
] as const;

/** Shape of a single mint phase, mirrored from the ABI tuple. */
export type MintPhaseStruct = {
  merkleRoot: `0x${string}`;
  price: bigint; // start/ceiling price
  endPrice: bigint; // 0 => fixed price; else Dutch-auction floor
  startTime: bigint;
  endTime: bigint;
  perWalletCap: number;
  maxMintable: number;
};
