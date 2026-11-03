import { ObjectId } from "mongodb";
import { getCorsHeaders } from "@/lib/cors";
import { getDb } from "@/lib/db";
import { readSession, safeString } from "@/lib/api-session";
import {
  buildCompanySubscriptionResponse,
  ensureCompanySubscriptionFields,
} from "@/lib/subscription";
import { hasCurrentSessionVersion, normalizeUserProfile } from "@/lib/userProfiles";
import { appendSetCookieHeaders, buildLogoutSessionCookies } from "@/lib/authCookies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonResponse(origin: string | null, body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...getCorsHeaders(origin),
    },
  });
}

function invalidSessionResponse(req: Request, origin: string | null, body: any) {
  const headers = appendSetCookieHeaders(
    new Headers({
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...getCorsHeaders(origin),
    }),
    buildLogoutSessionCookies(req),
  );
  return new Response(JSON.stringify(body), { status: 401, headers });
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

export async function GET(req: Request) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    return jsonResponse(origin, { ok: false, error: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.userId) {
    return invalidSessionResponse(req, origin, { ok: false, error: "Not logged in" });
  }

  let userObjectId: ObjectId;
  try {
    userObjectId = new ObjectId(String(session.userId));
  } catch {
    return invalidSessionResponse(req, origin, { ok: false, error: "Invalid session" });
  }

  try {
    const db = await getDb();
    const users = db.collection("users");
    const companies = db.collection("companies");

    const user: any = await users.findOne(
      { _id: userObjectId },
      {
        projection: {
          passwordHash: 0,
        },
      },
    );

    if (!user) {
      return invalidSessionResponse(req, origin, { ok: false, error: "User not found" });
    }
    if (!hasCurrentSessionVersion(user, session)) {
      return invalidSessionResponse(req, origin, { ok: false, message: "Sitzung ungültig. Bitte erneut anmelden." });
    }

    let activeCompany: any = null;

    if (session.activeCompanyId) {
      try {
        activeCompany = await companies.findOne(
          {
            _id: new ObjectId(String(session.activeCompanyId)),
            deletedAt: { $exists: false },
          },
          {
            projection: {
              name: 1,
              slug: 1,
              subscriptionStatus: 1,
              plan: 1,
              validUntil: 1,
              maxUsers: 1,
              notes: 1,
            },
          },
        );
        if (activeCompany) {
          activeCompany = await ensureCompanySubscriptionFields(db, activeCompany);
        }
      } catch {
        activeCompany = null;
      }
    }

    const companyPayload = activeCompany
      ? {
          id: activeCompany._id.toString(),
          name: safeString(activeCompany.name),
          slug: safeString(activeCompany.slug),
          subscription: buildCompanySubscriptionResponse(activeCompany),
        }
      : null;

    return jsonResponse(origin, {
      ok: true,
      user: {
        id: user._id.toString(),
        email: user.email,
        firstName: user.firstName ?? "",
        lastName: user.lastName ?? "",
        workEmail: normalizeUserProfile(user).workEmail,
        phone: normalizeUserProfile(user).phone,
        jobTitle: normalizeUserProfile(user).jobTitle,
        emailSignature: normalizeUserProfile(user).emailSignature,
        isPlatformSuperAdmin: !!user.isPlatformSuperAdmin,
        status: user.status ?? "active",
        mustChangePassword: !!user.mustChangePassword,
      },
      session: {
        activeCompanyId: session.activeCompanyId ?? null,
        activeRole: (session as any).activeRole ?? null,
        isPlatformSuperAdmin: !!(session as any).isPlatformSuperAdmin,
      },
      company: companyPayload,
      activeCompany: companyPayload
        ? {
            id: companyPayload.id,
            name: companyPayload.name,
            slug: companyPayload.slug,
            subscriptionStatus: companyPayload.subscription.status,
            plan: companyPayload.subscription.plan,
            subscription: companyPayload.subscription,
          }
        : null,
    });
  } catch (e: any) {
    console.error("ME ERROR:", e);
    return jsonResponse(origin, { ok: false, error: e?.message ?? "Unknown error" }, 500);
  }
}
