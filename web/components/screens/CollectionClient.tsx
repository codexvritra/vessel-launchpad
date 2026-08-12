"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatEther, type Address } from "viem";
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { launchpadErc721aAbi, collectionFactoryAbi } from "@/lib/abi";
import type { CollectionMetrics } from "@/lib/api";
import { FACTORY_ADDRESS, isConfigured } from "@/lib/config";
import { useAllowlistProof, useCollection } from "@/lib/hooks";
import { useWatchCollectionMints } from "@/lib/realtime";
import { CoinMarketPanel } from "@/components/CoinMarketPanel";

const ZERO_ROOT = `0x${"0".repeat(64)}`;
import {
  bpsToPct,
  countdown,
  formatEth,
  formatInt,
  normalizeAddress,
  shortAddress,
} from "@/lib/format";
import {
  AddressTag,
  ArtMark,
  EmptyState,
  SectionHeader,
  Skeleton,
  Stat,
} from "@/components/ui";

type Phase = {
  merkleRoot: `0x${string}`;
  price: bigint;
  endPrice: bigint; // 0 => fixed price; else Dutch-auction floor
  startTime: bigint;
  endTime: bigint;
  perWalletCap: number;
  maxMintable: number;
};

export function CollectionClient({ address }: { address: string }) {
  const collection = normalizeAddress(address);
  const { data: api, isLoading } = useCollection(collection);

  if (!collection) {
    return (
      <EmptyState
        title="Invalid collection address"
        hint="This route expects a checksummed 0x address."
        action={
          <Link href="/" className="btn">
            Back to register
          </Link>
        }
      />
    );
  }

  const metrics = api?.metrics ?? null;
  const tokens = api?.tokens ?? [];
  const name = metrics?.name || shortAddress(collection);

  return (
    <div>
      <SectionHeader
        kicker="Collection"
        title={name}
        right={<VerifyBadge collection={collection} />}
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <AddressTag address={collection} short={collection} />
        {metrics?.symbol ? (
          <span className="chip">{metrics.symbol}</span>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <MetricsRow metrics={metrics} isLoading={isLoading} />
          <CoinMarketPanel
            collection={collection}
            coinFromApi={metrics?.coin_address}
            pairFromApi={metrics?.pair_address}
          />
          <HolderList
            tokens={tokens}
            collection={collection}
            isLoading={isLoading}
          />
        </div>
        <MintWidget collection={collection} apiMinted={metrics?.total_minted} />
      </div>
    </div>
  );
}

function MetricsRow({
  metrics,
  isLoading,
}: {
  metrics: CollectionMetrics | null;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="panel grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  }
  return (
    <div className="panel grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
      <Stat
        label="Minted"
        value={formatInt(metrics?.total_minted ?? 0)}
      />
      <Stat
        label="Holders"
        value={formatInt(metrics?.holder_count ?? 0)}
      />
      <Stat
        label="Volume"
        value={formatEth(metrics?.decayed_volume_eth ?? 0)}
        unit="Ξ"
        tone="positive"
      />
      <Stat
        label="Wash-trust"
        value={`${Math.round((1 - (Number(metrics?.wash_penalty) || 0)) * 100)}`}
      />
    </div>
  );
}

function VerifyBadge({ collection }: { collection: Address }) {
  const factoryReady = isConfigured(FACTORY_ADDRESS);
  const { data, isLoading, isError } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: collectionFactoryAbi,
    functionName: "isCollection",
    args: [collection],
    query: { enabled: factoryReady },
  });

  if (!factoryReady) {
    return <span className="chip">Unverified · no factory</span>;
  }
  if (isLoading) return <span className="chip">Checking…</span>;
  if (isError) return <span className="chip">Verify unavailable</span>;
  return data ? (
    <span className="chip chip-positive">✓ Factory-verified</span>
  ) : (
    <span className="chip chip-accent">Not from factory</span>
  );
}

// ---- Mint widget ------------------------------------------------------------

function MintWidget({
  collection,
  apiMinted,
}: {
  collection: Address;
  apiMinted?: number;
}) {
  const { address: account, isConnected } = useAccount();
  const [qty, setQty] = useState(1);

  // Live supply: subscribe to on-chain mints (WebSocket push when configured).
  const liveMints = useWatchCollectionMints(collection);

  const baseContract = { address: collection, abi: launchpadErc721aAbi } as const;

  const {
    data: head,
    isError: headError,
    refetch: refetchHead,
  } = useReadContracts({
    contracts: [
      { ...baseContract, functionName: "totalMinted" },
      { ...baseContract, functionName: "maxSupply" },
      { ...baseContract, functionName: "phaseCount" },
      { ...baseContract, functionName: "mintPrice" },
      { ...baseContract, functionName: "tbaFundingBps" },
    ],
    query: { refetchInterval: 15_000 },
  });

  const totalMinted = head?.[0]?.result as bigint | undefined;
  const maxSupply = head?.[1]?.result as bigint | undefined;
  const phaseCount = Number((head?.[2]?.result as bigint | undefined) ?? 0n);
  const mintPrice = head?.[3]?.result as bigint | undefined;
  const tbaBps = Number((head?.[4]?.result as number | undefined) ?? 0);

  const { data: phaseData } = useReadContracts({
    contracts: Array.from({ length: phaseCount }).map((_, i) => ({
      ...baseContract,
      functionName: "phase" as const,
      args: [BigInt(i)] as const,
    })),
    query: { enabled: phaseCount > 0, refetchInterval: 15_000 },
  });

  const phases: Phase[] = useMemo(() => {
    if (!phaseData) return [];
    return phaseData
      .map((p) => p.result as Phase | undefined)
      .filter((p): p is Phase => !!p);
  }, [phaseData]);

  const { activeId, activePhase, status } = useMemo(
    () => pickActivePhase(phases),
    [phases],
  );

  const isAuction = !!activePhase && activePhase.endPrice > 0n;

  // For a Dutch auction, poll the on-chain current price so it ticks down live.
  const { data: livePrice } = useReadContract({
    ...baseContract,
    functionName: "currentPrice",
    args: activeId !== null ? [BigInt(activeId)] : undefined,
    query: { enabled: isAuction && activeId !== null, refetchInterval: 4_000 },
  });

  const unitPrice = isAuction
    ? ((livePrice as bigint | undefined) ?? activePhase?.price ?? 0n)
    : (activePhase?.price ?? mintPrice ?? 0n);
  const soldOut =
    totalMinted !== undefined &&
    maxSupply !== undefined &&
    maxSupply > 0n &&
    totalMinted >= maxSupply;

  // Allowlist phases carry a non-zero Merkle root; source the connected
  // address's proof from the services layer.
  const isAllowlist =
    !!activePhase && activePhase.merkleRoot.toLowerCase() !== ZERO_ROOT;
  const { data: proofData, isLoading: proofLoading } = useAllowlistProof(
    collection,
    activeId,
    account,
    isAllowlist && isConnected,
  );
  const proof: `0x${string}`[] = isAllowlist ? (proofData?.proof ?? []) : [];
  const notListed = isAllowlist && isConnected && !!proofData && !proofData.listed;

  const value = unitPrice * BigInt(Math.max(1, qty));
  const perTokenFunding =
    tbaBps > 0 ? (unitPrice * BigInt(tbaBps)) / 10000n : 0n;

  const {
    writeContract,
    data: txHash,
    isPending,
    error: writeError,
    reset,
  } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
    query: { enabled: !!txHash },
  });

  // Refresh chain reads as soon as a mint lands on-chain (live).
  useEffect(() => {
    if (liveMints > 0) void refetchHead();
  }, [liveMints, refetchHead]);

  function mint() {
    if (activeId === null || notListed) return;
    writeContract(
      {
        ...baseContract,
        functionName: "mint",
        args: [BigInt(activeId), BigInt(qty), proof],
        value,
      },
      { onSuccess: () => void refetchHead() },
    );
  }

  const chainDown = headError && totalMinted === undefined;

  return (
    <aside className="lg:sticky lg:top-24 lg:self-start">
      <div className="certificate p-5">
        <div className="label mb-2">Mint</div>

        <SupplyMeter
          minted={totalMinted ?? (apiMinted != null ? BigInt(apiMinted) : undefined)}
          max={maxSupply}
          live={liveMints}
        />

        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--rule)] pt-3">
          <div>
            <div className="label">Active phase</div>
            <div className="tnum text-sm font-semibold">
              {activeId !== null ? `Phase ${activeId}` : "—"}{" "}
              <PhaseTag status={status} />
            </div>
          </div>
          <div>
            <div className="label">Price</div>
            <div className="tnum text-sm font-semibold">
              {formatEther(unitPrice)} Ξ
            </div>
          </div>
        </div>

        {activePhase && status === "upcoming" ? (
          <p className="mt-2 text-xs text-[var(--muted)]">
            Opens in{" "}
            <span className="tnum">{countdown(activePhase.startTime)}</span>
          </p>
        ) : null}
        {activePhase && status === "live" && activePhase.endTime > 0n ? (
          <p className="mt-2 text-xs text-[var(--muted)]">
            Closes in{" "}
            <span className="tnum">{countdown(activePhase.endTime)}</span>
          </p>
        ) : null}
        {isAuction && activePhase ? (
          <p className="mt-2 text-xs">
            <span className="chip chip-accent">Dutch auction</span>{" "}
            <span className="text-[var(--muted)]">
              <span className="tnum">{formatEther(activePhase.price)}</span> Ξ →{" "}
              <span className="tnum">{formatEther(activePhase.endPrice)}</span> Ξ · price
              falls live
            </span>
          </p>
        ) : null}

        <div className="mt-4">
          <div className="label mb-1">Quantity</div>
          <div className="flex items-center gap-2">
            <button
              className="btn"
              style={{ padding: "0.4rem 0.8rem" }}
              onClick={() => setQty((q) => Math.max(1, q - 1))}
            >
              −
            </button>
            <input
              className="field field-mono text-center"
              style={{ width: "4rem" }}
              value={qty}
              onChange={(e) => {
                const n = Number(e.target.value.replace(/[^0-9]/g, ""));
                setQty(Math.max(1, Math.min(50, n || 1)));
              }}
            />
            <button
              className="btn"
              style={{ padding: "0.4rem 0.8rem" }}
              onClick={() => setQty((q) => Math.min(50, q + 1))}
            >
              +
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-1 border-t border-[var(--rule)] pt-3 text-sm">
          <Line k="Total" v={`${formatEther(value)} Ξ`} strong />
          {perTokenFunding > 0n ? (
            <Line
              k="Funded into each vessel"
              v={`${formatEther(perTokenFunding)} Ξ`}
              accent
            />
          ) : null}
        </div>

        <div className="mt-4">
          {!isConnected ? (
            <ConnectButton />
          ) : soldOut ? (
            <button className="btn w-full" disabled>
              Sold out
            </button>
          ) : notListed ? (
            <button className="btn w-full" disabled>
              Not on allowlist
            </button>
          ) : isSuccess ? (
            <button
              className="btn w-full"
              onClick={() => {
                reset();
                void refetchHead();
              }}
            >
              Minted ✓ — mint more
            </button>
          ) : (
            <button
              className="btn btn-primary w-full"
              disabled={
                isPending ||
                isConfirming ||
                activeId === null ||
                chainDown ||
                (isAllowlist && proofLoading)
              }
              onClick={mint}
            >
              {isPending
                ? "Confirm in wallet…"
                : isConfirming
                  ? "Minting…"
                  : activeId === null
                    ? "No active phase"
                    : isAllowlist && proofLoading
                      ? "Checking allowlist…"
                      : `Mint ${qty}`}
            </button>
          )}
        </div>

        {isAllowlist ? (
          <p className="mt-2 text-xs text-[var(--muted)]">
            Allowlist phase ·{" "}
            {!isConnected ? (
              "connect to check eligibility"
            ) : proofLoading ? (
              "checking…"
            ) : proofData?.listed ? (
              <span className="text-[var(--teal)]">you&apos;re on the list ✓</span>
            ) : (
              <span className="text-[var(--vermilion)]">this address is not listed</span>
            )}
          </p>
        ) : null}

        {writeError ? (
          <p className="mt-2 text-xs text-[var(--vermilion)]">
            {shortError(writeError.message)}
          </p>
        ) : null}
        {chainDown ? (
          <p className="mt-2 text-xs text-[var(--muted)]">
            Chain read unavailable — showing indexed figures where possible.
          </p>
        ) : null}
        {tbaBps > 0 ? (
          <p className="mt-3 text-xs text-[var(--muted)]">
            Funding rate <span className="tnum">{bpsToPct(tbaBps)}</span> of mint
            price goes into each token&apos;s wallet.
          </p>
        ) : null}
      </div>
    </aside>
  );
}

