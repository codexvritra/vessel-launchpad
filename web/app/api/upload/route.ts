import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Server-side image upload → IPFS via Pinata. The key stays on the server
// (set PINATA_JWT in the environment — NOT NEXT_PUBLIC, so it's never shipped to
// the browser). Pins the image, then a small metadata JSON, and returns both URIs.
const PINATA_JWT = (process.env.PINATA_JWT || "").trim();

async function pinFile(file: File): Promise<string> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${PINATA_JWT}` },
    body,
  });
  if (!res.ok) throw new Error(`image pin failed (${res.status})`);
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
  if (!res.ok) throw new Error(`metadata pin failed (${res.status})`);
  const data = (await res.json()) as { IpfsHash: string };
  return `ipfs://${data.IpfsHash}`;
}

export async function POST(req: Request) {
  if (!PINATA_JWT) {
    return NextResponse.json(
      { error: "Image upload isn't set up yet (missing PINATA_JWT)." },
      { status: 501 },
    );
  }
  try {
    const form = await req.formData();
    const file = form.get("file");
    const name = String(form.get("name") || "Collection");
    const description = String(form.get("description") || "");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 });
    }
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "Image too large (max 10MB)." }, { status: 413 });
    }
    const imageUri = await pinFile(file);
    const metadataUri = await pinJson({ name, description, image: imageUri });
    return NextResponse.json({ imageUri, metadataUri });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed." },
      { status: 502 },
    );
  }
}
