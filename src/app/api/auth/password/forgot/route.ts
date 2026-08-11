import { ObjectId } from "mongodb";
import { getCorsHeaders } from "@/lib/cors";
import { getDb } from "@/lib/db";
import { safeString } from "@/lib/api-session";
import {
  createPasswordResetToken,
  ensurePasswordResetIndexes,
  extractRequestIp,
  hashPasswordResetToken,
  isPasswordResetRateLimited,
  validatePasswordResetRedirect,
} from "@/lib/passwordReset";
import { USER_EMAIL_PATTERN } from "@/lib/userProfiles";

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

function companyIdFromUser(user: any) {
  const memberships = Array.isArray(user?.memberships) ? user.memberships : [];
  const membership = memberships.find((item: any) => item?.status === "active" && item?.isDefault) ||
    memberships.find((item: any) => item?.status === "active") || memberships[0];
  const value = membership?.companyId;
  return ObjectId.isValid(String(value ?? "")) ? new ObjectId(String(value)) : null;
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const generic = () => passwordResponse(origin, { ok: true });
  try {
    const body = await req.json().catch(() => ({}));
    const email = safeString(body?.email).toLowerCase();
    const redirect = validatePasswordResetRedirect(body?.redirectBase);
    if (!redirect) {
      return passwordResponse(origin, { ok: false, message: "Ungültige Weiterleitungs-URL." }, 400);
    }
    const db = await getDb();
    const ip = extractRequestIp(req);
    if (await isPasswordResetRateLimited(db, email || "invalid", ip)) return generic();
    if (!USER_EMAIL_PATTERN.test(email)) return generic();

    const user = await db.collection("users").findOne({ email });
    if (!user) return generic();

    await ensurePasswordResetIndexes(db);
    const now = new Date();
    await db.collection("password_reset_tokens").updateMany(
      { userId: user._id, usedAt: null, expiresAt: { $gt: now } },
      { $set: { usedAt: now, invalidatedAt: now } },
    );
    const token = createPasswordResetToken();
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);
    await db.collection("password_reset_tokens").insertOne({
      userId: user._id,
      tokenHash: hashPasswordResetToken(token),
      expiresAt,
      usedAt: null,
      createdAt: now,
      ip,
    });

    redirect.searchParams.set("token", token);
    const companyId = companyIdFromUser(user);
    const company = companyId
      ? await db.collection("companies").findOne({ _id: companyId })
      : null;
    return passwordResponse(origin, {
      ok: true,
      resetLink: redirect.toString(),
      email: safeString(user.email).toLowerCase(),
      firstName: safeString(user.firstName),
      expiresInMinutes: 60,
      company: {
        name: safeString(company?.name),
        email: safeString(company?.contact?.email) || safeString(company?.email),
        phone: safeString(company?.contact?.phone) || safeString(company?.phone),
      },
    });
  } catch (error: any) {
    console.error("PASSWORD FORGOT ERROR:", error);
    return generic();
  }
}
