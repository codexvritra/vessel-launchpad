import { API_URL, SERVICES_URL } from "./config";

/**
 * Typed client for the Signapad indexer (Ponder + Hono) REST API and the services
 * layer. Every call is wrapped in try/catch and returns an empty-but-valid
 * default, so the UI never throws during SSR/build when a backend is unreachable.
 *
 * Realtime: on top of react-query polling here, the UI subscribes to chain events
 * (see lib/realtime.ts) over a WebSocket RPC when configured, invalidating these
 * queries on the relevant on-chain events for near-instant updates.
 */

// --- Row shapes (mirroring the SQL views / drizzle rows) ---------------------

export type TrendingRow = {
  collection: string;
  name: string | null;
  symbol: string | null;
  creator: string | null;
  holder_count: number;
  unique_minters: number;
  total_minted: number;
  decayed_volume_eth: string | number;
  raw_volume_eth: string | number;
  unique_buyers: number;
  sales_count: number;
  wash_penalty: string | number;
  reciprocity: string | number;
  concentration: string | number;
  trending_score: string | number;
  backing_asset: string | null;
  floor_eth?: string | number | null;
  // Primary-sale (mint / Dutch-auction) volume signal.
  decayed_mint_volume_eth?: string | number;
  raw_mint_volume_eth?: string | number;
  mint_txns?: number;
};

export type CollectionMetrics = {
  collection: string;
  name: string | null;
  symbol: string | null;
  creator: string | null;
  holder_count: number;
  unique_minters: number;
  total_minted: number;
  decayed_volume_eth: string | number;
  raw_volume_eth: string | number;
  unique_buyers: number;
  sales_count: number;
  wash_penalty: string | number;
  reciprocity: string | number;
  concentration: string | number;
  floor_eth?: string | number | null;
  decayed_mint_volume_eth?: string | number;
  raw_mint_volume_eth?: string | number;
  mint_txns?: number;
  coin_address?: string | null; // fungible CollectionCoin vault, if market enabled
  pair_address?: string | null; // SushiSwap coin/ETH pair, if liquidity seeded
};

export type TokenRow = {
  id: string;
  collection: string;
  tokenId: string | number | bigint;
  owner: string;
  tba: string | null;
  minter: string | null;
  mintedAt: string | number | bigint | null;
};

export type HoldingRow = {
  id: string;
  tba: string;
  // camelCase from drizzle, snake_case from raw SQL — accept both.
  tokenRef?: string;
  token_ref?: string;
  asset: string;
  amount: string | number | bigint;
  updatedAt?: string | number | bigint | null;
  updated_at?: string | number | bigint | null;
  // Optional enrichment the pricing service may add.
  symbol?: string | null;
  decimals?: number | null;
  usd?: number | null;
};

export type CreatorEarnings = {
  account: string;
  mint_earnings_wei: string | null;
  claimed_wei: string | null;
  mint_events: number;
} | null;

// --- Response envelopes -------------------------------------------------------

export type CollectionDetail = {
  metrics: CollectionMetrics | null;
  tokens: TokenRow[];
};

export type TokenDetail = {
  token: TokenRow | null;
  holdings: HoldingRow[];
};

export type Portfolio = {
  tokens: TokenRow[];
  holdings: HoldingRow[];
};

export type CreatorProfile = {
  earnings: CreatorEarnings;
  created: Array<{
    address: string;
    creator: string;
    name: string | null;
    symbol: string | null;
    backingAsset: string | null;
    totalMinted: number;
    holderCount: number;
    volumeWei: string | number | bigint;
    createdAt: string | number | bigint;
  }>;
};

// --- Fetch helper -------------------------------------------------------------

async function getJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      // Always fetch fresh; screens set their own react-query cache policy.
      cache: "no-store",
      headers: { accept: "application/json" },
      // Bail fast during SSR/build if the indexer is down.
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return fallback;
    const data = (await res.json()) as T;
    return data ?? fallback;
  } catch {
    return fallback;
  }
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

// --- Public API ---------------------------------------------------------------

export async function getTrending(backing?: string): Promise<TrendingRow[]> {
  const qs = backing ? `?backing=${encodeURIComponent(backing)}` : "";
  const data = await getJson<unknown>(`/trending${qs}`, []);
  return asArray<TrendingRow>(data);
}

