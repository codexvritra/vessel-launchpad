"use client";

import { useState } from "react";
import { type Address, parseEther, zeroAddress } from "viem";
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { coinFactoryAbi, liquidityLauncherAbi, erc721ApprovalAbi } from "@/lib/abi";
import {
  COIN_FACTORY_ADDRESS,
  LIQUIDITY_LAUNCHER_ADDRESS,
  SUSHI_SWAP_URL,
  isConfigured,
} from "@/lib/config";
import { shortAddress } from "@/lib/format";
import { AddressTag } from "@/components/ui";

/**
 * Zora-style coin market: a collection can be wrapped in a fungible ERC-20 vault
 * (1 NFT = 1 coin) whose coin/ETH pool lives on SushiSwap, so the collection is
 * AMM-tradeable while the NFT stays the primitive.
 */
export function CoinMarketPanel({
  collection,
  coinFromApi,
  pairFromApi,
}: {
  collection: Address;
  coinFromApi?: string | null;
  pairFromApi?: string | null;
}) {
  const { isConnected } = useAccount();
  const factoryReady = isConfigured(COIN_FACTORY_ADDRESS);

  const { data: coinOnchain, refetch: refetchCoin } = useReadContract({
    address: COIN_FACTORY_ADDRESS,
    abi: coinFactoryAbi,
    functionName: "coinOf",
    args: [collection],
    query: { enabled: factoryReady },
  });

  const coin = ((coinOnchain as Address | undefined) ?? (coinFromApi as Address | undefined)) || undefined;
  const hasCoin = !!coin && coin !== zeroAddress;

  if (!factoryReady) {
    return (
      <div className="panel p-4">
        <div className="label mb-1">Coin market</div>
        <p className="text-xs text-[var(--muted)]">
          The fungible coin / SushiSwap layer is not configured for this deployment.
        </p>
      </div>
    );
  }

  return (
    <div className="panel p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="label">Coin market · SushiSwap</span>
        {hasCoin ? (
          <span className="chip chip-positive">Enabled</span>
        ) : (
          <span className="chip">Not enabled</span>
        )}
      </div>

      {!hasCoin ? (
        <EnableMarket collection={collection} onDone={() => void refetchCoin()} />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="label">Coin</span>
            <AddressTag address={coin!} short={shortAddress(coin!)} />
            {pairFromApi ? (
              <a
                className="text-[var(--vermilion)]"
                href={`${SUSHI_SWAP_URL}?token1=${coin}`}
                target="_blank"
                rel="noreferrer"
              >
                Trade on SushiSwap →
              </a>
            ) : (
              <span className="chip">No liquidity yet</span>
            )}
          </div>

          <p className="text-xs text-[var(--muted)]">
            1 NFT = 1 coin. Deposit tokens you own to mint coins, then seed a
            coin/ETH pool on SushiSwap so the collection trades.
          </p>

          {isConnected ? (
            <ProvideLiquidity collection={collection} />
          ) : (
            <p className="text-xs text-[var(--muted)]">Connect a wallet to provide liquidity.</p>
          )}
        </div>
      )}
    </div>
  );
}

function EnableMarket({
  collection,
  onDone,
}: {
  collection: Address;
  onDone: () => void;
}) {
  const { isConnected } = useAccount();
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading, isSuccess } = useWaitForTransactionReceipt({ hash });
  if (isSuccess) onDone();

  return (
    <div className="space-y-2">
      <p className="text-xs text-[var(--muted)]">
        Deploy the fungible coin vault for this collection (permissionless, one-time).
      </p>
      {!isConnected ? (
        <p className="text-xs text-[var(--muted)]">Connect a wallet to enable the market.</p>
      ) : (
        <button
          className="btn btn-primary"
          disabled={isPending || isLoading}
          onClick={() =>
            writeContract({
              address: COIN_FACTORY_ADDRESS,
              abi: coinFactoryAbi,
              functionName: "enableMarket",
              args: [collection],
            })
          }
        >
          {isPending ? "Confirm…" : isLoading ? "Enabling…" : "Enable coin market"}
        </button>
      )}
    </div>
  );
}

function ProvideLiquidity({ collection }: { collection: Address }) {
  const [ids, setIds] = useState("");
  const [ethAmt, setEthAmt] = useState("");
  const { writeContract, isPending } = useWriteContract();

  const tokenIds = ids
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      try {
        return BigInt(s);
      } catch {
        return null;
      }
    })
    .filter((v): v is bigint => v !== null);

  const launcherReady = isConfigured(LIQUIDITY_LAUNCHER_ADDRESS);
  if (!launcherReady) {
    return (
      <p className="border-t border-[var(--rule)] pt-3 text-xs text-[var(--muted)]">
        No one-click liquidity launcher configured on this deployment.
      </p>
    );
  }

  return (
    <div className="space-y-3 border-t border-[var(--rule)] pt-3">
      <div className="label">Provide liquidity — one click</div>
      <div className="flex flex-wrap gap-2">
        <input
          className="field field-mono"
          placeholder="token ids to wrap, e.g. 1, 2, 3"
          value={ids}
          onChange={(e) => setIds(e.target.value)}
        />
        <input
          className="field field-mono"
          style={{ width: "9rem" }}
          placeholder="ETH, e.g. 1"
          value={ethAmt}
          onChange={(e) => setEthAmt(e.target.value.replace(/[^0-9.]/g, ""))}
        />
      </div>
      <div className="flex gap-2">
        <button
          className="btn"
          title="One-time operator approval so the launcher can wrap your NFTs"
          onClick={() =>
            writeContract({
              address: collection,
              abi: erc721ApprovalAbi,
              functionName: "setApprovalForAll",
              args: [LIQUIDITY_LAUNCHER_ADDRESS, true],
            })
          }
        >
          1 · Approve
        </button>
        <button
          className="btn btn-primary"
          disabled={isPending || tokenIds.length === 0 || !ethAmt}
          onClick={() =>
            writeContract({
              address: LIQUIDITY_LAUNCHER_ADDRESS,
              abi: liquidityLauncherAbi,
              functionName: "launch",
              args: [collection, tokenIds, 0n, 0n],
              value: safeEther(ethAmt),
            })
          }
        >
          2 · Launch liquidity ({tokenIds.length || 0} → pool)
        </button>
      </div>
      <p className="text-xs text-[var(--muted)]">
        Wraps {tokenIds.length || "N"} NFTs into coins and seeds the SushiSwap
        coin/ETH pool in a single transaction. LP tokens are sent to you.
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
