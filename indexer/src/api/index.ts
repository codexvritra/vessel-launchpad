import { Hono } from "hono";
import { db } from "ponder:api";
import schema from "ponder:schema";
import { and, desc, eq, sql } from "ponder";

// REST API served alongside the indexer. Rankings come straight from the SQL
// views (vw_trending, vw_collection_metrics) — never recomputed here.
const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

// Explore / trending grid.
app.get("/trending", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 100);
  const backing = c.req.query("backing"); // optional filter by backing asset
  const rows = await db.execute(sql`
    SELECT t.*, c.backing_asset
    FROM vw_trending t
    JOIN collection c ON c.address = t.collection
    ${backing ? sql`WHERE c.backing_asset = ${backing.toLowerCase()}` : sql``}
    LIMIT ${limit}
  `);
  return c.json(rows.rows ?? rows);
});

// Collection detail: metrics + a page of tokens.
app.get("/collections/:address", async (c) => {
  const address = c.req.param("address").toLowerCase() as `0x${string}`;
  const metrics = await db.execute(
    sql`SELECT * FROM vw_collection_metrics WHERE collection = ${address}`,
  );
  const tokens = await db
    .select()
    .from(schema.token)
    .where(eq(schema.token.collection, address))
    .limit(60);
  return c.json({ metrics: (metrics.rows ?? metrics)[0] ?? null, tokens });
});

// Token detail — the differentiated screen: NFT + its TBA contents.
app.get("/tokens/:collection/:tokenId", async (c) => {
  const collection = c.req.param("collection").toLowerCase() as `0x${string}`;
  const tokenId = c.req.param("tokenId");
  const id = `${collection}:${tokenId}`;
  const token = await db.select().from(schema.token).where(eq(schema.token.id, id)).limit(1);
  const t = token[0];
  const holdings = t?.tba
    ? await db.select().from(schema.tbaHolding).where(eq(schema.tbaHolding.tba, t.tba))
    : [];
  return c.json({ token: t ?? null, holdings });
});

// Portfolio — every token an owner holds and its aggregate TBA value (raw units;
// USD conversion is applied in the pricing service via Chainlink).
app.get("/portfolio/:owner", async (c) => {
  const owner = c.req.param("owner").toLowerCase() as `0x${string}`;
  const tokens = await db.select().from(schema.token).where(eq(schema.token.owner, owner));
  const holdings = await db.execute(sql`
    SELECT h.* FROM tba_holding h
    JOIN token tk ON tk.id = h.token_ref
    WHERE tk.owner = ${owner}
  `);
  return c.json({ tokens, holdings: holdings.rows ?? holdings });
});

// Creator profile earnings.
app.get("/creators/:address", async (c) => {
  const address = c.req.param("address").toLowerCase() as `0x${string}`;
  const earnings = await db.execute(
    sql`SELECT * FROM vw_creator_earnings WHERE account = ${address}`,
  );
  const created = await db
    .select()
    .from(schema.collection)
    .where(eq(schema.collection.creator, address));
  return c.json({ earnings: (earnings.rows ?? earnings)[0] ?? null, created });
});

// --- Bonding-curve token launchpad ---

// Token explorer: newest / most-traded launch tokens.
app.get("/launch/tokens", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 60), 100);
  const rows = await db
    .select()
    .from(schema.launchToken)
    .orderBy(desc(schema.launchToken.volumeWei))
    .limit(limit);
  return c.json(rows);
});

// Token detail: the token, its recent trades (order history) and a price series.
app.get("/launch/:token", async (c) => {
  const token = c.req.param("token").toLowerCase() as `0x${string}`;
  const [row] = await db
    .select()
    .from(schema.launchToken)
    .where(eq(schema.launchToken.address, token))
    .limit(1);
  const trades = await db
    .select()
    .from(schema.trade)
    .where(eq(schema.trade.token, token))
    .orderBy(desc(schema.trade.timestamp))
    .limit(100);
  // Price series (oldest→newest) for the chart.
  const series = [...trades]
    .reverse()
    .map((t) => ({ t: Number(t.timestamp), p: t.priceX18.toString() }));
  return c.json({ token: row ?? null, trades, series });
});

export default app;
