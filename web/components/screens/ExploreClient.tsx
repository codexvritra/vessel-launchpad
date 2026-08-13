"use client";

import Link from "next/link";
import { useMemo } from "react";
import { formatEther, type Address } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { bcnftFactoryAbi, bondingCurveNftAbi } from "@/lib/abi";
import { BCNFT_FACTORY_ADDRESS, isConfigured } from "@/lib/config";
import { shortAddress } from "@/lib/format";
import { ArtMark } from "@/components/ui";

type Row = { address: Address; name: string; symbol: string; supply: bigint; price: bigint };

/** Explore board — reads every bonding-curve collection straight from the
 *  factory on-chain (no indexer needed). */
export function ExploreClient() {
  const ready = isConfigured(BCNFT_FACTORY_ADDRESS);

  const { data: countData } = useReadContract({
    address: BCNFT_FACTORY_ADDRESS,
    abi: bcnftFactoryAbi,
    functionName: "collectionsCount",
    query: { enabled: ready, refetchInterval: 15_000 },
  });
  const count = Number((countData as bigint | undefined) ?? 0n);

  const { data: addrData } = useReadContracts({
    contracts: Array.from({ length: count }).map((_, i) => ({
      address: BCNFT_FACTORY_ADDRESS,
      abi: bcnftFactoryAbi,
      functionName: "allCollections",
      args: [BigInt(i)],
    })),
    query: { enabled: ready && count > 0 },
  });

  const addresses = useMemo(
    () =>
      ((addrData ?? [])
        .map((d) => d.result as unknown as Address)
        .filter(Boolean) as Address[]).reverse(),
    [addrData],
  );

  const { data: statData } = useReadContracts({
    contracts: addresses.flatMap((a) => [
      { address: a, abi: bondingCurveNftAbi, functionName: "name" },
      { address: a, abi: bondingCurveNftAbi, functionName: "symbol" },
      { address: a, abi: bondingCurveNftAbi, functionName: "totalSupply" },
      { address: a, abi: bondingCurveNftAbi, functionName: "buyQuote", args: [1n] },
    ]),
    query: { enabled: addresses.length > 0, refetchInterval: 12_000 },
  });

  const rows: Row[] = useMemo(() => {
    if (!statData) return [];
    return addresses.map((a, i) => {
      const b = i * 4;
      return {
        address: a,
        name: (statData[b]?.result as string) || shortAddress(a),
        symbol: (statData[b + 1]?.result as string) || "NFT",
        supply: (statData[b + 2]?.result as bigint) ?? 0n,
        price: (statData[b + 3]?.result as bigint) ?? 0n,
      };
    });
  }, [addresses, statData]);

  return (
    <div>
      <section className="flex flex-col gap-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:py-14">
        <div className="max-w-xl">
          <h1 className="text-2xl font-semibold leading-tight text-[var(--ink)] sm:text-[30px]">
            Launch and trade NFTs on a bonding curve.
          </h1>
          <p className="mt-2 text-[var(--muted)] sm:text-lg">
            Buy mints at a rising price, sell burns for the current price — early
            buyers profit as demand climbs.
          </p>
        </div>
        <Link href="/launch" className="btn btn-primary self-start text-base sm:self-auto" style={{ padding: "0.75rem 1.5rem" }}>
          Launch an NFT
        </Link>
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold text-[var(--ink)]">All collections</h2>
        {count === 0 || rows.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {rows.map((r) => (
              <Card key={r.address} r={r} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function EmptyState() {
  return (
    <section className="certificate flex flex-col items-center gap-3 px-6 py-20 text-center">
      <ArtMark seed="signapad" label="S" className="h-14 w-14 rounded-full" />
      <h2 className="text-lg font-semibold text-[var(--ink)]">No collections launched yet</h2>
      <p className="max-w-sm text-sm text-[var(--muted)]">
        Be the first — launch a bonding-curve NFT and it shows up here instantly.
      </p>
      <Link href="/launch" className="btn btn-primary">Launch an NFT</Link>
    </section>
  );
}

function Card({ r }: { r: Row }) {
  return (
    <Link href={`/c/${r.address}`} className="certificate card-hover overflow-hidden">
      <div className="relative aspect-square">
        <ArtMark seed={r.address} label={r.symbol} className="h-full w-full" />
        <div
          className="absolute inset-x-0 bottom-0 p-2.5"
          style={{ background: "linear-gradient(to top, rgba(0,0,0,0.88), transparent)" }}
        >
          <div className="truncate text-sm font-semibold text-white">{r.name}</div>
          <div className="mt-0.5 flex items-center justify-between text-xs text-white/80">
            <span className="tnum">{r.supply.toString()} minted</span>
            <span className="tnum">{fmt(r.price)} Ξ</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function fmt(wei: bigint): string {
  return Number(formatEther(wei)).toLocaleString("en-US", { maximumFractionDigits: 5 });
}