export async function getCollection(address: string): Promise<CollectionDetail> {
  const data = await getJson<Partial<CollectionDetail>>(
    `/collections/${address}`,
    {},
  );
  return {
    metrics: data.metrics ?? null,
    tokens: asArray<TokenRow>(data.tokens),
  };
}

export async function getToken(
  collection: string,
  tokenId: string,
): Promise<TokenDetail> {
  const data = await getJson<Partial<TokenDetail>>(
    `/tokens/${collection}/${tokenId}`,
    {},
  );
  return {
    token: data.token ?? null,
    holdings: asArray<HoldingRow>(data.holdings),
  };
}

export async function getPortfolio(owner: string): Promise<Portfolio> {
  const data = await getJson<Partial<Portfolio>>(`/portfolio/${owner}`, {});
  return {
    tokens: asArray<TokenRow>(data.tokens),
    holdings: asArray<HoldingRow>(data.holdings),
  };
}

export async function getCreator(address: string): Promise<CreatorProfile> {
  const data = await getJson<Partial<CreatorProfile>>(
    `/creators/${address}`,
    {},
  );
  return {
    earnings: data.earnings ?? null,
    created: asArray<CreatorProfile["created"][number]>(data.created),
  };
}

/** Normalise a holding's token reference across camel/snake variants. */
export function holdingTokenRef(h: HoldingRow): string {
  return h.tokenRef ?? h.token_ref ?? "";
}

// --- Bonding-curve token launchpad -----------------------------------------

export type LaunchTokenRow = {
  address: string;
  name: string | null;
  symbol: string | null;
  creator: string;
  createdAt: string | number;
  graduated: boolean;
  pair: string | null;
  lastPriceX18: string | number;
  realEthWei: string | number;
  volumeWei: string | number;
  tradeCount: number;
};

export type TradeRow = {
  id: string;
  token: string;
  trader: string;
  isBuy: boolean;
  ethAmount: string | number;
  tokenAmount: string | number;
  feeWei: string | number;
  priceX18: string | number;
  timestamp: string | number;
};

export async function getLaunchTokens(): Promise<LaunchTokenRow[]> {
  return asArray<LaunchTokenRow>(await getJson<LaunchTokenRow[]>("/launch/tokens", []));
}

export async function getLaunchToken(
  token: string,
): Promise<{ token: LaunchTokenRow | null; trades: TradeRow[]; series: { t: number; p: string }[] }> {
  const data = await getJson<{
    token: LaunchTokenRow | null;
    trades: TradeRow[];
    series: { t: number; p: string }[];
  }>(`/launch/${token}`, { token: null, trades: [], series: [] });
  return {
    token: data.token ?? null,
    trades: asArray<TradeRow>(data.trades),
    series: asArray<{ t: number; p: string }>(data.series),
  };
}

// --- Allowlist (services layer) ---------------------------------------------

export type AllowlistProof = {
  listed: boolean;
  proof: `0x${string}`[];
  root: `0x${string}` | null;
};

/** Fetch a minter's Merkle proof for an allowlist phase. */
export async function getAllowlistProof(
  collection: string,
  phase: number,
  address: string,
): Promise<AllowlistProof> {
  try {
    const res = await fetch(
      `${SERVICES_URL}/allowlist/proof?collection=${collection}&phase=${phase}&address=${address}`,
    );
    if (!res.ok) return { listed: false, proof: [], root: null };
    return (await res.json()) as AllowlistProof;
  } catch {
    return { listed: false, proof: [], root: null };
  }
}

/** Register an allowlist for a collection+phase (creator must be signed in). */
export async function registerAllowlist(
  collection: string,
  phase: number,
  addresses: string[],
): Promise<{ root: `0x${string}` | null; count: number }> {
  try {
    const res = await fetch(`${SERVICES_URL}/allowlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ collection, phase, addresses }),
    });
    if (!res.ok) return { root: null, count: 0 };
    return (await res.json()) as { root: `0x${string}` | null; count: number };
  } catch {
    return { root: null, count: 0 };
  }
}
