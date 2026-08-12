"use client";

import { useMemo, useState } from "react";
import { formatEther, parseEther, type Address } from "viem";
import {
  useAccount,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { bondingCurveAbi, erc20Abi } from "@/lib/abi";
import type { TradeRow } from "@/lib/api";
import {
  BONDING_CURVE_ADDRESS,
  DEXSCREENER_URL,
  SUSHI_SWAP_URL,
  isConfigured,
} from "@/lib/config";
import { useLaunchToken } from "@/lib/hooks";
import { shortAddress } from "@/lib/format";
import { AddressTag, EmptyState, SectionHeader, Skeleton } from "@/components/ui";

/**
 * pools.trade-style token page: live price + chart, a buy/sell widget against the
 * bonding curve, and an order-history feed of every buy and sell.
 */
export function TokenTradeClient({ token }: { token: string }) {
  const addr = token.toLowerCase() as Address;
  const { data, isLoading } = useLaunchToken(addr);
  const curveReady = isConfigured(BONDING_CURVE_ADDRESS);

  const t = data?.token ?? null;
  const trades = data?.trades ?? [];
  const price = t ? Number(t.lastPriceX18) / 1e18 : 0;

  return (
    <div>
      <SectionHeader
        kicker={t?.graduated ? "Graduated" : "Bonding curve"}
        title={t?.name || shortAddress(addr)}
        right={
          t?.symbol ? <span className="chip chip-accent">{t.symbol}</span> : null
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <AddressTag address={addr} short={shortAddress(addr)} />
        <span className="tnum text-sm text-[var(--muted)]">
          {price > 0 ? `${price.toPrecision(4)} Ξ / token` : "—"}
        </span>
        {t?.graduated && t.pair ? (
          <>
            <a
              className="text-[var(--vermilion)]"
              href={`${SUSHI_SWAP_URL}?token1=${addr}`}
              target="_blank"
              rel="noreferrer"
            >
              Trade on SushiSwap →
            </a>
            <a
              className="text-[var(--vermilion)]"
              href={`${DEXSCREENER_URL}/${t.pair}`}
              target="_blank"
              rel="noreferrer"
            >
              DexScreener →
            </a>
          </>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <PriceChart series={data?.series ?? []} isLoading={isLoading} />
          <OrderHistory trades={trades} isLoading={isLoading} />
        </div>
        <TradePanel token={addr} graduated={!!t?.graduated} curveReady={curveReady} />
      </div>
    </div>
  );
}

// ---- Chart ----------------------------------------------------------------

function PriceChart({
  series,
  isLoading,
}: {
  series: { t: number; p: string }[];
  isLoading: boolean;
}) {
  const path = useMemo(() => {
    if (series.length < 2) return null;
    const ys = series.map((s) => Number(s.p));
    const min = Math.min(...ys);
    const max = Math.max(...ys);
    const span = max - min || 1;
    const W = 600;
    const H = 200;
    const pts = series.map((s, i) => {
      const x = (i / (series.length - 1)) * W;
      const y = H - ((Number(s.p) - min) / span) * (H - 12) - 6;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return { d: `M${pts.join(" L")}`, last: pts[pts.length - 1] };
  }, [series]);

  return (
    <div className="panel p-4">
      <div className="label mb-2">Price</div>
      {isLoading ? (
        <Skeleton className="h-52" />
      ) : !path ? (
        <div className="flex h-52 items-center justify-center text-sm text-[var(--muted)]">
          No trades yet — be the first to buy.
        </div>
      ) : (
        <svg viewBox="0 0 600 200" className="h-52 w-full" preserveAspectRatio="none">
          <path d={`${path.d} L600,200 L0,200 Z`} fill="var(--glow)" stroke="none" />
          <path d={path.d} fill="none" stroke="var(--vermilion)" strokeWidth="2" />
        </svg>
      )}
    </div>
  );
}

// ---- Buy / sell -----------------------------------------------------------

function TradePanel({
  token,
  graduated,
  curveReady,
}: {
  token: Address;
  graduated: boolean;
  curveReady: boolean;
}) {
  const { isConnected } = useAccount();
  const [tab, setTab] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: confirming } = useWaitForTransactionReceipt({ hash });

  if (!curveReady) {
    return (
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="panel p-4 text-xs text-[var(--muted)]">
          Bonding curve not configured on this deployment.
        </div>
      </aside>
    );
  }

  const busy = isPending || confirming;

  return (
    <aside className="lg:sticky lg:top-24 lg:self-start">
      <div className="certificate p-4">
        {graduated ? (
          <p className="text-sm text-[var(--muted)]">
            This token graduated — trade it on SushiSwap.
          </p>
        ) : (
          <>
            <div className="mb-3 flex gap-1 rounded-full bg-[var(--surface-2)] p-1">
              <TabBtn active={tab === "buy"} onClick={() => setTab("buy")} label="Buy" />
              <TabBtn active={tab === "sell"} onClick={() => setTab("sell")} label="Sell" />
            </div>

            <div className="label mb-1">{tab === "buy" ? "ETH to spend" : "Tokens to sell"}</div>
            <input
              className="field field-mono"
              inputMode="decimal"
              placeholder={tab === "buy" ? "0.1" : "1000"}
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            />

            <div className="mt-3">
              {!isConnected ? (
                <ConnectButton />
              ) : tab === "buy" ? (
                <button
                  className="btn btn-primary w-full"
                  disabled={busy || !amount}
                  onClick={() =>
                    writeContract({
                      address: BONDING_CURVE_ADDRESS,
                      abi: bondingCurveAbi,
                      functionName: "buy",
                      args: [token, 0n],
                      value: safeEther(amount),
                    })
                  }
                >
                  {busy ? "Buying…" : "Buy"}
                </button>
              ) : (
                <div className="flex gap-2">
                  <button
                    className="btn"
                    disabled={busy || !amount}
                    onClick={() =>
                      writeContract({
                        address: token,
                        abi: erc20Abi,
                        functionName: "approve",
                        args: [BONDING_CURVE_ADDRESS, safeEther(amount)],
                      })
                    }
                  >
                    Approve
                  </button>
                  <button
                    className="btn btn-primary flex-1"
                    disabled={busy || !amount}
                    onClick={() =>
                      writeContract({
                        address: BONDING_CURVE_ADDRESS,
                        abi: bondingCurveAbi,
                        functionName: "sell",
                        args: [token, safeEther(amount), 0n],
                      })
                    }
                  >
                    {busy ? "Selling…" : "Sell"}
                  </button>
                </div>
              )}
            </div>
            <p className="mt-3 text-xs text-[var(--muted)]">
              1% fee on every buy and sell. Anyone can trade this token from any
              wallet — you don&apos;t need this site.
            </p>
          </>
        )}
      </div>
    </aside>
  );
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="flex-1 rounded-full py-1.5 text-sm font-semibold transition-colors"
      style={{
        background: active ? "var(--surface)" : "transparent",
        color: active ? "var(--ink)" : "var(--muted)",
        boxShadow: active ? "0 1px 2px var(--shadow)" : "none",
      }}
    >
      {label}
    </button>
  );
}

// ---- Order history --------------------------------------------------------

function OrderHistory({ trades, isLoading }: { trades: TradeRow[]; isLoading: boolean }) {
  if (isLoading) return <Skeleton className="h-64" />;
  if (trades.length === 0) {
    return <EmptyState title="No trades yet" hint="Buys and sells will stream in here live." />;
  }
  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-[var(--rule)] p-3">
        <span className="label">Order history · live</span>
      </div>
      <div className="overflow-x-auto">
        <table className="ledger text-sm">
          <thead>
            <tr>
              <th className="label">Type</th>
              <th className="label">Trader</th>
              <th className="label">ETH</th>
              <th className="label">Tokens</th>
              <th className="label">Time</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((tr) => (
              <tr key={tr.id}>
                <td>
                  <span className={tr.isBuy ? "up" : "down"} style={{ fontWeight: 600 }}>
                    {tr.isBuy ? "Buy" : "Sell"}
                  </span>
                </td>
                <td>
                  <AddressTag address={tr.trader} short={shortAddress(tr.trader)} href={`/portfolio/${tr.trader}`} />
                </td>
                <td className="tnum">{Number(formatEther(BigInt(tr.ethAmount))).toPrecision(3)}</td>
                <td className="tnum text-[var(--muted)]">
                  {Math.round(Number(formatEther(BigInt(tr.tokenAmount)))).toLocaleString()}
                </td>
                <td className="tnum text-[var(--muted)]">{ago(Number(tr.timestamp))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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

function safeEther(v: string): bigint {
  try {
    return v ? parseEther(v as `${number}`) : 0n;
  } catch {
    return 0n;
  }
}
