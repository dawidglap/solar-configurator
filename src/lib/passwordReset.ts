import crypto from "node:crypto";
import type { Db } from "mongodb";
import { isAllowedCorsOrigin } from "@/lib/cors";
import { safeString } from "@/lib/api-session";

const WINDOW_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;
let indexesPromise: Promise<void> | null = null;

export function hashPasswordResetToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function createPasswordResetToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function extractRequestIp(req: Request) {
  return safeString(req.headers.get("cf-connecting-ip")) ||
    safeString(req.headers.get("x-real-ip")) ||
    safeString(req.headers.get("x-forwarded-for")).split(",")[0]?.trim() ||
    "unknown";
}

export function validatePasswordResetRedirect(value: unknown) {
  const raw = safeString(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const isLocalDevelopment = process.env.NODE_ENV !== "production" &&
      url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.username || url.password || (!isAllowedCorsOrigin(url.origin) && !isLocalDevelopment)) {
      return null;
    }
    if (url.protocol !== "https:" && !isLocalDevelopment) return null;
    url.hash = "";
    url.searchParams.delete("token");
    return url;
  } catch {
    return null;
  }
}

export async function ensurePasswordResetIndexes(db: Db) {
  if (!indexesPromise) {
    indexesPromise = Promise.all([
      db.collection("password_reset_tokens").createIndex({ tokenHash: 1 }, { unique: true }),
      db.collection("password_reset_tokens").createIndex({ userId: 1, usedAt: 1, expiresAt: 1 }),
      db.collection("password_reset_tokens").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 7 * 86_400 }),
      db.collection("password_reset_rate_limits").createIndex({ key: 1, windowStart: 1 }, { unique: true }),
      db.collection("password_reset_rate_limits").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ]).then(() => undefined).catch((error) => {
      indexesPromise = null;
      throw error;
    });
  }
  return indexesPromise;
}

async function incrementRateKey(db: Db, key: string, now: Date) {
  const windowStart = new Date(Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS);
  const result = await db.collection("password_reset_rate_limits").findOneAndUpdate(
    { key, windowStart },
    {
      $inc: { count: 1 },
      $setOnInsert: { createdAt: now, expiresAt: new Date(windowStart.getTime() + 2 * WINDOW_MS) },
    },
    { upsert: true, returnDocument: "after" },
  );
  return Number(result?.count ?? 0);
}

export async function isPasswordResetRateLimited(db: Db, email: string, ip: string, now = new Date()) {
  await ensurePasswordResetIndexes(db);
  const emailKey = `email:${crypto.createHash("sha256").update(email).digest("hex")}`;
  const emailCountPromise = incrementRateKey(db, emailKey, now);
  if (!ip || ip === "unknown") return (await emailCountPromise) > MAX_ATTEMPTS;
  const ipKey = `ip:${crypto.createHash("sha256").update(ip).digest("hex")}`;
  const [emailCount, ipCount] = await Promise.all([
    emailCountPromise,
    incrementRateKey(db, ipKey, now),
  ]);
  return emailCount > MAX_ATTEMPTS || ipCount > MAX_ATTEMPTS;
}
