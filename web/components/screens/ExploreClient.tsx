"use client";

import Link from "next/link";
import type { TrendingRow } from "@/lib/api";
import { useTrending } from "@/lib/hooks";
import { useWatchNewCollections } from "@/lib/realtime";
import { formatEth, formatInt, shortAddress } from "@/lib/format";
import { TokenLogo } from "@/components/ui";

/** NFT launchpad home: browse launched collections and jump in to mint. */
export function ExploreClient() {
  useWatchNewCollections();
  const { data, isLoading } = useTrending(undefined);
  const rows = data ?? [];
  const hasRows = rows.length > 0;

  return (
    <div>
      <Hero />

      <section>
        <div className="mb-4 flex items-center gap-2">
          <h2 className="text-lg font-semibold text-[var(--ink)]">
            Top collections
          </h2>
          <span className="chip chip-accent">Live</span>
        </div>

        {isLoading ? (
          <Grid>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="skeleton h-52" />
            ))}
          </Grid>
        ) : !hasRows ? (
          <EmptyLaunchState />
        ) : (
          <Grid>
            {rows.map((r) => (
              <CollectionCard key={r.collection} row={r} />
            ))}
          </Grid>
        )}
      </section>
    </div>
  );
}

function Hero() {
  return (
    <section className="flex flex-col items-center py-12 text-center sm:py-16">
      <h1 className="max-w-xl text-2xl font-semibold leading-snug text-[var(--ink)] sm:text-[30px]">
        Launch and mint NFTs on Robinhood Chain.
      </h1>
      <p className="mt-2 text-sm text-[var(--muted)] sm:text-base">
        Deploy a collection in seconds — set your supply and price, and anyone
        can mint.
      </p>
      <div className="mt-6">
        <Link href="/launch" className="btn btn-primary text-base">
          Launch an NFT
        </Link>
      </div>
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {children}
    </div>
  );
}

function EmptyLaunchState() {
  return (
    <section className="certificate flex flex-col items-center gap-3 px-6 py-16 text-center">
      <TokenLogo symbol="S" seed="signapad-empty" className="h-14 w-14 text-xl" />
      <h2 className="text-lg font-semibold text-[var(--ink)]">
        No collections launched yet
      </h2>
      <p className="max-w-sm text-sm text-[var(--muted)]">
        Be the first — deploy an NFT collection in a few seconds and share a mint
        page.
      </p>
      <Link href="/launch" className="btn btn-primary">
        Launch an NFT
      </Link>
    </section>
  );
}

function CollectionCard({ row }: { row: TrendingRow }) {
  const name = row.name || shortAddress(row.collection);
  const symbol = row.symbol || "NFT";
  const minted = formatInt(row.total_minted ?? 0);
  const floor = row.floor_eth != null ? formatEth(row.floor_eth) : "—";
  const holders = formatInt(row.holder_count ?? 0);

  return (
    <Link
      href={`/collection/${row.collection}`}
      className="certificate card-hover group flex flex-col gap-3 p-4"
    >
      <div className="flex items-center justify-between">
        <span className="chip">Collection</span>
        <span
          className="btn btn-primary"
          style={{ padding: "0.3rem 0.9rem", fontSize: "0.8rem" }}
        >
          Mint
        </span>
      </div>

      <div className="flex items-center gap-2.5">
        <TokenLogo symbol={symbol} seed={row.collection} className="h-10 w-10" />
        <div className="min-w-0">
          <div className="truncate font-semibold leading-tight text-[var(--ink)] group-hover:text-[var(--vermilion)]">
            {name}
          </div>
          <div className="tnum text-xs text-[var(--muted)]">{symbol}</div>
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-2 border-t border-[var(--rule)] pt-3">
        <Cell label="Minted" value={minted} />
        <Cell label="Floor" value={`${floor} Ξ`} />
        <Cell label="Holders" value={holders} />
      </dl>
    </Link>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label" style={{ fontSize: "0.6rem" }}>
        {label}
      </div>
      <div className="tnum text-sm font-semibold text-[var(--ink)]">{value}</div>
    </div>
  );
}
