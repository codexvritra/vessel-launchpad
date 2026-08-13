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

/** Base URL of the Signapad services layer (metadata, auth, allowlist proofs). */
export const SERVICES_URL = (
  process.env.NEXT_PUBLIC_SERVICES_URL || "http://localhost:8080"
).replace(/\/$/, "");

export const API_URL = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:42069"
).replace(/\/$/, "");

export const WC_PROJECT_ID =
  process.env.NEXT_PUBLIC_WC_PROJECT_ID?.trim() || "wallet_placeholder_project_id";

// Deployed on Robinhood Chain mainnet (chain 4663, block 34671304). Baked in as
// defaults so the app is functional with no env vars; override per-environment
// with the matching NEXT_PUBLIC_* variable.
const DEPLOYED = {
  factory: "0xe9f3c226eb834f57cac14e63a4f9f63f68dcccce",
  tokenLauncher: "0xb43f644d78e230bde09217c83e15175c3cefe48e",
  guard: "0xfcaedb4b770ab46ce316138f08e20c71a40e534b",
  feeSplitter: "0x9c38ef1f37574d658a15865128945b8621291e86",
  coinFactory: "0x50f14380495989353865bda4da9df2e7a38fe292",
  marketDeployer: "0x600803023700743b7a697ed3909c58598de763cb",
  liquidityLauncher: "0xae1da370c817d10ca2a3da913a6abc3ed87756e5",
  bondingCurve: "0x515402397d263a42d3053c0b3c4bbd2c1aa27587",
  bcnftFactory: "0xa83ecec0ebab517bf47da015a621a7cb0c6a27c4",
} as const;

/** Bonding-curve NFT launchpad factory (buy = mint at rising price, sell = burn). */
export const BCNFT_FACTORY_ADDRESS = readAddress(
  process.env.NEXT_PUBLIC_BCNFT_FACTORY,
  getAddress(DEPLOYED.bcnftFactory),
);

export const FACTORY_ADDRESS = readAddress(
  process.env.NEXT_PUBLIC_FACTORY,
  getAddress(DEPLOYED.factory),
);
export const GUARD_ADDRESS = readAddress(
  process.env.NEXT_PUBLIC_GUARD,
  getAddress(DEPLOYED.guard),
);
export const FEE_SPLITTER_ADDRESS = readAddress(
  process.env.NEXT_PUBLIC_FEE_SPLITTER,
  getAddress(DEPLOYED.feeSplitter),
);
export const COIN_FACTORY_ADDRESS = readAddress(
  process.env.NEXT_PUBLIC_COIN_FACTORY,
  getAddress(DEPLOYED.coinFactory),
);
export const MARKET_DEPLOYER_ADDRESS = readAddress(
  process.env.NEXT_PUBLIC_MARKET_DEPLOYER,
  getAddress(DEPLOYED.marketDeployer),
);
export const LIQUIDITY_LAUNCHER_ADDRESS = readAddress(
  process.env.NEXT_PUBLIC_LIQUIDITY_LAUNCHER,
  getAddress(DEPLOYED.liquidityLauncher),
);
export const BONDING_CURVE_ADDRESS = readAddress(
  process.env.NEXT_PUBLIC_BONDING_CURVE,
  getAddress(DEPLOYED.bondingCurve),
);
export const TOKEN_LAUNCHER_ADDRESS = readAddress(
  process.env.NEXT_PUBLIC_TOKEN_LAUNCHER,
  getAddress(DEPLOYED.tokenLauncher),
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
