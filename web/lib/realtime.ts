"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWatchContractEvent } from "wagmi";
import { type Address, zeroAddress } from "viem";
import { collectionFactoryAbi, launchpadErc721aAbi } from "./abi";
import { FACTORY_ADDRESS, isConfigured } from "./config";

/**
 * Real-time updates via chain event subscriptions. With a WebSocket RPC
 * configured (NEXT_PUBLIC_WS_RPC_URL) these are true push notifications over
 * `eth_subscribe`; otherwise wagmi transparently falls back to fast http
 * polling. Either way the UI reacts to on-chain events instead of only the
 * slower react-query interval.
 */

/** Watch the factory for newly deployed collections; refresh the explore grid. */
export function useWatchNewCollections() {
  const qc = useQueryClient();
  useWatchContractEvent({
    address: isConfigured(FACTORY_ADDRESS) ? FACTORY_ADDRESS : undefined,
    abi: collectionFactoryAbi,
    eventName: "CollectionCreated",
    enabled: isConfigured(FACTORY_ADDRESS),
    onLogs: () => {
      qc.invalidateQueries({ queryKey: ["trending"] });
    },
  });
}

/**
 * Watch one collection's mint (Transfer-from-zero) events. Returns a monotonic
 * counter of live mints seen this session so widgets can optimistically bump the
 * supply meter, and invalidates the collection/token queries so indexed data
 * catches up.
 */
export function useWatchCollectionMints(address: string | null) {
  const qc = useQueryClient();
  const [liveMints, setLiveMints] = useState(0);
  const valid = !!address && address.startsWith("0x") && address !== zeroAddress;

  useWatchContractEvent({
    address: valid ? (address as Address) : undefined,
    abi: launchpadErc721aAbi,
    eventName: "Transfer",
    enabled: valid,
    onLogs: (logs) => {
      const mints = logs.filter(
        (l) => (l.args as { from?: string }).from?.toLowerCase() === zeroAddress,
      ).length;
      if (mints > 0) {
        setLiveMints((n) => n + mints);
        qc.invalidateQueries({ queryKey: ["collection", address] });
      }
    },
  });

  return liveMints;
}

/** Watch TBA funding for a specific token; refresh its holdings view live. */
export function useWatchTokenFunding(collection: string | null, tokenId: string | null) {
  const qc = useQueryClient();
  const valid = !!collection && collection.startsWith("0x") && collection !== zeroAddress;
  useEffect(() => {
    // reset handled by query invalidation; nothing to clean up here
  }, [collection, tokenId]);

  useWatchContractEvent({
    address: valid ? (collection as Address) : undefined,
    abi: launchpadErc721aAbi,
    eventName: "TokenBoundAccountFunded",
    enabled: valid && !!tokenId,
    onLogs: (logs) => {
      const hit = logs.some(
        (l) => String((l.args as { tokenId?: bigint }).tokenId) === tokenId,
      );
      if (hit) qc.invalidateQueries({ queryKey: ["token", collection, tokenId] });
    },
  });
}
