"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { TrendingRow } from "@/lib/api";
import { useTrending } from "@/lib/hooks";
import { useWatchNewCollections } from "@/lib/realtime";
import { shortAddress } from "@/lib/format";
import {
  DEMO_TOKENS,
  EXPLORE_TABS,
  formatUsd,
  sortTokens,
  type DisplayToken,
  type ExploreTab,
} from "@/lib/demo";
import { TokenLogo } from "@/components/ui";

// Local-only preview switch. Off by default: the site shows ONLY tokens launched
// on Signapad (from the indexer). Set NEXT_PUBLIC_SHOW_DEMO=1 to preview the
// populated layout without a running chain/indexer.
const SHOW_DEMO = process.env.NEXT_PUBLIC_SHOW_DEMO === "1";

function rowToToken(row: TrendingRow): DisplayToken {
  return {
    address: row.collection,
    name: row.name || shortAddress(row.collection),
    symbol: row.symbol || "TOKEN",
    ageLabel: "live",
    ageMinutes: 0,
    fdvUsd: Number(row.floor_eth ?? 0) * 3000 * 1000,
    changePct: 0,
    volumeUsd: Number(row.decayed_volume_eth ?? 0) * 3000,
    holders: Number(row.holder_count ?? 0),
    graduationPct: 100,
  };
}

