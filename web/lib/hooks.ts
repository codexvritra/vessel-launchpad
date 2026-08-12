"use client";

import { useQuery } from "@tanstack/react-query";
import {
  getAllowlistProof,
  getCollection,
  getCreator,
  getLaunchToken,
  getLaunchTokens,
  getPortfolio,
  getToken,
  getTrending,
} from "./api";

/**
 * react-query hooks with polling as a baseline. lib/realtime.ts layers chain
 * event subscriptions on top (WebSocket push when a ws RPC is configured),
 * invalidating these queries on the relevant on-chain events.
 */

const POLL = 20_000;

export function useTrending(backing?: string) {
  return useQuery({
    queryKey: ["trending", backing ?? "all"],
    queryFn: () => getTrending(backing),
    refetchInterval: POLL,
  });
}

export function useCollection(address: string | null) {
  return useQuery({
    queryKey: ["collection", address],
    queryFn: () => getCollection(address as string),
    enabled: !!address,
    refetchInterval: POLL,
  });
}

export function useToken(collection: string | null, id: string | null) {
  return useQuery({
    queryKey: ["token", collection, id],
    queryFn: () => getToken(collection as string, id as string),
    enabled: !!collection && !!id,
    refetchInterval: 15_000,
  });
}

export function usePortfolio(owner: string | null) {
  return useQuery({
    queryKey: ["portfolio", owner],
    queryFn: () => getPortfolio(owner as string),
    enabled: !!owner,
    refetchInterval: POLL,
  });
}

export function useCreator(address: string | null) {
  return useQuery({
    queryKey: ["creator", address],
    queryFn: () => getCreator(address as string),
    enabled: !!address,
    refetchInterval: POLL,
  });
}

export function useLaunchTokens() {
  return useQuery({
    queryKey: ["launchTokens"],
    queryFn: () => getLaunchTokens(),
    refetchInterval: POLL,
  });
}

export function useLaunchToken(token: string | null) {
  return useQuery({
    queryKey: ["launchToken", token],
    queryFn: () => getLaunchToken(token as string),
    enabled: !!token,
    refetchInterval: 4000, // live-ish trades + price
  });
}

/** Merkle proof for an allowlist-phase mint, for the connected address. */
export function useAllowlistProof(
  collection: string | null,
  phase: number | null,
  address: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["allowlistProof", collection, phase, address],
    queryFn: () => getAllowlistProof(collection as string, phase as number, address as string),
    enabled: enabled && !!collection && phase != null && !!address,
    staleTime: 60_000,
  });
}
