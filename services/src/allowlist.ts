import { Hono } from "hono";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { createPublicClient, http, type Address } from "viem";
import { cacheGet, cacheSet } from "./cache.js";

// Merkle allowlist service. A creator registers the address list for an allowlist
// phase; we build a tree whose leaves and sibling hashing exactly match
// LaunchpadERC721A.mint's verification (OpenZeppelin StandardMerkleTree
// convention). Minters later fetch their proof here.
//
// SECURITY: registration is NOT session-gated. Instead we validate the submitted
// list against the phase's merkleRoot that is already committed ON-CHAIN — only
// the exact list that hashes to the committed root is accepted, so no one can
// store a forged allowlist. The chain is the authority.

export const allowlist = new Hono();

const rpc = process.env.ROBINHOOD_RPC_URL ?? "http://127.0.0.1:8545";
const client = createPublicClient({ transport: http(rpc) });

const phaseAbi = [
  {
    type: "function",
    name: "phase",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "merkleRoot", type: "bytes32" },
          { name: "price", type: "uint256" },
          { name: "startTime", type: "uint64" },
          { name: "endTime", type: "uint64" },
          { name: "perWalletCap", type: "uint32" },
          { name: "maxMintable", type: "uint32" },
        ],
      },
    ],
  },
] as const;

const key = (collection: string, phase: string | number) =>
  `allowlist:${collection.toLowerCase()}:${phase}`;
const TTL = 60 * 60 * 24 * 120; // 120 days

const isAddr = (a: unknown): a is string => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);

async function onChainRoot(collection: Address, phase: number): Promise<string | null> {
  try {
    const p = await client.readContract({
      address: collection,
      abi: phaseAbi,
      functionName: "phase",
      args: [BigInt(phase)],
    });
    return (p.merkleRoot as string).toLowerCase();
  } catch {
    return null;
  }
}

/// Register the allowlist for a collection+phase. Accepted only if the submitted
/// list hashes to the phase's on-chain committed root.
allowlist.post("/", async (c) => {
  const body = await c.req.json<{ collection?: string; phase?: number; addresses?: string[] }>();
  const { collection, phase } = body;
  if (!isAddr(collection) || phase === undefined || !Array.isArray(body.addresses)) {
    return c.json({ error: "collection, phase, addresses required" }, 400);
  }
  const values = [...new Set(body.addresses.filter(isAddr).map((a) => a.toLowerCase()))].map(
    (a) => [a] as [string],
  );
  if (values.length === 0) return c.json({ error: "no valid addresses" }, 400);

  const tree = StandardMerkleTree.of(values, ["address"]);

  const committed = await onChainRoot(collection as Address, phase);
  if (committed === null) return c.json({ error: "cannot read on-chain root" }, 502);
  if (committed !== tree.root.toLowerCase()) {
    return c.json({ error: "list does not match committed on-chain root", root: tree.root }, 409);
  }

  await cacheSet(key(collection, phase), JSON.stringify(tree.dump()), TTL);
  return c.json({ root: tree.root, count: values.length });
});

/// The stored root for a collection+phase.
allowlist.get("/root", async (c) => {
  const collection = c.req.query("collection");
  const phase = c.req.query("phase");
  if (!collection || phase === undefined) return c.json({ root: null, count: 0 });
  const dump = await cacheGet(key(collection, phase));
  if (!dump) return c.json({ root: null, count: 0 });
  const tree = StandardMerkleTree.load(JSON.parse(dump));
  let count = 0;
  for (const _ of tree.entries()) count++;
  return c.json({ root: tree.root, count });
});

/// The Merkle proof for one address, or listed=false if not on the list.
allowlist.get("/proof", async (c) => {
  const collection = c.req.query("collection");
  const phase = c.req.query("phase");
  const address = c.req.query("address");
  if (!collection || phase === undefined || !address) {
    return c.json({ listed: false, proof: [] as string[], root: null });
  }
  const dump = await cacheGet(key(collection, phase));
  if (!dump) return c.json({ listed: false, proof: [] as string[], root: null });

  const tree = StandardMerkleTree.load(JSON.parse(dump));
  for (const [i, v] of tree.entries()) {
    if ((v[0] as string).toLowerCase() === address.toLowerCase()) {
      return c.json({ listed: true, proof: tree.getProof(i), root: tree.root });
    }
  }
  return c.json({ listed: false, proof: [] as string[], root: tree.root });
});
