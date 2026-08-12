"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { HoldingRow, TokenRow } from "@/lib/api";
import { holdingTokenRef } from "@/lib/api";
import { usePortfolio } from "@/lib/hooks";
import {
  backingAssetLabel,
  formatAmount,
  formatUsd,
  normalizeAddress,
  shortAddress,
} from "@/lib/format";
import {
  holdingDecimals,
  holdingSymbol,
  holdingUsd,
  sumUsd,
} from "@/lib/pricing";
import {
  ArtMark,
  EmptyState,
  SectionHeader,
  Skeleton,
  Stat,
} from "@/components/ui";

export function PortfolioClient({ address }: { address: string }) {
  const addr = normalizeAddress(address);
  const { data, isLoading, dataUpdatedAt } = usePortfolio(addr);

  if (!addr) {
    return (
      <EmptyState
        title="Invalid address"
        action={
          <Link href="/" className="btn">
            Back to register
          </Link>
        }
      />
    );
  }

  const tokens = data?.tokens ?? [];
  const holdings = data?.holdings ?? [];
  const totalUsd = sumUsd(holdings);

  // Group holdings by their token reference for per-wallet subtotals.
  const byToken = useMemo(() => groupByToken(holdings), [holdings]);

  // Aggregate the same asset across every wallet.
  const byAsset = useMemo(() => groupByAsset(holdings), [holdings]);

  return (
    <div>
      <SectionHeader kicker="Aggregate" title="Portfolio" />

      <div className="certificate mb-8 p-6">
        <div className="label">Total value held inside your NFTs</div>
        <div className="mt-1 tnum text-5xl font-bold positive sm:text-6xl">
          {formatUsd(totalUsd)}
        </div>
        <p className="mt-2 text-sm text-[var(--muted)]">
          across{" "}
          <span className="tnum">{tokens.length}</span> wallet
          {tokens.length === 1 ? "" : "s"} for {shortAddress(addr, 6)}
          {dataUpdatedAt ? (
            <>
              {" · "}
              <span className="tnum">
                synced {new Date(dataUpdatedAt).toLocaleTimeString()}
              </span>
            </>
          ) : null}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="panel p-4">
          <Stat label="Signapads" value={tokens.length} />
        </div>
        <div className="panel p-4">
          <Stat label="Distinct assets" value={byAsset.length} />
        </div>
        <div className="panel p-4">
          <Stat label="Holdings" value={holdings.length} />
        </div>
        <div className="panel p-4">
          <Stat
            label="Est. value"
            value={formatUsd(totalUsd)}
            tone="positive"
          />
        </div>
      </div>

      {/* Aggregate asset breakdown */}
      <div className="mt-10">
        <SectionHeader kicker="Composition" title="Assets across all wallets" />
        {isLoading ? (
          <Skeleton className="h-32" />
        ) : byAsset.length === 0 ? (
          <EmptyState
            title="No assets held"
            hint="When your NFTs' token-bound accounts hold assets, they aggregate here."
          />
        ) : (
          <div className="panel overflow-x-auto">
            <table className="ledger text-sm">
              <thead>
                <tr>
                  <th className="label">Asset</th>
                  <th className="label">Total balance</th>
                  <th className="label text-right">Value (USD)</th>
                </tr>
              </thead>
              <tbody>
                {byAsset.map((a) => (
                  <tr key={a.asset}>
                    <td>
                      <span className="chip mr-2">{a.symbol}</span>
                      <span className="tnum text-xs text-[var(--muted)]">
                        {backingAssetLabel(a.asset)}
                      </span>
                    </td>
                    <td className="tnum">
                      {formatAmount(a.amount, a.decimals, 6)}
                    </td>
                    <td className="tnum text-right positive">
                      {a.usd > 0 ? formatUsd(a.usd) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Per-wallet grid */}
      <div className="mt-10">
        <SectionHeader kicker="Holdings" title="Your wallets" />
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-48" />
            ))}
          </div>
        ) : tokens.length === 0 ? (
          <EmptyState
            title="You don't hold any wallets yet"
            hint="Mint from a collection to receive a token that holds its own funded wallet."
            action={
              <Link href="/" className="btn btn-primary">
                Explore collections
              </Link>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tokens.map((t) => (
              <SignapadCard
                key={t.id}
                token={t}
                holdings={byToken.get(t.id) ?? []}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SignapadCard({
  token,
  holdings,
}: {
  token: TokenRow;
  holdings: HoldingRow[];
}) {
  const usd = sumUsd(holdings);
  return (
    <Link
      href={`/token/${token.collection}/${String(token.tokenId)}`}
      className="certificate group flex flex-col"
    >
      <div className="relative">
        <ArtMark
          seed={`${token.collection}:${token.tokenId}`}
          label={`#${String(token.tokenId)}`}
          className="h-28 w-full"
        />
        <span className="chip chip-positive absolute right-2 top-2 bg-[var(--paper)]">
          {formatUsd(usd)}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="tnum text-xs text-[var(--muted)]">
          {shortAddress(token.collection)} · #{String(token.tokenId)}
        </div>
        <ul className="mt-auto space-y-1 border-t border-[var(--rule)] pt-2 text-sm">
          {holdings.length === 0 ? (
            <li className="text-[var(--muted)]">empty wallet</li>
          ) : (
            holdings.slice(0, 3).map((h) => (
              <li key={h.id} className="flex items-center justify-between">
                <span className="chip">{holdingSymbol(h)}</span>
                <span className="tnum">
                  {formatAmount(h.amount, holdingDecimals(h), 4)}
                </span>
              </li>
            ))
          )}
        </ul>
      </div>
    </Link>
  );
}

// ---- Aggregation helpers ----------------------------------------------------

function groupByToken(holdings: HoldingRow[]): Map<string, HoldingRow[]> {
  const map = new Map<string, HoldingRow[]>();
  for (const h of holdings) {
    const ref = holdingTokenRef(h);
    if (!ref) continue;
    const arr = map.get(ref) ?? [];
    arr.push(h);
    map.set(ref, arr);
  }
  return map;
}

type AssetAgg = {
  asset: string;
  symbol: string;
  decimals: number;
  amount: bigint;
  usd: number;
};

function groupByAsset(holdings: HoldingRow[]): AssetAgg[] {
  const map = new Map<string, AssetAgg>();
  for (const h of holdings) {
    const key = h.asset.toLowerCase();
    const existing = map.get(key);
    const amount = toBig(h.amount);
    if (existing) {
      existing.amount += amount;
      existing.usd += holdingUsd(h);
    } else {
      map.set(key, {
        asset: h.asset,
        symbol: holdingSymbol(h),
        decimals: holdingDecimals(h),
        amount,
        usd: holdingUsd(h),
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.usd - a.usd);
}

function toBig(raw: string | number | bigint): bigint {
  try {
    if (typeof raw === "bigint") return raw;
    if (typeof raw === "number") return BigInt(Math.trunc(raw));
    const s = raw.trim();
    if (s === "" || s.includes(".")) return 0n;
    return BigInt(s);
  } catch {
    return 0n;
  }
}
