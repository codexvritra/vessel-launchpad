import { createPublicClient, http, formatUnits, type Address } from "viem";

// USD valuation of TBA contents via Chainlink price feeds. `PRICE_FEEDS` maps an
// asset address (lowercase; zeroAddress = native ETH) to its Chainlink aggregator.
// Configured as JSON in env: PRICE_FEEDS='{"0x..asset":"0x..feed"}'.

const rpc = process.env.ROBINHOOD_RPC_URL ?? "http://127.0.0.1:8545";
const client = createPublicClient({ transport: http(rpc) });

const ZERO = "0x0000000000000000000000000000000000000000";
let feeds: Record<string, Address> = {};
try {
  feeds = JSON.parse(process.env.PRICE_FEEDS ?? "{}");
} catch {
  console.warn("[pricing] PRICE_FEEDS is not valid JSON; USD values disabled");
}

const aggregatorAbi = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

const erc20Abi = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

type PriceInfo = { usd: number; feedDecimals: number } | null;
const priceCache = new Map<string, { info: PriceInfo; ts: number }>();

async function feedPrice(asset: string): Promise<PriceInfo> {
  const feed = feeds[asset.toLowerCase()];
  if (!feed) return null;
  const cached = priceCache.get(asset.toLowerCase());
  if (cached && Date.now() - cached.ts < 30_000) return cached.info;
  try {
    const [data, dec] = await Promise.all([
      client.readContract({ address: feed, abi: aggregatorAbi, functionName: "latestRoundData" }),
      client.readContract({ address: feed, abi: aggregatorAbi, functionName: "decimals" }),
    ]);
    const answer = data[1];
    const info: PriceInfo = { usd: Number(formatUnits(answer, dec)), feedDecimals: dec };
    priceCache.set(asset.toLowerCase(), { info, ts: Date.now() });
    return info;
  } catch {
    return null;
  }
}

async function assetDecimals(asset: string): Promise<number> {
  if (asset.toLowerCase() === ZERO) return 18; // native ETH
  try {
    return await client.readContract({ address: asset as Address, abi: erc20Abi, functionName: "decimals" });
  } catch {
    return 18;
  }
}

/// Convert a raw token amount to a USD value. Returns null if no feed is known.
export async function usdValue(asset: string, rawAmount: bigint | string): Promise<number | null> {
  const price = await feedPrice(asset);
  if (!price) return null;
  const dec = await assetDecimals(asset);
  const amount = Number(formatUnits(BigInt(rawAmount), dec));
  return amount * price.usd;
}

export async function priceHoldings(
  holdings: { asset: string; amount: string | bigint }[],
): Promise<{ totalUsd: number | null; priced: Array<{ asset: string; amount: string; usd: number | null }> }> {
  let total = 0;
  let anyPriced = false;
  const priced = [];
  for (const h of holdings) {
    const usd = await usdValue(h.asset, h.amount);
    if (usd !== null) {
      total += usd;
      anyPriced = true;
    }
    priced.push({ asset: h.asset, amount: String(h.amount), usd });
  }
  return { totalUsd: anyPriced ? total : null, priced };
}
