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
import { AddressTag, EmptyState, SectionHeader } from "@/components/ui";

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
      { ...base, functionName: "basePrice" },
      { ...base, functionName: "slope" },
    ],
    query: { enabled: !!coll, refetchInterval: 8000 },
  });

  const name = (data?.[0]?.result as string) || (coll ? shortAddress(coll) : "");
  const symbol = (data?.[1]?.result as string) || "NFT";
  const supply = (data?.[2]?.result as bigint | undefined) ?? 0n;
  const maxSupply = (data?.[3]?.result as bigint | undefined) ?? 0n;
  const reserve = (data?.[4]?.result as bigint | undefined) ?? 0n;
  const price = (data?.[5]?.result as bigint | undefined) ?? 0n; // current buy price incl fee
  const basePrice = (data?.[6]?.result as bigint | undefined) ?? 0n;
  const slope = (data?.[7]?.result as bigint | undefined) ?? 0n;

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
          <PriceChart basePrice={basePrice} slope={slope} supply={supply} maxSupply={maxSupply} />
          <div className="panel grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
            <Stat label="Price" value={`${trim(price)} Ξ`} />
            <Stat label="Minted" value={supply.toString()} />
            <Stat label="Max" value={maxSupply === 0n ? "∞" : maxSupply.toString()} />
            <Stat label="Reserve" value={`${trim(reserve)} Ξ`} />
          </div>

          <Position collection={coll} account={account} client={client} />

          <p className="text-sm text-[var(--muted)]">
            Every buy mints at the current price and pushes it up; every sell burns a
            token back at the current price. Early buyers profit as the price climbs.
            1% fee on each trade.
          </p>

          <TradeHistory collection={coll} client={client} />
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

