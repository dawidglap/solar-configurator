import bcrypt from "bcryptjs";
import { getCorsHeaders } from "@/lib/cors";
import { getDb } from "@/lib/db";
import { safeString } from "@/lib/api-session";
import { ensurePasswordResetIndexes, hashPasswordResetToken } from "@/lib/passwordReset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: getCorsHeaders(req.headers.get("origin")) });
}

function passwordResponse(origin: string | null, body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...getCorsHeaders(origin) },
  });
}

function invalid(origin: string | null) {
  return passwordResponse(
    origin,
    { ok: false, message: "Der Link ist ungültig oder abgelaufen." },
    400,
  );
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  try {
    const body = await req.json().catch(() => ({}));
    const token = safeString(body?.token);
    const password = typeof body?.password === "string" ? body.password : "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return invalid(origin);
    if (password.length < 8) {
      return passwordResponse(origin, { ok: false, message: "Das Passwort muss mindestens 8 Zeichen lang sein." }, 400);
    }

    const db = await getDb();
    await ensurePasswordResetIndexes(db);
    const now = new Date();
    const tokenHash = hashPasswordResetToken(token);
    const candidate = await db.collection("password_reset_tokens").findOne(
      { tokenHash, usedAt: null, expiresAt: { $gt: now } },
      { projection: { _id: 1 } },
    );
    if (!candidate) return invalid(origin);
    const passwordHash = await bcrypt.hash(password, 10);
    const claimed = await db.collection("password_reset_tokens").findOneAndUpdate(
      { tokenHash, usedAt: null, expiresAt: { $gt: now } },
      { $set: { usedAt: now } },
      { returnDocument: "after" },
    );
    if (!claimed?.userId) return invalid(origin);

    const result = await db.collection("users").updateOne(
      { _id: claimed.userId },
      {
        $set: {
          passwordHash,
          mustChangePassword: false,
          passwordChangedAt: now,
          updatedAt: now,
        },
        $inc: { sessionVersion: 1 },
      },
    );
    if (!result.matchedCount) return invalid(origin);
    await db.collection("password_reset_tokens").updateMany(
      { userId: claimed.userId, usedAt: null },
      { $set: { usedAt: now, invalidatedAt: now } },
    );
    return passwordResponse(origin, { ok: true });
  } catch (error: any) {
    console.error("PASSWORD RESET ERROR:", error);
    return invalid(origin);
  }
}