function SupplyMeter({
  minted,
  max,
  live = 0,
}: {
  minted?: bigint;
  max?: bigint;
  live?: number;
}) {
  const m = minted ?? 0n;
  const cap = max ?? 0n;
  const pct = cap > 0n ? Number((m * 1000n) / cap) / 10 : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="tnum text-2xl font-bold">
          {formatInt(Number(m))}
          {live > 0 ? (
            <span className="ml-2 align-middle text-xs font-normal text-[var(--teal)]">
              +{live} live ●
            </span>
          ) : null}
        </span>
        <span className="tnum text-sm text-[var(--muted)]">
          / {cap > 0n ? formatInt(Number(cap)) : "—"}
        </span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-[2px] border border-[var(--rule)]">
        <div
          className="h-full"
          style={{
            width: `${Math.min(100, pct)}%`,
            background: "var(--vermilion)",
          }}
        />
      </div>
      <div className="mt-1 label">
        {pct.toFixed(1)}% minted
      </div>
    </div>
  );
}

function PhaseTag({ status }: { status: PhaseStatus }) {
  if (status === "live")
    return <span className="chip chip-positive">Live</span>;
  if (status === "upcoming") return <span className="chip">Upcoming</span>;
  if (status === "ended") return <span className="chip">Ended</span>;
  return null;
}