/** "Your position" P&L box: holdings, net invested, sell-value now, and P&L. */
function Position({
  collection,
  account,
  client,
}: {
  collection: Address;
  account?: Address;
  client: ReturnType<typeof usePublicClient>;
}) {
  const [paid, setPaid] = useState(0n);
  const [received, setReceived] = useState(0n);

  const { data: balData } = useReadContract({
    address: collection,
    abi: bondingCurveNftAbi,
    functionName: "balanceOf",
    args: account ? [account] : undefined,
    query: { enabled: !!account, refetchInterval: 8000 },
  });
  const holdings = (balData as bigint | undefined) ?? 0n;

  const { data: sellVal } = useReadContract({
    address: collection,
    abi: bondingCurveNftAbi,
    functionName: "sellQuote",
    args: [holdings],
    query: { enabled: holdings > 0n, refetchInterval: 8000 },
  });
  const currentValue = (sellVal as bigint | undefined) ?? 0n;

  useEffect(() => {
    let cancelled = false;
    const boughtEv = bondingCurveNftAbi.find((x) => x.type === "event" && x.name === "Bought");
    const soldEv = bondingCurveNftAbi.find((x) => x.type === "event" && x.name === "Sold");
    async function load() {
      if (!client || !account) return;
      try {
        const latest = await client.getBlockNumber();
        const from = latest > 1_000_000n ? latest - 1_000_000n : 0n;
        const [bought, sold] = await Promise.all([
          client.getLogs({ address: collection, event: boughtEv as never, args: { buyer: account } as never, fromBlock: from, toBlock: "latest" }),
          client.getLogs({ address: collection, event: soldEv as never, args: { seller: account } as never, fromBlock: from, toBlock: "latest" }),
        ]);
        let p = 0n;
        let r = 0n;
        for (const l of bought as unknown as Array<{ args: { cost: bigint; fee: bigint } }>) p += l.args.cost + l.args.fee;
        for (const l of sold as unknown as Array<{ args: { proceeds: bigint; fee: bigint } }>) r += l.args.proceeds - l.args.fee;
        if (!cancelled) {
          setPaid(p);
          setReceived(r);
        }
      } catch {
        /* ignore */
      }
    }
    void load();
    const t = setInterval(() => void load(), 10_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [client, account, collection]);

  if (!account || (holdings === 0n && paid === 0n)) return null;

  // P&L if you sold everything now: what you'd get + what you already took out − what you put in.
  const pnl = currentValue + received - paid;
  const up = pnl >= 0n;
  const pct = paid > 0n ? (Number(pnl) / Number(paid)) * 100 : 0;
  const netInvested = paid > received ? paid - received : 0n;

  return (
    <div className="certificate p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="label">Your position</span>
        <span className={`tnum text-sm font-semibold ${up ? "up" : "down"}`}>
          {up ? "+" : "−"}
          {trim(pnl < 0n ? -pnl : pnl)} Ξ {paid > 0n ? `(${up ? "+" : ""}${pct.toFixed(1)}%)` : ""}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-3 border-t border-[var(--rule)] pt-3 text-sm">
        <Stat label="Your NFTs" value={holdings.toString()} />
        <Stat label="Invested" value={`${trim(netInvested)} Ξ`} />
        <Stat label="Sell value" value={`${trim(currentValue)} Ξ`} />
      </div>
      <p className="mt-2 text-xs text-[var(--muted)]">
        P&amp;L if you sold your {holdings.toString()} NFT{holdings === 1n ? "" : "s"} now
        (includes anything you&apos;ve already sold).
      </p>
    </div>
  );
}

type Trade = { kind: "buy" | "sell"; trader: Address; qty: bigint; eth: bigint; block: bigint; idx: number; ts: number };

/** Live feed of recent buys and sells, polled from the collection's events. */
function TradeHistory({
  collection,
  client,
}: {
  collection: Address;
  client: ReturnType<typeof usePublicClient>;
}) {
  const [rows, setRows] = useState<Trade[]>([]);

  useEffect(() => {
    let cancelled = false;
    const boughtEv = bondingCurveNftAbi.find((x) => x.type === "event" && x.name === "Bought");
    const soldEv = bondingCurveNftAbi.find((x) => x.type === "event" && x.name === "Sold");

    async function load() {
      if (!client) return;
      try {
        const latest = await client.getBlockNumber();
        const from = latest > 1_000_000n ? latest - 1_000_000n : 0n;
        const [bought, sold] = await Promise.all([
          client.getLogs({ address: collection, event: boughtEv as never, fromBlock: from, toBlock: "latest" }),
          client.getLogs({ address: collection, event: soldEv as never, fromBlock: from, toBlock: "latest" }),
        ]);

        const items: Trade[] = [
          ...(bought as unknown as Array<{ args: { buyer: Address; quantity: bigint; cost: bigint; fee: bigint }; blockNumber: bigint; logIndex: number }>).map((l) => ({
            kind: "buy" as const,
            trader: l.args.buyer,
            qty: l.args.quantity,
            eth: l.args.cost + l.args.fee,
            block: l.blockNumber,
            idx: l.logIndex,
            ts: 0,
          })),
          ...(sold as unknown as Array<{ args: { seller: Address; quantity: bigint; proceeds: bigint; fee: bigint }; blockNumber: bigint; logIndex: number }>).map((l) => ({
            kind: "sell" as const,
            trader: l.args.seller,
            qty: l.args.quantity,
            eth: l.args.proceeds - l.args.fee,
            block: l.blockNumber,
            idx: l.logIndex,
            ts: 0,
          })),
        ]
          .sort((a, b) => (a.block === b.block ? b.idx - a.idx : a.block < b.block ? 1 : -1))
          .slice(0, 15);

        const blocks = [...new Set(items.map((i) => i.block))];
        const times = new Map<bigint, number>();
        await Promise.all(
          blocks.map(async (bn) => {
            try {
              const blk = await client.getBlock({ blockNumber: bn });
              times.set(bn, Number(blk.timestamp));
            } catch {
              /* ignore */
            }
          }),
        );
        const withTime = items.map((i) => ({ ...i, ts: times.get(i.block) ?? 0 }));
        if (!cancelled) setRows(withTime);
      } catch {
        /* ignore */
      }
    }

    void load();
    const t = setInterval(() => void load(), 8000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [client, collection]);

  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-[var(--rule)] p-3">
        <span className="label">Trade history · live</span>
      </div>
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-[var(--muted)]">No trades yet — be the first to buy.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="ledger text-sm">
            <thead>
              <tr>
                <th className="label">Type</th>
                <th className="label">Trader</th>
                <th className="label">Qty</th>
                <th className="label">ETH</th>
                <th className="label">Time</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.block}-${r.idx}`}>
                  <td>
                    <span className={r.kind === "buy" ? "up" : "down"} style={{ fontWeight: 600 }}>
                      {r.kind === "buy" ? "Buy" : "Sell"}
                    </span>
                  </td>
                  <td>
                    <AddressTag address={r.trader} short={shortAddress(r.trader)} href={`/portfolio/${r.trader}`} />
                  </td>
                  <td className="tnum">{r.qty.toString()}</td>
                  <td className="tnum">{trim(r.eth)}</td>
                  <td className="tnum text-[var(--muted)]">{r.ts ? ago(r.ts) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ago(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** SVG of the linear bonding curve (price vs supply) with the current point marked. */
function PriceChart({
  basePrice,
  slope,
  supply,
  maxSupply,
}: {
  basePrice: bigint;
  slope: bigint;
  supply: bigint;
  maxSupply: bigint;
}) {
  const bp = Number(formatEther(basePrice));
  const sl = Number(formatEther(slope));
  const cur = Number(supply);
  const sMax = maxSupply > 0n ? Number(maxSupply) : Math.max(cur + 20, 20);
  const W = 600;
  const H = 200;
  const priceAt = (s: number) => bp + sl * s;
  const yMax = priceAt(sMax) || 1;
  const x = (s: number) => (s / sMax) * W;
  const y = (s: number) => H - (priceAt(s) / yMax) * (H - 12) - 6;

  const N = 60;
  const line: string[] = [];
  for (let i = 0; i <= N; i++) {
    const s = (i / N) * sMax;
    line.push(`${x(s).toFixed(1)},${y(s).toFixed(1)}`);
  }
  // Filled area up to the current supply.
  const fill: string[] = [`0,${H}`];
  const M = Math.max(1, Math.round((cur / sMax) * N));
  for (let i = 0; i <= M; i++) {
    const s = (i / N) * sMax;
    fill.push(`${x(s).toFixed(1)},${y(s).toFixed(1)}`);
  }
  fill.push(`${x(cur).toFixed(1)},${H}`);

  return (
    <div className="panel p-4">
      <div className="label mb-2">Bonding curve · price vs supply</div>
      <svg viewBox="0 0 600 200" className="h-48 w-full" preserveAspectRatio="none">
        <polygon points={fill.join(" ")} fill="var(--glow)" stroke="none" />
        <polyline points={line.join(" ")} fill="none" stroke="var(--vermilion)" strokeWidth="2" />
        <line x1={x(cur)} y1="0" x2={x(cur)} y2={H} stroke="var(--rule)" strokeDasharray="4" />
        <circle cx={x(cur)} cy={y(cur)} r="4.5" fill="var(--vermilion)" />
      </svg>
      <div className="mt-1 flex justify-between text-xs text-[var(--muted)]">
        <span className="tnum">{trim(basePrice)} Ξ</span>
        <span className="tnum">
          supply {cur}
          {maxSupply > 0n ? ` / ${sMax}` : ""}
        </span>
        <span className="tnum">{yMax.toLocaleString("en-US", { maximumFractionDigits: 5 })} Ξ</span>
      </div>
    </div>
  );
}
