import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Server-side image upload — zero configuration. The image is uploaded to a free,
 * keyless public file host; the collection's metadata (name/description/image) is
 * returned as a small data: URI so it can be stored on-chain directly (cheap on an
 * L2). No API keys, no accounts — people just upload and launch.
 */
async function hostImage(file: File): Promise<string> {
  const body = new FormData();
  body.append("reqtype", "fileupload");
  body.append("fileToUpload", file, file.name || "image");
  const res = await fetch("https://catbox.moe/user/api.php", {
    method: "POST",
    body,
  });
  const text = (await res.text()).trim();
  if (!res.ok || !/^https?:\/\//.test(text)) {
    throw new Error(text || `upload failed (${res.status})`);
  }
  return text;
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const name = String(form.get("name") || "Collection");
    const description = String(form.get("description") || "");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 });
    }
    if (file.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: "Image too large (max 50MB)." }, { status: 413 });
    }

    const imageUri = await hostImage(file);
    const metaJson = JSON.stringify({ name, description, image: imageUri });
    const metadataUri = `data:application/json;base64,${Buffer.from(metaJson).toString("base64")}`;
    return NextResponse.json({ imageUri, metadataUri });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed." },
      { status: 502 },
    );
  }
}
