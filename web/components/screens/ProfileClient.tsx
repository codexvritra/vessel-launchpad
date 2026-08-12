"use client";

import Link from "next/link";
import { formatEther } from "viem";
import { usePortfolio, useCreator } from "@/lib/hooks";
import {
  formatEth,
  formatInt,
  normalizeAddress,
  shortAddress,
} from "@/lib/format";
import {
  ArtMark,
  EmptyState,
  SectionHeader,
  Skeleton,
  Stat,
} from "@/components/ui";

export function ProfileClient({ address }: { address: string }) {
  const addr = normalizeAddress(address);
  const { data: creator, isLoading: loadingCreator } = useCreator(addr);
  const { data: portfolio, isLoading: loadingPortfolio } = usePortfolio(addr);

  if (!addr) {
    return (
      <EmptyState
        title="Invalid address"
        action={
          <Link href="/" className="btn">
            Back to register
          </Link>
        }
      />
    );
  }

  const created = creator?.created ?? [];
  const earnings = creator?.earnings ?? null;
  const heldTokens = portfolio?.tokens ?? [];

  const mintEarnings = earnings?.mint_earnings_wei
    ? formatEther(BigInt(earnings.mint_earnings_wei))
    : "0";
  const claimed = earnings?.claimed_wei
    ? BigInt(earnings.claimed_wei)
    : 0n;
  const gross = earnings?.mint_earnings_wei
    ? BigInt(earnings.mint_earnings_wei)
    : 0n;
  const claimable = gross > claimed ? gross - claimed : 0n;

  return (
    <div>
      <SectionHeader
        kicker="Account"
        title={shortAddress(addr, 6)}
        right={
          <Link href={`/portfolio/${addr}`} className="btn">
            View portfolio →
          </Link>
        }
      />

      <div className="panel mb-8 grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
        <Stat label="Collections" value={formatInt(created.length)} />
        <Stat label="Tokens held" value={formatInt(heldTokens.length)} />
        <Stat
          label="Mint earnings"
          value={formatEth(mintEarnings)}
          unit="Ξ"
          tone="positive"
        />
        <Stat
          label="Claimable"
          value={formatEth(formatEther(claimable))}
          unit="Ξ"
          tone="accent"
          sub={
            claimable > 0n ? (
              <span className="italic">withdraw via FeeSplitter</span>
            ) : (
              "nothing to claim"
            )
          }
        />
      </div>

      <SectionHeader kicker="Issued" title="Created collections" />
      {loadingCreator ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : created.length === 0 ? (
        <EmptyState
          title="No collections issued"
          hint="Collections deployed from this account will be listed here."
          action={
            <Link href="/create" className="btn btn-primary">
              Create one
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {created.map((c) => (
            <Link
              key={c.address}
              href={`/collection/${c.address}`}
              className="certificate group flex flex-col"
            >
              <ArtMark
                seed={c.address}
                label={c.symbol ?? undefined}
                className="h-28 w-full"
              />
              <div className="flex flex-1 flex-col gap-2 p-3">
                <h3 className="font-serif text-lg font-bold group-hover:text-[var(--vermilion)]">
                  {c.name || shortAddress(c.address)}
                </h3>
                <dl className="mt-auto grid grid-cols-2 gap-2 border-t border-[var(--rule)] pt-2 text-sm">
                  <div>
                    <div className="label" style={{ fontSize: "0.6rem" }}>
                      Minted
                    </div>
                    <div className="tnum">{formatInt(c.totalMinted)}</div>
                  </div>
                  <div>
                    <div className="label" style={{ fontSize: "0.6rem" }}>
                      Holders
                    </div>
                    <div className="tnum">{formatInt(c.holderCount)}</div>
                  </div>
                </dl>
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-10">
        <SectionHeader kicker="Wallet" title="Tokens held" />
        {loadingPortfolio ? (
          <Skeleton className="h-32" />
        ) : heldTokens.length === 0 ? (
          <EmptyState title="No tokens held by this account yet" />
        ) : (
          <div className="panel overflow-x-auto">
            <table className="ledger text-sm">
              <thead>
                <tr>
                  <th className="label">Collection</th>
                  <th className="label">Token</th>
                  <th className="label">Signapad</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {heldTokens.slice(0, 40).map((t) => (
                  <tr key={t.id}>
                    <td className="tnum">{shortAddress(t.collection)}</td>
                    <td className="tnum">#{String(t.tokenId)}</td>
                    <td className="tnum text-[var(--muted)]">
                      {t.tba ? shortAddress(t.tba) : "—"}
                    </td>
                    <td className="text-right">
                      <Link
                        href={`/token/${t.collection}/${String(t.tokenId)}`}
                        className="text-[var(--vermilion)]"
                      >
                        Open →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
