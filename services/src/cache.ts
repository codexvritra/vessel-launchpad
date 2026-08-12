import Redis from "ioredis";

// Redis-backed cache + rate limiter with an in-memory fallback so the service
// runs (degraded) without Redis in local dev. Mint pages get hammered during
// drops; caching and rate limiting are what keep the service up under load.

const url = process.env.REDIS_URL;
const redis = url ? new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: true }) : null;
if (redis) redis.connect().catch(() => console.warn("[cache] redis unavailable, using memory"));

const mem = new Map<string, { value: string; expires: number }>();

export async function cacheGet(key: string): Promise<string | null> {
  if (redis && redis.status === "ready") {
    try {
      return await redis.get(key);
    } catch {
      /* fall through */
    }
  }
  const hit = mem.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    mem.delete(key);
    return null;
  }
  return hit.value;
}

export async function cacheSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  if (redis && redis.status === "ready") {
    try {
      await redis.set(key, value, "EX", ttlSeconds);
      return;
    } catch {
      /* fall through */
    }
  }
  mem.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
}

/// Fixed-window rate limiter. Returns true if the request is allowed.
export async function rateLimit(id: string, limit: number, windowSeconds: number): Promise<boolean> {
  const key = `rl:${id}:${Math.floor(Date.now() / 1000 / windowSeconds)}`;
  if (redis && redis.status === "ready") {
    try {
      const n = await redis.incr(key);
      if (n === 1) await redis.expire(key, windowSeconds);
      return n <= limit;
    } catch {
      /* fall through */
    }
  }
  const hit = mem.get(key);
  const n = (hit ? Number(hit.value) : 0) + 1;
  mem.set(key, { value: String(n), expires: Date.now() + windowSeconds * 1000 });
  return n <= limit;
}

/// Cache-aside helper.
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  produce: () => Promise<T>,
): Promise<T> {
  const hit = await cacheGet(key);
  if (hit) return JSON.parse(hit) as T;
  const value = await produce();
  await cacheSet(key, JSON.stringify(value), ttlSeconds);
  return value;
}
