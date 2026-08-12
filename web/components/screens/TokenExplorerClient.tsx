"use client";

import Link from "next/link";
import { useState } from "react";
import { formatEther, parseEther } from "viem";
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { tokenLauncherAbi } from "@/lib/abi";
import type { LaunchTokenRow } from "@/lib/api";
import { TOKEN_LAUNCHER_ADDRESS, isConfigured } from "@/lib/config";
import { useLaunchTokens } from "@/lib/hooks";
import { shortAddress } from "@/lib/format";
import { ArtMark, EmptyState, SectionHeader, Skeleton } from "@/components/ui";

/** Token launchpad: launch a bonding-curve token, and browse/trade the rest. */
export function TokenExplorerClient() {
  const { data, isLoading } = useLaunchTokens();
  const rows = data ?? [];

  return (
    <div>
      <SectionHeader kicker="Bonding curve" title="Launch & trade tokens" />
      <LaunchForm />
      <div className="mt-8">
        <div className="label mb-3">Top tokens</div>
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-40" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title="No tokens yet" hint="Launch the first one above." />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((r) => (
              <TokenCard key={r.address} row={r} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TokenCard({ row }: { row: LaunchTokenRow }) {
  const price = Number(row.lastPriceX18) / 1e18;
  const vol = Number(formatEther(BigInt(String(row.volumeWei ?? "0"))));
  return (
    <Link href={`/t/${row.address}`} className="certificate card-hover flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 p-4">
        <div className="h-11 w-11 overflow-hidden rounded-full border border-[var(--rule)]">
          <ArtMark seed={row.address} label={row.symbol ?? undefined} className="h-full w-full" />
        </div>
        <div className="min-w-0">
          <div className="truncate font-semibold">{row.name || shortAddress(row.address)}</div>
          <div className="tnum text-xs text-[var(--muted)]">{row.symbol}</div>
        </div>
        {row.graduated ? <span className="chip chip-positive ml-auto">Graduated</span> : null}
      </div>
      <dl className="grid grid-cols-3 gap-2 border-t border-[var(--rule)] p-3 text-sm">
        <Cell label="Price" value={price > 0 ? `${price.toPrecision(3)}` : "—"} unit="Ξ" />
        <Cell label="Volume" value={vol.toPrecision(3)} unit="Ξ" tone />
        <Cell label="Trades" value={String(row.tradeCount)} />
      </dl>
    </Link>
  );
}

function Cell({ label, value, unit, tone }: { label: string; value: string; unit?: string; tone?: boolean }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="tnum text-sm font-semibold" style={{ color: tone ? "var(--teal)" : "var(--ink)" }}>
        {value}
        {unit ? <span className="ml-0.5 text-xs text-[var(--muted)]">{unit}</span> : null}
      </div>
    </div>
  );
}

function LaunchForm() {
  const { isConnected } = useAccount();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [liq, setLiq] = useState("0.5");
  const ready = isConfigured(TOKEN_LAUNCHER_ADDRESS);

  const { data: feeData } = useReadContract({
    address: TOKEN_LAUNCHER_ADDRESS,
    abi: tokenLauncherAbi,
    functionName: "launchFeeWei",
    query: { enabled: ready },
  });
  const fee = (feeData as bigint | undefined) ?? 0n;

  const { writeContract, data: hash, isPending, isSuccess } = useWriteContract();
  const { isLoading: confirming } = useWaitForTransactionReceipt({ hash });

  const valid = name.trim() && symbol.trim() && Number(liq) > 0;

  return (
    <div className="certificate p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="section-title text-lg">Launch a token</div>
        <span className="chip">
          Launch fee {ready ? `${Number(formatEther(fee)).toPrecision(2)} Ξ (~$3)` : "$3"}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <input className="field" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input
          className="field field-mono"
          placeholder="TICKER"
          maxLength={11}
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
        />
        <input
          className="field field-mono"
          placeholder="liquidity (ETH)"
          value={liq}
          onChange={(e) => setLiq(e.target.value.replace(/[^0-9.]/g, ""))}
        />
      </div>
      <div className="mt-3">
        {!ready ? (
          <p className="text-xs text-[var(--muted)]">Token launcher not configured on this deployment.</p>
        ) : !isConnected ? (
          <ConnectButton />
        ) : isSuccess ? (
          <p className="text-sm text-[var(--teal)]">Launched 🎉 — it&apos;s live on SushiSwap. Find it in Top tokens below.</p>
        ) : (
          <button
            className="btn btn-primary"
            disabled={!valid || isPending || confirming}
            onClick={() =>
              writeContract({
                address: TOKEN_LAUNCHER_ADDRESS,
                abi: tokenLauncherAbi,
                functionName: "launch",
                args: [name, symbol],
                value: fee + safeEther(liq),
              })
            }
          >
            {isPending ? "Confirm…" : confirming ? "Launching…" : "Launch to SushiSwap"}
          </button>
        )}
      </div>
      <p className="mt-3 text-xs text-[var(--muted)]">
        Fair launch — your token + ETH seed a live SushiSwap pool instantly, so it
        trades on a real DEX (and DexScreener on mainnet) the moment it launches. A
        1% buy/sell tax goes to the protocol. LP is locked.
      </p>
    </div>
  );
}

function safeEther(v: string): bigint {
  try {
    return v ? parseEther(v as `${number}`) : 0n;
  } catch {
    return 0n;
  }
}
