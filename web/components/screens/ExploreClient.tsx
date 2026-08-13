"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { TrendingRow } from "@/lib/api";
import { useTrending } from "@/lib/hooks";
import { useWatchNewCollections } from "@/lib/realtime";
import { formatInt, shortAddress } from "@/lib/format";
import { ArtMark, TokenLogo } from "@/components/ui";

type DisplayCollection = {
  address: string;
  name: string;
  symbol: string;
  ageLabel: string;
  ageMinutes: number;
  minted: number;
  supply: number;
  floorEth: number;
  holders: number;
};

type Tab = "trending" | "new" | "top";
const TABS: { key: Tab; label: string }[] = [
  { key: "trending", label: "Trending" },
  { key: "new", label: "New" },
  { key: "top", label: "Top" },
];

function rowToCollection(r: TrendingRow): DisplayCollection {
  return {
    address: r.collection,
    name: r.name || shortAddress(r.collection),
    symbol: r.symbol || "NFT",
    ageLabel: "live",
    ageMinutes: 0,
    minted: Number(r.total_minted ?? 0),
    supply: 0,
    floorEth: Number(r.floor_eth ?? 0),
    holders: Number(r.holder_count ?? 0),
  };
}

function sortBy(list: DisplayCollection[], tab: Tab): DisplayCollection[] {
  const t = [...list];
  if (tab === "new") return t.sort((a, b) => a.ageMinutes - b.ageMinutes);
  if (tab === "top") return t.sort((a, b) => b.holders - a.holders);
  return t.sort((a, b) => b.minted - a.minted);
}

export function ExploreClient() {
  useWatchNewCollections();
  const { data, isLoading } = useTrending(undefined);
  const [tab, setTab] = useState<Tab>("trending");

  const list = useMemo(() => (data ?? []).map(rowToCollection), [data]);
  const hasData = list.length > 0;

  const top = useMemo(
    () => [...list].sort((a, b) => b.holders - a.holders).slice(0, 6),
    [list],
  );
  const grid = useMemo(() => sortBy(list, tab), [list, tab]);

  return (
    <div>
      <section className="flex flex-col gap-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:py-14">
        <div className="max-w-xl">
          <h1 className="text-2xl font-semibold leading-tight text-[var(--ink)] sm:text-[30px]">
            A new way to launch and mint NFTs.
          </h1>
          <p className="mt-2 text-[var(--muted)] sm:text-lg">
            Built by <span className="font-semibold text-[var(--ink)]">Signapad</span>{" "}
            for{" "}
            <span className="font-semibold text-[var(--ink)]">Robinhood Chain</span>.
          </p>
        </div>
        <Link
          href="/launch"
          className="btn btn-primary self-start text-base sm:self-auto"
          style={{ padding: "0.75rem 1.5rem" }}
        >
          Launch an NFT
        </Link>
      </section>

      {!hasData ? (
        <EmptyState loading={isLoading} />
      ) : (
        <>
          <section className="mb-10">
            <h2 className="mb-3 text-lg font-semibold text-[var(--ink)]">
              Top collections
            </h2>
            <div
              className="flex gap-3 overflow-x-auto pb-2"
              style={{ scrollbarWidth: "thin", scrollSnapType: "x proximity" }}
            >
              {top.map((c) => (
                <ShelfCard key={c.address} c={c} />
              ))}
            </div>
          </section>

          <section>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <h2 className="mr-2 text-lg font-semibold text-[var(--ink)]">
                All launches
              </h2>
              {TABS.map((tb) => {
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
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {grid.map((c) => (
                <ArtCard key={c.address} c={c} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function EmptyState({ loading }: { loading: boolean }) {
  return (
    <section className="certificate flex flex-col items-center gap-3 px-6 py-20 text-center">
      <TokenLogo symbol="S" seed="signapad-empty" className="h-14 w-14 text-xl" />
      <h2 className="text-lg font-semibold text-[var(--ink)]">
        {loading ? "Loading collections…" : "No collections launched yet"}
      </h2>
      <p className="max-w-sm text-sm text-[var(--muted)]">
        Be the first — launch an NFT collection in a few seconds. It appears here
        once the indexer picks it up.
      </p>
      <Link href="/launch" className="btn btn-primary">
        Launch an NFT
      </Link>
    </section>
  );
}

function floor(n: number): string {
  return n > 0 ? n.toFixed(2) : "—";
}

function ShelfCard({ c }: { c: DisplayCollection }) {
  return (
    <Link
      href={`/collection/${c.address}`}
      className="certificate card-hover flex w-[330px] shrink-0 overflow-hidden"
      style={{ scrollSnapAlign: "start" }}
    >
      <div className="relative h-28 w-28 shrink-0">
        <ArtMark seed={c.address} className="h-full w-full" />
        <span
          className="chip absolute left-1.5 top-1.5"
          style={{ fontSize: "0.6rem", padding: "0.1rem 0.4rem" }}
        >
          {c.ageLabel}
        </span>
      </div>
      <div className="flex flex-1 flex-col justify-center gap-1.5 p-3">
        <div className="truncate font-semibold text-[var(--ink)]">{c.name}</div>
        <div className="flex items-baseline gap-1">
          <span className="tnum text-lg font-bold text-[var(--ink)]">
            {floor(c.floorEth)}
          </span>
          <span className="text-xs text-[var(--muted)]">Ξ floor</span>
        </div>
        <div className="flex justify-between text-xs text-[var(--muted)]">
          <span className="tnum">
            {formatInt(c.minted)}
            {c.supply ? `/${formatInt(c.supply)}` : ""} minted
          </span>
          <span className="tnum">{formatInt(c.holders)} holders</span>
        </div>
      </div>
    </Link>
  );
}

function ArtCard({ c }: { c: DisplayCollection }) {
  const pct = c.supply ? Math.min(100, (c.minted / c.supply) * 100) : 0;
  return (
    <Link
      href={`/collection/${c.address}`}
      className="certificate card-hover overflow-hidden"
    >
      <div className="relative aspect-square">
        <ArtMark seed={c.address} label={c.symbol} className="h-full w-full" />
        <span
          className="chip absolute left-2 top-2"
          style={{ fontSize: "0.6rem", padding: "0.1rem 0.4rem" }}
        >
          {c.ageLabel}
        </span>
        <div
          className="absolute inset-x-0 bottom-0 p-2.5"
          style={{
            background: "linear-gradient(to top, rgba(0,0,0,0.88), transparent)",
          }}
        >
          <div className="truncate text-sm font-semibold text-white">
            {c.name}
          </div>
          <div className="mt-0.5 flex items-center justify-between text-xs text-white/80">
            <span className="tnum">
              {formatInt(c.minted)}
              {c.supply ? `/${formatInt(c.supply)}` : ""}
            </span>
            <span className="tnum">{floor(c.floorEth)} Ξ</span>
          </div>
          {c.supply ? (
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-white/20">
              <div
                className="h-full"
                style={{ width: `${pct}%`, background: "var(--vermilion)" }}
              />
            </div>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
