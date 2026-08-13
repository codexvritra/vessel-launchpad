"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { TrendingRow } from "@/lib/api";
import { useTrending } from "@/lib/hooks";
import { useWatchNewCollections } from "@/lib/realtime";
import { formatInt, shortAddress } from "@/lib/format";
import { ArtMark } from "@/components/ui";

// Preview collections so the board shows the full art-forward layout before any
// real collection is launched / indexed. Live indexer data always replaces these.
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

const SAMPLES: DisplayCollection[] = [
  { address: "0xC0113c710000000000000000000000000000a001", name: "Hood Apes", symbol: "HAPE", ageLabel: "6d", ageMinutes: 8640, minted: 842, supply: 1000, floorEth: 0.08, holders: 512 },
  { address: "0xC0113c710000000000000000000000000000a002", name: "Pixel Newts", symbol: "NEWT", ageLabel: "2d", ageMinutes: 2880, minted: 1990, supply: 2000, floorEth: 0.14, holders: 1204 },
  { address: "0xC0113c710000000000000000000000000000a003", name: "Robin Punks", symbol: "RPNK", ageLabel: "1d", ageMinutes: 1440, minted: 333, supply: 5000, floorEth: 0.05, holders: 289 },
  { address: "0xC0113c710000000000000000000000000000a004", name: "Green Pill Club", symbol: "PILL", ageLabel: "3h", ageMinutes: 180, minted: 120, supply: 500, floorEth: 0.2, holders: 96 },
  { address: "0xC0113c710000000000000000000000000000a005", name: "Moon Rabbits", symbol: "MRBT", ageLabel: "9d", ageMinutes: 12960, minted: 3000, supply: 3000, floorEth: 0.11, holders: 1820 },
  { address: "0xC0113c710000000000000000000000000000a006", name: "Turbo Frogs", symbol: "FROG", ageLabel: "5d", ageMinutes: 7200, minted: 640, supply: 888, floorEth: 0.06, holders: 431 },
  { address: "0xC0113c710000000000000000000000000000a007", name: "Diamond Paws", symbol: "DPAW", ageLabel: "12h", ageMinutes: 720, minted: 210, supply: 1000, floorEth: 0.09, holders: 178 },
  { address: "0xC0113c710000000000000000000000000000a008", name: "Based Ducks", symbol: "DUCK", ageLabel: "7d", ageMinutes: 10080, minted: 4444, supply: 4444, floorEth: 0.03, holders: 2510 },
  { address: "0xC0113c710000000000000000000000000000a009", name: "Zen Goblins", symbol: "ZGOB", ageLabel: "1h", ageMinutes: 60, minted: 58, supply: 777, floorEth: 0.12, holders: 44 },
  { address: "0xC0113c710000000000000000000000000000a010", name: "Nano Whales", symbol: "WHALE", ageLabel: "4d", ageMinutes: 5760, minted: 900, supply: 1200, floorEth: 0.07, holders: 655 },
];

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
  const { data } = useTrending(undefined);
  const [tab, setTab] = useState<Tab>("trending");

  const { list, preview } = useMemo(() => {
    const live = (data ?? []).map(rowToCollection);
    if (live.length > 0) return { list: live, preview: false };
    return { list: SAMPLES, preview: true };
  }, [data]);

  const top = useMemo(
    () => [...list].sort((a, b) => b.holders - a.holders).slice(0, 6),
    [list],
  );
  const grid = useMemo(() => sortBy(list, tab), [list, tab]);

  return (
    <div>
      {/* Hero — left-aligned, Launch button on the right (pools.trade style) */}
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

      {preview ? (
        <p className="mb-4 text-xs text-[var(--muted)]">
          Preview — sample collections shown until real launches are indexed.
        </p>
      ) : null}

      {/* Top collections — horizontal shelf */}
      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-[var(--ink)]">
          Top collections
        </h2>
        <div
          className="flex gap-3 overflow-x-auto pb-2"
          style={{ scrollbarWidth: "thin", scrollSnapType: "x proximity" }}
        >
          {top.map((c) => (
            <ShelfCard key={c.address} c={c} preview={preview} />
          ))}
        </div>
      </section>

      {/* All launches — tabs + art grid */}
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
            <ArtCard key={c.address} c={c} preview={preview} />
          ))}
        </div>
      </section>
    </div>
  );
}

function floor(n: number): string {
  return n > 0 ? n.toFixed(2) : "—";
}

/** Horizontal card: art on the left, stats on the right. */
function ShelfCard({ c, preview }: { c: DisplayCollection; preview: boolean }) {
  return (
    <Link
      href={preview ? "/launch" : `/collection/${c.address}`}
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

/** Art-forward square card with overlaid title/stats. */
function ArtCard({ c, preview }: { c: DisplayCollection; preview: boolean }) {
  const pct = c.supply ? Math.min(100, (c.minted / c.supply) * 100) : 0;
  return (
    <Link
      href={preview ? "/launch" : `/collection/${c.address}`}
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
