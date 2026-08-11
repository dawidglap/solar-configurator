import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { enforceActiveSubscription } from "@/lib/subscription";
import { readSession, safeString, mongoIdToString } from "@/lib/api-session";
import {
  getCompanyMemberById,
  isAdminLikeRole,
  jsonResponse,
  noStoreHeaders,
} from "@/lib/tasks";
import { normalizeExecutionRoles } from "@/lib/executionTasks";
import {
  normalizeUserProfile,
  parseUserProfilePatch,
  UserProfileValidationError,
} from "@/lib/userProfiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = { params: Promise<{ userId: string }> };

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: noStoreHeaders(origin),
  });
}

function normalizeUser(doc: any, activeCompanyId: string) {
  const memberships = Array.isArray(doc?.memberships) ? doc.memberships : [];
  const membership = memberships.find((m: any) => {
    const companyId = mongoIdToString(m?.companyId);
    return companyId === activeCompanyId;
  });

  const firstName = safeString(doc?.firstName);
  const lastName = safeString(doc?.lastName);
  const fullName =
    [firstName, lastName].filter(Boolean).join(" ") ||
    safeString(doc?.name) ||
    safeString(doc?.email);

  return {
    id: mongoIdToString(doc?._id),
    firstName,
    lastName,
    name: fullName,
    email: safeString(doc?.email),
    workEmail: normalizeUserProfile(doc).workEmail,
    phone: normalizeUserProfile(doc).phone,
    jobTitle: normalizeUserProfile(doc).jobTitle,
    emailSignature: normalizeUserProfile(doc).emailSignature,
    role: safeString(membership?.role),
    executionRoles: normalizeExecutionRoles(doc?.executionRoles),
    status: safeString(membership?.status) || safeString(doc?.status) || "active",
    isPlatformSuperAdmin: !!doc?.isPlatformSuperAdmin,
    createdAt: doc?.createdAt ?? null,
    updatedAt: doc?.updatedAt ?? null,
  };
}

export async function GET(req: Request, { params }: Params) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return jsonResponse(origin, { ok: false, error: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }

  const { userId } = await params;
  if (!ObjectId.isValid(userId)) {
    return jsonResponse(origin, { ok: false, error: "Invalid userId" }, 400);
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;

    const user = await getCompanyMemberById(db, String(session.activeCompanyId), userId);
    if (!user) {
      return jsonResponse(origin, { ok: false, error: "User not found" }, 404);
    }

    const item = normalizeUser(user, String(session.activeCompanyId));
    return jsonResponse(origin, { ok: true, item, user: item }, 200);
  } catch (e: any) {
    console.error("GET USER ERROR:", e);
    return jsonResponse(origin, { ok: false, error: e?.message || "Unknown error" }, 500);
  }
}

export async function PATCH(req: Request, { params }: Params) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return jsonResponse(origin, { ok: false, error: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }
  const { userId } = await params;
  if (!ObjectId.isValid(userId)) {
    return jsonResponse(origin, { ok: false, error: "Invalid userId" }, 400);
  }

  const body = await req.json().catch(() => ({} as any));
  const isSelf = mongoIdToString(session.userId) === userId;
  const isAdmin = isAdminLikeRole(session);
  if (!isAdmin && !isSelf) {
    return jsonResponse(origin, { ok: false, error: "Forbidden" }, 403);
  }
  if (!isAdmin && body?.executionRoles !== undefined) {
    return jsonResponse(origin, { ok: false, error: "Forbidden" }, 403);
  }
  if (body?.executionRoles !== undefined && !Array.isArray(body.executionRoles)) {
    return jsonResponse(origin, { ok: false, error: "Invalid executionRoles" }, 400);
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;

    const currentUser = await getCompanyMemberById(db, String(session.activeCompanyId), userId);
    if (!currentUser) {
      return jsonResponse(origin, { ok: false, error: "User not found" }, 404);
    }

    let profilePatch: Record<string, string | null>;
    try {
      profilePatch = parseUserProfilePatch(body, { includeNames: true });
    } catch (error) {
      if (error instanceof UserProfileValidationError) {
        return jsonResponse(origin, { ok: false, message: error.message }, 400);
      }
      throw error;
    }
    const setPatch: Record<string, unknown> = { ...profilePatch, updatedAt: new Date() };
    if (body?.executionRoles !== undefined) {
      setPatch.executionRoles = normalizeExecutionRoles(body.executionRoles);
    }
    await db.collection("users").updateOne(
      { _id: new ObjectId(userId) },
      {
        $set: setPatch,
      },
    );

    const updatedUser = await getCompanyMemberById(db, String(session.activeCompanyId), userId);
    if (!updatedUser) {
      return jsonResponse(origin, { ok: false, error: "User not found after update" }, 404);
    }

    const item = normalizeUser(updatedUser, String(session.activeCompanyId));
    return jsonResponse(origin, { ok: true, item, user: item }, 200);
  } catch (e: any) {
    console.error("PATCH USER ERROR:", e);
    return jsonResponse(origin, { ok: false, error: e?.message || "Unknown error" }, 500);
  }
}
