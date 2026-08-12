import { formatUnits, zeroAddress } from "viem";
import type { HoldingRow } from "./api";

/**
 * Client-side USD estimation for TBA holdings.
 *
 * TODO(pricing): the indexer's pricing service is expected to enrich holdings
 * with `usd` (and `symbol`/`decimals`) via Chainlink. When present we trust it.
 * Absent that, we fall back to a static reference ETH price so the "NFT is a
 * funded wallet" value is still legible offline. This constant is a placeholder,
 * NOT a live quote.
 */
export const REFERENCE_ETH_USD = 3200;

export function holdingDecimals(h: HoldingRow): number {
  return typeof h.decimals === "number" && h.decimals >= 0 ? h.decimals : 18;
}

export function holdingSymbol(h: HoldingRow): string {
  if (h.symbol) return h.symbol;
  if (!h.asset || h.asset.toLowerCase() === zeroAddress) return "ETH";
  return "TOKEN";
}

/** Best-effort USD value for a single holding. */
export function holdingUsd(h: HoldingRow): number {
  if (typeof h.usd === "number" && Number.isFinite(h.usd)) return h.usd;
  // Only native ETH gets a fallback quote; unknown ERC-20s contribute 0.
  const isNative = !h.asset || h.asset.toLowerCase() === zeroAddress;
  if (!isNative) return 0;
  try {
    const eth = Number(formatUnits(toBig(h.amount), 18));
    return Number.isFinite(eth) ? eth * REFERENCE_ETH_USD : 0;
  } catch {
    return 0;
  }
}

export function sumUsd(holdings: HoldingRow[]): number {
  return holdings.reduce((acc, h) => acc + holdingUsd(h), 0);
}

function toBig(raw: string | number | bigint): bigint {
  if (typeof raw === "bigint") return raw;
  if (typeof raw === "number") return BigInt(Math.trunc(raw));
  const s = raw.trim();
  if (s.includes(".")) return 0n;
  return s === "" ? 0n : BigInt(s);
}
