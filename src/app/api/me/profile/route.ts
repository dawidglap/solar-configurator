import { ObjectId } from "mongodb";
import { readSession, jsonResponse } from "@/lib/api-session";
import { getCorsHeaders } from "@/lib/cors";
import { getDb } from "@/lib/db";
import {
  hasCurrentSessionVersion,
  normalizeUserProfile,
  parseUserProfilePatch,
  UserProfileValidationError,
} from "@/lib/userProfiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: getCorsHeaders(req.headers.get("origin")) });
}

async function getAuthenticatedUser(req: Request) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return { error: "Missing SESSION_SECRET", status: 500 } as const;
  const session = readSession(req, secret);
  if (!session?.userId || !ObjectId.isValid(String(session.userId))) {
    return { error: "Nicht angemeldet.", status: 401 } as const;
  }
  const db = await getDb();
  const user = await db.collection("users").findOne({ _id: new ObjectId(String(session.userId)) });
  if (!user || !hasCurrentSessionVersion(user, session)) {
    return { error: "Sitzung ungültig. Bitte erneut anmelden.", status: 401 } as const;
  }
  return { db, user } as const;
}

export async function GET(req: Request) {
  const origin = req.headers.get("origin");
  try {
    const auth = await getAuthenticatedUser(req);
    if ("error" in auth) return jsonResponse(origin, { ok: false, message: auth.error }, auth.status);
    return jsonResponse(origin, { ok: true, profile: normalizeUserProfile(auth.user) });
  } catch (error: any) {
    console.error("GET ME PROFILE ERROR:", error);
    return jsonResponse(origin, { ok: false, message: "Profil konnte nicht geladen werden." }, 500);
  }
}

export async function PATCH(req: Request) {
  const origin = req.headers.get("origin");
  try {
    const auth = await getAuthenticatedUser(req);
    if ("error" in auth) return jsonResponse(origin, { ok: false, message: auth.error }, auth.status);

    const body = await req.json().catch(() => ({}));
    let patch: Record<string, string | null>;
    try {
      patch = parseUserProfilePatch(body, { includeNames: true });
    } catch (error) {
      if (error instanceof UserProfileValidationError) {
        return jsonResponse(origin, { ok: false, message: error.message }, 400);
      }
      throw error;
    }
    await auth.db.collection("users").updateOne(
      { _id: auth.user._id },
      { $set: { ...patch, updatedAt: new Date() } },
    );
    const updated = { ...auth.user, ...patch };
    return jsonResponse(origin, { ok: true, profile: normalizeUserProfile(updated) });
  } catch (error: any) {
    console.error("PATCH ME PROFILE ERROR:", error);
    return jsonResponse(origin, { ok: false, message: "Profil konnte nicht gespeichert werden." }, 500);
  }
}