function HolderList({
  tokens,
  collection,
  isLoading,
}: {
  tokens: Array<{
    id: string;
    tokenId: string | number | bigint;
    owner: string;
    tba: string | null;
  }>;
  collection: Address;
  isLoading: boolean;
}) {
  if (isLoading) {
    return <Skeleton className="h-48" />;
  }
  if (tokens.length === 0) {
    return (
      <EmptyState
        title="No tokens indexed yet"
        hint="Once the first token mints, holders and their vessels appear here."
      />
    );
  }
  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-[var(--ink)] p-3">
        <span className="label">Ledger of holders</span>
      </div>
      <div className="overflow-x-auto">
        <table className="ledger text-sm">
          <thead>
            <tr>
              <th className="label">Token</th>
              <th className="label">Owner</th>
              <th className="label">Vessel (TBA)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tokens.slice(0, 40).map((t) => (
              <tr key={t.id}>
                <td className="tnum">#{String(t.tokenId)}</td>
                <td>
                  <AddressTag
                    address={t.owner}
                    short={shortAddress(t.owner)}
                    href={`/portfolio/${t.owner}`}
                  />
                </td>
                <td className="tnum text-[var(--muted)]">
                  {t.tba ? shortAddress(t.tba) : "—"}
                </td>
                <td className="text-right">
                  <Link
                    href={`/token/${collection}/${String(t.tokenId)}`}
                    className="text-[var(--vermilion)]"
                  >
                    View →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Line({
  k,
  v,
  strong,
  accent,
}: {
  k: string;
  v: string;
  strong?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="label">{k}</span>
      <span
        className="tnum"
        style={{
          fontWeight: strong ? 700 : 500,
          color: accent ? "var(--vermilion)" : "var(--ink)",
        }}
      >
        {v}
      </span>
    </div>
  );
}

// ---- Phase logic ------------------------------------------------------------

type PhaseStatus = "live" | "upcoming" | "ended" | "none";

function pickActivePhase(phases: Phase[]): {
  activeId: number | null;
  activePhase: Phase | null;
  status: PhaseStatus;
} {
  if (phases.length === 0)
    return { activeId: null, activePhase: null, status: "none" };
  const now = BigInt(Math.floor(Date.now() / 1000));

  // Prefer a currently-live phase.
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i]!;
    const started = p.startTime === 0n || p.startTime <= now;
    const notEnded = p.endTime === 0n || p.endTime > now;
    if (started && notEnded) return { activeId: i, activePhase: p, status: "live" };
  }
  // Else the soonest upcoming.
  let upcomingId = -1;
  let soonest = BigInt(Number.MAX_SAFE_INTEGER);
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i]!;
    if (p.startTime > now && p.startTime < soonest) {
      soonest = p.startTime;
      upcomingId = i;
    }
  }
  if (upcomingId >= 0)
    return {
      activeId: upcomingId,
      activePhase: phases[upcomingId]!,
      status: "upcoming",
    };
  return { activeId: null, activePhase: phases[0] ?? null, status: "ended" };
}

function shortError(msg: string): string {
  const first = msg.split("\n")[0] ?? msg;
  return first.length > 140 ? `${first.slice(0, 140)}…` : first;
}
