import { formatUnits, isAddress, zeroAddress, type Address } from "viem";

/** Truncate an address to `0x1234…abcd`. Returns "—" for empty/invalid. */
export function shortAddress(addr?: string | null, size = 4): string {
  if (!addr || typeof addr !== "string") return "—";
  if (!isAddress(addr)) return addr.length > 12 ? `${addr.slice(0, 6)}…` : addr;
  return `${addr.slice(0, 2 + size)}…${addr.slice(-size)}`;
}

/**
 * Format a raw token amount (string | number | bigint of base units) into a
 * human decimal string. Defensive: never throws on garbage, returns "0".
 */
export function formatAmount(
  raw: string | number | bigint | null | undefined,
  decimals = 18,
  maxFractionDigits = 4,
): string {
  if (raw === null || raw === undefined) return "0";
  let asBig: bigint;
  try {
    if (typeof raw === "bigint") asBig = raw;
    else if (typeof raw === "number") asBig = BigInt(Math.trunc(raw));
    else {
      const cleaned = raw.trim();
      if (cleaned === "" || cleaned === "NaN") return "0";
      // Some sources hand back a decimal string already.
      if (cleaned.includes(".")) {
        const n = Number(cleaned);
        return Number.isFinite(n) ? trimNum(n, maxFractionDigits) : "0";
      }
      asBig = BigInt(cleaned);
    }
  } catch {
    return "0";
  }
  const asString = formatUnits(asBig, decimals);
  return trimNum(Number(asString), maxFractionDigits);
}

function trimNum(n: number, maxFractionDigits: number): string {
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  });
}

/** Format an ETH-denominated number (already in ETH units) for ledger display. */
export function formatEth(
  value: string | number | null | undefined,
  digits = 4,
): string {
  const n = typeof value === "string" ? Number(value) : value ?? 0;
  if (n === null || n === undefined || !Number.isFinite(n as number)) return "0";
  return (n as number).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

/** Format a USD value with thousands separators and 2 decimals. */
export function formatUsd(value: number | null | undefined): string {
  const n = value ?? 0;
  if (!Number.isFinite(n)) return "$0.00";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Whole-number formatting with separators. */
export function formatInt(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? Number(value) : value ?? 0;
  if (!Number.isFinite(n as number)) return "0";
  return Math.trunc(n as number).toLocaleString("en-US");
}

/** basis points → percentage string, e.g. 500 → "5%". */
export function bpsToPct(bps: number | string | null | undefined): string {
  const n = typeof bps === "string" ? Number(bps) : bps ?? 0;
  if (!Number.isFinite(n as number)) return "0%";
  const pct = (n as number) / 100;
  return `${trimNum(pct, 2)}%`;
}

/** Human label for a backing asset address (native ETH vs ERC-20). */
export function backingAssetLabel(asset?: string | null): string {
  if (!asset || asset.toLowerCase() === zeroAddress) return "ETH";
  return shortAddress(asset);
}

/** Countdown from now to a unix-seconds timestamp, as a compact string. */
export function countdown(target?: number | bigint | null): string {
  if (target === null || target === undefined) return "—";
  const t = typeof target === "bigint" ? Number(target) : target;
  const secs = Math.floor(t - Date.now() / 1000);
  if (secs <= 0) return "live";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export const NATIVE = zeroAddress;

/** Safe address normaliser for route params. */
export function normalizeAddress(raw?: string | null): Address | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return isAddress(trimmed) ? (trimmed.toLowerCase() as Address) : null;
}
