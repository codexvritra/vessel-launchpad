"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatEther, type Address } from "viem";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useReadContracts,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { bondingCurveNftAbi } from "@/lib/abi";
import { normalizeAddress, shortAddress } from "@/lib/format";
import { AddressTag, ArtMark, EmptyState, SectionHeader } from "@/components/ui";

/** Trade a bonding-curve NFT collection: buy mints at the rising price, sell burns
 *  owned tokens for the current price. */
export function BuySellClient({ address }: { address: string }) {
  const coll = normalizeAddress(address);
  const { address: account, isConnected } = useAccount();
  const client = usePublicClient();

  const base = { address: coll ?? undefined, abi: bondingCurveNftAbi } as const;
  const { data, refetch } = useReadContracts({
    contracts: [
      { ...base, functionName: "name" },
      { ...base, functionName: "symbol" },
      { ...base, functionName: "totalSupply" },
      { ...base, functionName: "maxSupply" },
      { ...base, functionName: "reserve" },
      { ...base, functionName: "buyQuote", args: [1n] },
    ],
    query: { enabled: !!coll, refetchInterval: 8000 },
  });

  const name = (data?.[0]?.result as string) || (coll ? shortAddress(coll) : "");
  const symbol = (data?.[1]?.result as string) || "NFT";
  const supply = (data?.[2]?.result as bigint | undefined) ?? 0n;
  const maxSupply = (data?.[3]?.result as bigint | undefined) ?? 0n;
  const reserve = (data?.[4]?.result as bigint | undefined) ?? 0n;
  const price = (data?.[5]?.result as bigint | undefined) ?? 0n; // current buy price incl fee

  if (!coll) {
    return (
      <EmptyState
        title="Invalid collection address"
        action={<Link href="/" className="btn">Back</Link>}
      />
    );
  }

  return (
    <div>
      <SectionHeader
        kicker="Bonding-curve NFT"
        title={name}
        right={<span className="chip chip-accent">{symbol}</span>}
      />
      <div className="mb-6 flex flex-wrap items-center gap-3 text-sm">
        <AddressTag address={coll} short={shortAddress(coll)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <div className="certificate overflow-hidden">
            <ArtMark seed={coll} label={symbol} className="aspect-[3/1] w-full" />
          </div>
          <div className="panel grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
            <Stat label="Price" value={`${trim(price)} Ξ`} />
            <Stat label="Minted" value={supply.toString()} />
            <Stat label="Max" value={maxSupply === 0n ? "∞" : maxSupply.toString()} />
            <Stat label="Reserve" value={`${trim(reserve)} Ξ`} />
          </div>
          <p className="text-sm text-[var(--muted)]">
            Every buy mints at the current price and pushes it up; every sell burns a
            token back at the current price. Early buyers profit as the price climbs.
            1% fee on each trade.
          </p>
        </div>

        <TradePanel
          collection={coll}
          account={account}
          isConnected={isConnected}
          symbol={symbol}
          client={client}
          onDone={() => void refetch()}
        />
      </div>
    </div>
  );
}

function TradePanel({
  collection,
  account,
  isConnected,
  symbol,
  client,
  onDone,
}: {
  collection: Address;
  account?: Address;
  isConnected: boolean;
  symbol: string;
  client: ReturnType<typeof usePublicClient>;
  onDone: () => void;
}) {
  const [tab, setTab] = useState<"buy" | "sell">("buy");
  const [qty, setQty] = useState(1);

  const base = { address: collection, abi: bondingCurveNftAbi } as const;
  const { data: buyTotal } = useReadContract({
    ...base,
    functionName: "buyQuote",
    args: [BigInt(Math.max(1, qty))],
    query: { enabled: tab === "buy" },
  });
  const { data: sellNet } = useReadContract({
    ...base,
    functionName: "sellQuote",
    args: [BigInt(Math.max(1, qty))],
    query: { enabled: tab === "sell" },
  });

  const [owned, setOwned] = useState<bigint[]>([]);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!client || !account) return setOwned([]);
      try {
        const latest = await client.getBlockNumber();
        const from = latest > 1_000_000n ? latest - 1_000_000n : 0n;
        const logs = await client.getLogs({
          address: collection,
          event: bondingCurveNftAbi.find((x) => x.type === "event" && x.name === "Transfer") as never,
          fromBlock: from,
          toBlock: "latest",
        });
        // Replay transfers to find tokens currently owned by `account`.
        const ownerOf = new Map<string, string>();
        for (const l of logs as unknown as Array<{ args: { from: string; to: string; tokenId: bigint } }>) {
          ownerOf.set(l.args.tokenId.toString(), l.args.to.toLowerCase());
        }
        const mine: bigint[] = [];
        for (const [id, owner] of ownerOf) {
          if (owner === account.toLowerCase()) mine.push(BigInt(id));
        }
        mine.sort((a, b) => (a < b ? -1 : 1));
        if (!cancelled) setOwned(mine);
      } catch {
        if (!cancelled) setOwned([]);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [client, account, collection]);

  const { writeContract, data: hash, isPending, reset, error } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });
  useEffect(() => {
    if (isSuccess) {
      onDone();
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess]);

  const busy = isPending || confirming;
  const maxSell = owned.length;

  function buy() {
    writeContract({ ...base, functionName: "buy", args: [BigInt(qty)], value: (buyTotal as bigint) ?? 0n });
  }
  function sell() {
    const ids = owned.slice(0, Math.min(qty, owned.length));
    if (ids.length === 0) return;
    writeContract({ ...base, functionName: "sell", args: [ids] });
  }

  return (
    <aside className="lg:sticky lg:top-24 lg:self-start">
      <div className="certificate p-4">
        <div className="mb-3 flex gap-1 rounded-full bg-[var(--surface-2)] p-1">
          <TabBtn active={tab === "buy"} onClick={() => setTab("buy")} label="Buy" />
          <TabBtn active={tab === "sell"} onClick={() => setTab("sell")} label="Sell" />
        </div>

        <div className="label mb-1">Quantity{tab === "sell" ? ` (you own ${maxSell})` : ""}</div>
        <div className="flex items-center gap-2">
          <button className="btn" style={{ padding: "0.4rem 0.8rem" }} onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
          <input
            className="field field-mono text-center"
            style={{ width: "4rem" }}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Number(e.target.value.replace(/[^0-9]/g, "")) || 1))}
          />
          <button className="btn" style={{ padding: "0.4rem 0.8rem" }} onClick={() => setQty((q) => q + 1)}>+</button>
        </div>

        <div className="mt-4 border-t border-[var(--rule)] pt-3 text-sm">
          {tab === "buy" ? (
            <Row k="You pay" v={`${trim((buyTotal as bigint) ?? 0n)} Ξ`} strong />
          ) : (
            <Row k="You receive" v={`${trim((sellNet as bigint) ?? 0n)} Ξ`} strong />
          )}
        </div>

        <div className="mt-4">
          {!isConnected ? (
            <ConnectButton />
          ) : tab === "buy" ? (
            <button className="btn btn-primary w-full" disabled={busy} onClick={buy}>
              {busy ? "Buying…" : `Buy ${qty} ${symbol}`}
            </button>
          ) : (
            <button className="btn btn-primary w-full" disabled={busy || maxSell === 0 || qty > maxSell} onClick={sell}>
              {busy ? "Selling…" : maxSell === 0 ? "Nothing to sell" : `Sell ${qty}`}
            </button>
          )}
        </div>
        {error ? <p className="mt-2 text-xs text-[var(--vermilion)]">{error.message.split("\n")[0]}</p> : null}
        <p className="mt-3 text-xs text-[var(--muted)]">1% fee on every buy and sell.</p>
      </div>
    </aside>
  );
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="flex-1 rounded-full py-1.5 text-sm font-semibold transition-colors"
      style={{ background: active ? "var(--surface)" : "transparent", color: active ? "var(--ink)" : "var(--muted)" }}
    >
      {label}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="tnum mt-1 text-lg font-semibold text-[var(--ink)]">{value}</div>
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="label">{k}</span>
      <span className="tnum" style={{ fontWeight: strong ? 700 : 500 }}>{v}</span>
    </div>
  );
}

function trim(wei: bigint): string {
  const n = Number(formatEther(wei));
  return n.toLocaleString("en-US", { maximumFractionDigits: 5 });
}
