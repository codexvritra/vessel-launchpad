import { ipfsToHttp } from "./ipfs.js";
import { priceHoldings } from "./pricing.js";

// Metadata service. EIP-7572 contract-level metadata + per-token metadata. The
// per-token document is where Signapad's differentiator surfaces: the NFT's
// token-bound-account holdings are folded in as attributes with a live USD total,
// so any marketplace that reads tokenURI shows "this NFT holds $X".

const INDEXER = process.env.INDEXER_API_URL ?? "http://localhost:42069";
const MEDIA_BASE = process.env.MEDIA_BASE ?? ""; // ipfs:// base for token art

async function indexer<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${INDEXER}${path}`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function contractMetadata(collection: string) {
  const data = await indexer<{ metrics: any }>(`/collections/${collection}`);
  const m = data?.metrics;
  return {
    name: m?.name ?? "Signapad Collection",
    symbol: m?.symbol ?? "VSSL",
    description:
      "A Signapad collection. Every token owns an ERC-6551 account funded at mint — an NFT that is also a wallet.",
    image: MEDIA_BASE ? ipfsToHttp(`${MEDIA_BASE}/cover.png`) : undefined,
    // EIP-7572 extras
    collaborators: m?.creator ? [m.creator] : [],
  };
}

export async function tokenMetadata(collection: string, tokenId: string) {
  const data = await indexer<{
    token: { tba?: string; owner?: string } | null;
    holdings: { asset: string; amount: string }[];
  }>(`/tokens/${collection}/${tokenId}`);

  const holdings = data?.holdings ?? [];
  const { totalUsd, priced } = await priceHoldings(holdings);

  const attributes: Array<Record<string, unknown>> = [
    { trait_type: "Token ID", value: Number(tokenId) },
  ];
  if (data?.token?.tba) attributes.push({ trait_type: "Wallet", value: data.token.tba });
  if (totalUsd !== null)
    attributes.push({ trait_type: "Wallet Value (USD)", value: Number(totalUsd.toFixed(2)) });
  for (const p of priced) {
    attributes.push({
      trait_type: `Holds ${short(p.asset)}`,
      value: p.usd !== null ? `$${p.usd.toFixed(2)}` : p.amount,
    });
  }

  return {
    name: `Signapad #${tokenId}`,
    description: "A token-bound NFT wallet on Signapad.",
    image: MEDIA_BASE ? ipfsToHttp(`${MEDIA_BASE}/${tokenId}.png`) : undefined,
    external_url: `${process.env.APP_ORIGIN ?? "http://localhost:3000"}/token/${collection}/${tokenId}`,
    attributes,
    // Non-standard but useful for our own client:
    vessel: { tba: data?.token?.tba ?? null, holdings: priced, totalUsd },
  };
}

function short(a: string): string {
  return a === "0x0000000000000000000000000000000000000000"
    ? "ETH"
    : `${a.slice(0, 6)}…${a.slice(-4)}`;
}
