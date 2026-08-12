import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { SiweMessage, generateNonce } from "siwe";
import { SignJWT, jwtVerify } from "jose";
import { cacheGet, cacheSet } from "./cache.js";

// Sign-In With Ethereum (EIP-4361). No passwords, no email. A short-lived nonce is
// issued, the wallet signs a SIWE message, and on verify we mint a JWT session.

const secret = new TextEncoder().encode(process.env.SESSION_SECRET ?? "dev-insecure-secret-change-me");
const DOMAIN = process.env.AUTH_DOMAIN ?? "localhost";
const ORIGIN = process.env.AUTH_ORIGIN ?? "http://localhost:3000";

export const auth = new Hono();

auth.get("/nonce", async (c) => {
  const nonce = generateNonce();
  await cacheSet(`nonce:${nonce}`, "1", 300); // 5 min
  return c.text(nonce);
});

auth.post("/verify", async (c) => {
  const { message, signature } = await c.req.json<{ message: string; signature: string }>();
  const siwe = new SiweMessage(message);

  const known = await cacheGet(`nonce:${siwe.nonce}`);
  if (!known) return c.json({ error: "invalid or expired nonce" }, 401);

  try {
    const result = await siwe.verify({ signature, domain: DOMAIN, nonce: siwe.nonce });
    if (!result.success) return c.json({ error: "verification failed" }, 401);
  } catch (e) {
    return c.json({ error: "verification failed" }, 401);
  }
  await cacheSet(`nonce:${siwe.nonce}`, "", 1); // consume nonce

  const token = await new SignJWT({ sub: siwe.address })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);

  setCookie(c, "vessel_session", token, {
    httpOnly: true,
    secure: ORIGIN.startsWith("https"),
    sameSite: "Lax",
    maxAge: 7 * 24 * 3600,
    path: "/",
  });
  return c.json({ address: siwe.address });
});

auth.get("/me", async (c) => {
  const token = getCookie(c, "vessel_session");
  if (!token) return c.json({ address: null });
  try {
    const { payload } = await jwtVerify(token, secret);
    return c.json({ address: payload.sub });
  } catch {
    return c.json({ address: null });
  }
});

auth.post("/logout", (c) => {
  setCookie(c, "vessel_session", "", { maxAge: 0, path: "/" });
  return c.json({ ok: true });
});

/// Extract the authenticated address from a request, or null.
export async function sessionAddress(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return (payload.sub as string) ?? null;
  } catch {
    return null;
  }
}
