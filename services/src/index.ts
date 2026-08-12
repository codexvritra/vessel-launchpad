import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getCookie } from "hono/cookie";
import { rateLimit, cached } from "./cache.js";
import { contractMetadata, tokenMetadata } from "./metadata.js";
import { pinJson, pinFile } from "./ipfs.js";
import { auth, sessionAddress } from "./auth.js";
import { allowlist } from "./allowlist.js";

const app = new Hono();

app.use("*", cors({ origin: process.env.APP_ORIGIN ?? "*", credentials: true }));

// Per-IP rate limiting. Mint pages get hammered during drops; a launchpad that
// falls over under load loses trust permanently.
app.use("*", async (c, next) => {
  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    "anon";
  const ok = await rateLimit(ip, Number(process.env.RATE_LIMIT ?? 120), 60);
  if (!ok) return c.json({ error: "rate limited" }, 429);
  await next();
});

app.get("/health", (c) => c.json({ ok: true }));

app.route("/auth", auth);
app.route("/allowlist", allowlist);

// EIP-7572 contract-level metadata. Cached hard.
app.get("/contract/:address", async (c) => {
  const address = c.req.param("address").toLowerCase();
  const data = await cached(`meta:contract:${address}`, 300, () => contractMetadata(address));
  c.header("Cache-Control", "public, max-age=60, s-maxage=300");
  return c.json(data);
});

// Per-token metadata (tokenURI target). Cached aggressively — this endpoint is
// hit constantly by marketplaces and wallets.
app.get("/token/:collection/:tokenId", async (c) => {
  const collection = c.req.param("collection").toLowerCase();
  const tokenId = c.req.param("tokenId");
  const data = await cached(`meta:token:${collection}:${tokenId}`, 30, () =>
    tokenMetadata(collection, tokenId),
  );
  c.header("Cache-Control", "public, max-age=15, s-maxage=30");
  return c.json(data);
});

// IPFS pinning — auth-gated (only a signed-in creator can pin).
app.post("/pin/json", async (c) => {
  const addr = await sessionAddress(getCookie(c, "vessel_session"));
  if (!addr) return c.json({ error: "unauthorized" }, 401);
  const { name, content } = await c.req.json<{ name: string; content: unknown }>();
  try {
    const uri = await pinJson(name ?? "vessel.json", content);
    return c.json({ uri });
  } catch (e) {
    return c.json({ error: String(e) }, 502);
  }
});

app.post("/pin/file", async (c) => {
  const addr = await sessionAddress(getCookie(c, "vessel_session"));
  if (!addr) return c.json({ error: "unauthorized" }, 401);
  const body = await c.req.parseBody();
  const file = body["file"];
  if (!(file instanceof File)) return c.json({ error: "no file" }, 400);
  try {
    const uri = await pinFile(file.name, await file.arrayBuffer(), file.type);
    return c.json({ uri });
  } catch (e) {
    return c.json({ error: String(e) }, 502);
  }
});

const port = Number(process.env.PORT ?? 8080);
serve({ fetch: app.fetch, port });
console.log(`[vessel-services] listening on :${port}`);

export default app;
