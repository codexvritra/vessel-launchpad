import { type Address, getAddress, zeroAddress } from "viem";

/**
 * Centralised, guarded reads of every `NEXT_PUBLIC_*` variable. Every value
 * has a sane fallback so the app builds and renders with no environment at
 * all (no chain, no indexer, no wallet).
 */

function readAddress(raw: string | undefined, fallback: Address): Address {
  if (!raw) return fallback;
  try {
    return getAddress(raw.trim());
  } catch {
    return fallback;
  }
}

function readInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

// Defaults target Robinhood Chain MAINNET (chain 4663). Override per-environment
// with NEXT_PUBLIC_CHAIN_ID / NEXT_PUBLIC_RPC_URL (e.g. testnet 46630, local 31337).
export const CHAIN_ID = readInt(process.env.NEXT_PUBLIC_CHAIN_ID, 4663);

export const RPC_URL = (
  process.env.NEXT_PUBLIC_RPC_URL || "https://rpc.mainnet.chain.robinhood.com"
).trim();

/**
 * Optional WebSocket RPC. When set, wagmi subscribes to chain events over ws
 * (true push); otherwise it falls back to http polling. Enables live supply and
 * new-collection updates.
 */
export const WS_RPC_URL = process.env.NEXT_PUBLIC_WS_RPC_URL?.trim() || "";

/** Base URL of the Vessel services layer (metadata, auth, allowlist proofs). */
export const SERVICES_URL = (
  process.env.NEXT_PUBLIC_SERVICES_URL || "http://localhost:8080"
).replace(/\/$/, "");

export const API_URL = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:42069"
).replace(/\/$/, "");

export const WC_PROJECT_ID =
  process.env.NEXT_PUBLIC_WC_PROJECT_ID?.trim() || "vessel_placeholder_project_id";

export const FACTORY_ADDRESS = readAddress(
  process.env.NEXT_PUBLIC_FACTORY,
  zeroAddress,
);
export const GUARD_ADDRESS = readAddress(
  process.env.NEXT_PUBLIC_GUARD,
  zeroAddress,
);
export const FEE_SPLITTER_ADDRESS = readAddress(
  process.env.NEXT_PUBLIC_FEE_SPLITTER,
  zeroAddress,
);
export const COIN_FACTORY_ADDRESS = readAddress(
  process.env.NEXT_PUBLIC_COIN_FACTORY,
  zeroAddress,
);
export const MARKET_DEPLOYER_ADDRESS = readAddress(
  process.env.NEXT_PUBLIC_MARKET_DEPLOYER,
  zeroAddress,
);
export const LIQUIDITY_LAUNCHER_ADDRESS = readAddress(
  process.env.NEXT_PUBLIC_LIQUIDITY_LAUNCHER,
  zeroAddress,
);
export const BONDING_CURVE_ADDRESS = readAddress(
  process.env.NEXT_PUBLIC_BONDING_CURVE,
  zeroAddress,
);
export const TOKEN_LAUNCHER_ADDRESS = readAddress(
  process.env.NEXT_PUBLIC_TOKEN_LAUNCHER,
  zeroAddress,
);
/** Base URL for a DexScreener token page, for direct-to-DEX launched tokens. */
export const DEXSCREENER_URL = (
  process.env.NEXT_PUBLIC_DEXSCREENER_URL || "https://dexscreener.com/robinhood"
).replace(/\/$/, "");
/** Base URL of the SushiSwap swap UI for building trade links (optional). */
export const SUSHI_SWAP_URL = (
  process.env.NEXT_PUBLIC_SUSHI_SWAP_URL || "https://www.sushi.com/swap"
).replace(/\/$/, "");

/** True when a contract address is configured (not the zero placeholder). */
export function isConfigured(addr: Address): boolean {
  return addr !== zeroAddress;
}
