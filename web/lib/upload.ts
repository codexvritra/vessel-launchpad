/**
 * Client-side image upload to IPFS via Pinata. Enable it by setting
 * NEXT_PUBLIC_PINATA_JWT (a free scoped JWT from https://app.pinata.cloud →
 * API Keys). Without it, upload is disabled and the launch form falls back to a
 * plain "image link" field. Uploads the image, then pins a small metadata JSON
 * so the collection has a proper tokenURI.
 */

const PINATA_JWT = process.env.NEXT_PUBLIC_PINATA_JWT?.trim() || "";
export const UPLOAD_ENABLED = PINATA_JWT.length > 0;

/** Public gateway for showing an ipfs:// URI as an <img> src. */
export function ipfsToHttp(uri: string): string {
  if (!uri) return "";
  if (uri.startsWith("ipfs://")) {
    return `https://gateway.pinata.cloud/ipfs/${uri.slice("ipfs://".length)}`;
  }
  return uri;
}

async function pinFile(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${PINATA_JWT}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Pin failed (${res.status})`);
  const data = (await res.json()) as { IpfsHash: string };
  return `ipfs://${data.IpfsHash}`;
}

async function pinJson(obj: unknown): Promise<string> {
  const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PINATA_JWT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ pinataContent: obj }),
  });
  if (!res.ok) throw new Error(`Pin failed (${res.status})`);
  const data = (await res.json()) as { IpfsHash: string };
  return `ipfs://${data.IpfsHash}`;
}

/**
 * Upload an image and return both the raw image URI (for preview) and a pinned
 * metadata JSON URI (name/description/image) suitable for contractURI.
 */
export async function uploadCollectionImage(
  file: File,
  meta: { name: string; description?: string },
): Promise<{ imageUri: string; metadataUri: string }> {
  if (!UPLOAD_ENABLED) throw new Error("Image upload is not configured");
  const imageUri = await pinFile(file);
  const metadataUri = await pinJson({
    name: meta.name || "Collection",
    description: meta.description || "",
    image: imageUri,
  });
  return { imageUri, metadataUri };
}
