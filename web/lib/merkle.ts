import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

/**
 * Client-side Merkle root computation for allowlist phases. Uses the exact
 * OpenZeppelin StandardMerkleTree convention (double-hashed address leaves,
 * sorted sibling pairs) that LaunchpadERC721A.mint verifies against, so the root
 * computed here in the browser is the one baked into the on-chain phase config.
 */

/** Parse a free-form textarea (newline/comma/space separated) into unique addresses. */
export function parseAddressList(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[\s,]+/)
        .map((s) => s.trim().toLowerCase())
        .filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a)),
    ),
  ];
}

/** Compute the Merkle root for an address list, or null if empty. */
export function computeMerkleRoot(addresses: string[]): `0x${string}` | null {
  if (addresses.length === 0) return null;
  const tree = StandardMerkleTree.of(
    addresses.map((a) => [a] as [string]),
    ["address"],
  );
  return tree.root as `0x${string}`;
}
