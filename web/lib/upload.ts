/**
 * Client helper: uploads the chosen image through our own server route
 * (/api/upload), which pins it to IPFS via Pinata using a server-side key.
 * The browser never sees the key. Returns the image URI and a pinned metadata
 * URI (name/description/image) to use as the collection's contractURI.
 */

/** Public gateway for showing an ipfs:// URI as an <img> src. */
export function ipfsToHttp(uri: string): string {
  if (!uri) return "";
  if (uri.startsWith("ipfs://")) {
    return `https://gateway.pinata.cloud/ipfs/${uri.slice("ipfs://".length)}`;
  }
  return uri;
}

export async function uploadCollectionImage(
  file: File,
  meta: { name: string; description?: string },
): Promise<{ imageUri: string; metadataUri: string }> {
  const form = new FormData();
  form.append("file", file);
  form.append("name", meta.name || "Collection");
  form.append("description", meta.description || "");

  const res = await fetch("/api/upload", { method: "POST", body: form });
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(detail.error || `Upload failed (${res.status})`);
  }
  return (await res.json()) as { imageUri: string; metadataUri: string };
}