export function ExploreClient() {
  useWatchNewCollections();
  const { data, isLoading } = useTrending(undefined);
  const [tab, setTab] = useState<ExploreTab>("trending");

  const { tokens, preview } = useMemo(() => {
    const live = (data ?? []).map(rowToToken);
    if (live.length > 0) return { tokens: live, preview: false };
    if (SHOW_DEMO) return { tokens: DEMO_TOKENS, preview: true };
    return { tokens: [] as DisplayToken[], preview: false };
  }, [data]);

  const top = useMemo(
    () => [...tokens].sort((a, b) => b.volumeUsd - a.volumeUsd).slice(0, 8),
    [tokens],
  );
  const listed = useMemo(() => sortTokens(tokens, tab), [tokens, tab]);
  const hasTokens = tokens.length > 0;

  return (
    <div>
      <Hero />

      {!hasTokens ? (
        <EmptyLaunchState loading={isLoading} />
      ) : (
        <>
          {preview ? (
            <p className="mb-4 text-center text-xs text-[var(--muted)]">
              Preview data (NEXT_PUBLIC_SHOW_DEMO). Real launches replace this.
            </p>
          ) : null}

          <section className="mb-10">
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-lg font-semibold text-[var(--ink)]">
                Top tokens
              </h2>
              <span className="chip chip-accent">Live</span>
            </div>
            <div
              className="flex gap-3 overflow-x-auto pb-2"
              style={{ scrollbarWidth: "thin", scrollSnapType: "x proximity" }}
            >
              {top.map((t) => (
                <TokenCard
                  key={t.address}
                  token={t}
                  className="w-[300px] shrink-0"
                />
              ))}
            </div>
          </section>

          <section>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <h2 className="mr-2 text-lg font-semibold text-[var(--ink)]">
                All launches
              </h2>
              {EXPLORE_TABS.map((tb) => {
                const active = tb.key === tab;
                return (
                  <button
                    key={tb.key}
                    onClick={() => setTab(tb.key)}
                    className="btn"
                    style={{
                      padding: "0.4rem 0.9rem",
                      fontSize: "0.85rem",
                      background: active ? "var(--surface-2)" : "transparent",
                      borderColor: active
                        ? "color-mix(in srgb, var(--vermilion) 45%, var(--rule))"
                        : "var(--rule)",
                      color: active ? "var(--vermilion)" : "var(--muted)",
                    }}
                  >
                    {tb.label}
                  </button>
                );
              })}
              <Link
                href="/t"
                className="btn btn-primary ml-auto"
                style={{ padding: "0.45rem 1rem" }}
              >
                Launch a token
              </Link>
            </div>

            {listed.length === 0 ? (
              <div className="certificate p-10 text-center text-[var(--muted)]">
                No tokens in this view right now.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {listed.map((t) => (
                  <TokenCard key={t.address} token={t} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Hero() {
  return (
    <section className="flex flex-col items-center py-12 text-center sm:py-16">
      <h1 className="max-w-xl text-2xl font-medium leading-snug text-[var(--ink)] sm:text-[28px]">
        A new way to launch and trade tokens.
      </h1>
      <p className="mt-2 text-sm text-[var(--muted)] sm:text-base">
        Built by <span className="font-semibold text-[var(--ink)]">Signapad</span>{" "}
        for{" "}
        <span className="font-semibold text-[var(--ink)]">Robinhood Chain</span>.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link href="/t" className="btn btn-primary text-base">
          Launch a token
        </Link>
        <Link href="/launch" className="btn text-base">
          Launch an NFT
        </Link>
      </div>
    </section>
  );
}

function EmptyLaunchState({ loading }: { loading: boolean }) {
  return (
    <section className="certificate flex flex-col items-center gap-3 px-6 py-16 text-center">
      <TokenLogo symbol="S" seed="signapad-empty" className="h-14 w-14 text-xl" />
      <h2 className="text-lg font-semibold text-[var(--ink)]">
        {loading ? "Loading launches…" : "No tokens launched on Signapad yet"}
      </h2>
      <p className="max-w-sm text-sm text-[var(--muted)]">
        This board only lists tokens launched here. Be the first — deploy a token
        straight to the DEX in a few seconds.
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        <Link href="/t" className="btn btn-primary">
          Launch a token
        </Link>
        <Link href="/launch" className="btn">
          Launch an NFT
        </Link>
      </div>
    </section>
  );
}

/** pools.trade-style token card: age chip, white Buy pill, logo + name, FDV,
 *  colored 24h change, 24H volume and holders. */
function TokenCard({
  token,
  className = "",
}: {
  token: DisplayToken;
  className?: string;
}) {
  const up = token.changePct >= 0;
  return (
    <Link
      href={`/t/${token.address}`}
      className={`certificate card-hover group flex flex-col gap-3 p-4 ${className}`}
      style={{ scrollSnapAlign: "start" }}
    >
      <div className="flex items-center justify-between">
        <span className="chip tnum">{token.ageLabel}</span>
        <span
          className="btn btn-buy"
          style={{ padding: "0.3rem 0.9rem", fontSize: "0.8rem" }}
        >
          Buy {token.symbol}
        </span>
      </div>

      <div className="flex items-center gap-2.5">
        <TokenLogo
          symbol={token.symbol}
          seed={token.address}
          className="h-9 w-9"
        />
        <div className="min-w-0">
          <div className="truncate font-semibold leading-tight text-[var(--ink)]">
            {token.name}
          </div>
          <div className="tnum text-xs text-[var(--muted)]">${token.symbol}</div>
        </div>
      </div>

      <div className="flex items-end justify-between">
        <div>
          <div className="label" style={{ fontSize: "0.6rem" }}>
            FDV
          </div>
          <div className="tnum text-2xl font-extrabold text-[var(--ink)]">
            {formatUsd(token.fdvUsd)}
          </div>
        </div>
        <span className={`tnum text-sm font-semibold ${up ? "up" : "down"}`}>
          {up ? "▲" : "▼"} {Math.abs(token.changePct).toFixed(1)}%
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-2 border-t border-[var(--rule)] pt-3">
        <div>
          <div className="label" style={{ fontSize: "0.6rem" }}>
            24H volume
          </div>
          <div className="tnum text-sm font-semibold text-[var(--ink)]">
            {formatUsd(token.volumeUsd)}
          </div>
        </div>
        <div>
          <div className="label" style={{ fontSize: "0.6rem" }}>
            Holders
          </div>
          <div className="tnum text-sm font-semibold text-[var(--ink)]">
            {token.holders.toLocaleString("en-US")}
          </div>
        </div>
      </dl>
    </Link>
  );
}
