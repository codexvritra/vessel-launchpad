"use client";

import Link from "next/link";
import type { HoldingRow } from "@/lib/api";
import { useToken } from "@/lib/hooks";
import { useWatchTokenFunding } from "@/lib/realtime";
import {
  backingAssetLabel,
  formatAmount,
  formatUsd,
  normalizeAddress,
  shortAddress,
} from "@/lib/format";
import {
  holdingDecimals,
  holdingSymbol,
  holdingUsd,
  sumUsd,
} from "@/lib/pricing";
import {
  AddressTag,
  ArtMark,
  EmptyState,
  SectionHeader,
  Skeleton,
} from "@/components/ui";

export function TokenClient({
  collection,
  tokenId,
}: {
  collection: string;
  tokenId: string;
}) {
  const coll = normalizeAddress(collection);
  const { data, isLoading, dataUpdatedAt } = useToken(coll, tokenId);
  // Live: refresh this token's holdings when its TBA is funded on-chain.
  useWatchTokenFunding(coll, tokenId);

  if (!coll) {
    return (
      <EmptyState
        title="Invalid token address"
        action={
          <Link href="/" className="btn">
            Back to register
          </Link>
        }
      />
    );
  }

  const token = data?.token ?? null;
  const holdings = data?.holdings ?? [];
  const totalUsd = sumUsd(holdings);

  return (
    <div>
      <SectionHeader kicker="Token-bound account" title={`Vessel #${tokenId}`} />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Link
          href={`/collection/${coll}`}
          className="tnum text-[var(--muted)] hover:text-[var(--vermilion)]"
        >
          {shortAddress(coll)}
        </Link>
        <span className="text-[var(--rule)]">/</span>
        <span className="tnum">#{tokenId}</span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        {/* The certificate */}
        <div>
          <div className="certificate overflow-hidden">
            <ArtMark
              seed={`${coll}:${tokenId}`}
              label={`#${tokenId}`}
              className="aspect-square w-full"
            />
            <div className="space-y-2 p-4 text-sm">
              <KV k="Owner">
                {token?.owner ? (
                  <AddressTag
                    address={token.owner}
                    short={shortAddress(token.owner)}
                    href={`/portfolio/${token.owner}`}
                  />
                ) : (
                  <span className="text-[var(--muted)]">—</span>
                )}
              </KV>
              <KV k="Vessel (TBA)">
                <span className="tnum text-[var(--muted)]">
                  {token?.tba ? shortAddress(token.tba) : "not deployed"}
                </span>
              </KV>
              <KV k="Minter">
                <span className="tnum text-[var(--muted)]">
                  {token?.minter ? shortAddress(token.minter) : "—"}
                </span>
              </KV>
            </div>
          </div>
        </div>

        {/* The wallet-inside-the-NFT */}
        <div className="space-y-5">
          <div className="certificate p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="label">This NFT holds</div>
                <div className="mt-1 tnum text-4xl font-bold positive sm:text-5xl">
                  {formatUsd(totalUsd)}
                </div>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  in {holdings.length} asset{holdings.length === 1 ? "" : "s"},
                  held inside token #{tokenId}&apos;s own wallet.
                </p>
              </div>
              <div className="hidden sm:block text-right">
                <div className="label">Vessel address</div>
                <div className="tnum text-sm">
                  {token?.tba ? shortAddress(token.tba, 6) : "—"}
                </div>
              </div>
            </div>
          </div>

          <Holdings holdings={holdings} isLoading={isLoading} />
          <History holdings={holdings} updatedAt={dataUpdatedAt} />
        </div>
      </div>
    </div>
  );
}

function Holdings({
  holdings,
  isLoading,
}: {
  holdings: HoldingRow[];
  isLoading: boolean;
}) {
  if (isLoading) return <Skeleton className="h-40" />;
  if (holdings.length === 0) {
    return (
      <EmptyState
        title="This vessel is empty"
        hint="No assets are currently held in the token-bound account, or the indexer hasn't observed any yet."
      />
    );
  }
  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-[var(--ink)] p-3">
        <span className="label">Contents of the vessel</span>
      </div>
      <div className="overflow-x-auto">
        <table className="ledger text-sm">
          <thead>
            <tr>
              <th className="label">Asset</th>
              <th className="label">Balance</th>
              <th className="label text-right">Value (USD)</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => {
              const sym = holdingSymbol(h);
              const dec = holdingDecimals(h);
              const usd = holdingUsd(h);
              return (
                <tr key={h.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <span className="chip">{sym}</span>
                      <span className="tnum text-xs text-[var(--muted)]">
                        {backingAssetLabel(h.asset)}
                      </span>
                    </div>
                  </td>
                  <td className="tnum">{formatAmount(h.amount, dec, 6)}</td>
                  <td className="tnum text-right positive">
                    {usd > 0 ? formatUsd(usd) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function History({
  holdings,
  updatedAt,
}: {
  holdings: HoldingRow[];
  updatedAt: number;
}) {
  const events = holdings
    .map((h) => {
      const ts = Number(h.updatedAt ?? h.updated_at ?? 0);
      return { asset: holdingSymbol(h), ts };
    })
    .filter((e) => e.ts > 0)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 6);

  return (
    <div className="panel p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="label">Recent activity</span>
        {updatedAt ? (
          <span className="tnum text-xs text-[var(--muted)]">
            synced {new Date(updatedAt).toLocaleTimeString()}
          </span>
        ) : null}
      </div>
      {events.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          No balance changes recorded yet. Deposits and withdrawals to this
          vessel will appear here.{" "}
          <span className="italic">
            (TODO: full transfer history via the indexer / websocket feed.)
          </span>
        </p>
      ) : (
        <ul className="space-y-1 text-sm">
          {events.map((e, i) => (
            <li
              key={i}
              className="flex items-center justify-between border-b border-[var(--rule)] pb-1 last:border-0"
            >
              <span>
                <span className="chip mr-2">{e.asset}</span>
                balance updated
              </span>
              <span className="tnum text-[var(--muted)]">
                {new Date(e.ts * 1000).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function KV({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="label">{k}</span>
      <span>{children}</span>
    </div>
  );
}
