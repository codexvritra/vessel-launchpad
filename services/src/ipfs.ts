// Pinata IPFS pinning for collection media + metadata. Uses the Pinata JWT.
// Media is uploaded once at create time; the resulting ipfs:// URI is what the
// on-chain `tokenURI` base / contractURI point at.

const JWT = process.env.PINATA_JWT ?? "";
const GATEWAY = process.env.PINATA_GATEWAY ?? "https://gateway.pinata.cloud";

export function ipfsToHttp(uri: string): string {
  return uri.startsWith("ipfs://") ? `${GATEWAY}/ipfs/${uri.slice("ipfs://".length)}` : uri;
}

export async function pinJson(name: string, json: unknown): Promise<string> {
  if (!JWT) throw new Error("PINATA_JWT not configured");
  const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${JWT}` },
    body: JSON.stringify({ pinataMetadata: { name }, pinataContent: json }),
  });
  if (!res.ok) throw new Error(`pinJson failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { IpfsHash: string };
  return `ipfs://${data.IpfsHash}`;
}

export async function pinFile(name: string, bytes: ArrayBuffer, contentType: string): Promise<string> {
  if (!JWT) throw new Error("PINATA_JWT not configured");
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: contentType }), name);
  form.append("pinataMetadata", JSON.stringify({ name }));
  const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${JWT}` },
    body: form,
  });
  if (!res.ok) throw new Error(`pinFile failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { IpfsHash: string };
  return `ipfs://${data.IpfsHash}`;
}
