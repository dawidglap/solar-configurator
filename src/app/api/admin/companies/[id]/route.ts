import { ObjectId } from "mongodb";
import { getCorsHeaders } from "@/lib/cors";
import { getDb } from "@/lib/db";
import { mongoIdToString, readSession, safeString } from "@/lib/api-session";
import {
  buildActiveCompanyFilter,
  buildDeactivateUsersUpdate,
  buildMembershipCompanyQuery,
  buildCompanySubscriptionResponse,
  buildCompanyDeletePatch,
  countCompanyProjects,
  countCompanyUsers,
  enforceAdminRateLimit,
  hasStoredCompanySubscription,
  requirePlatformSuperAdmin,
} from "@/lib/subscription";

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

function normalizeCompanyUser(user: any, companyId: string) {
  const memberships = Array.isArray(user?.memberships) ? user.memberships : [];
  const membership = memberships.find((entry: any) => {
    const value = mongoIdToString(entry?.companyId);
    return value === companyId;
  });

  return {
    id: mongoIdToString(user?._id),
    email: safeString(user?.email),
    firstName: safeString(user?.firstName),
    lastName: safeString(user?.lastName),
    status: safeString(membership?.status) || safeString(user?.status) || "active",
    role: safeString(membership?.role),
    isDefault: !!membership?.isDefault,
    mustChangePassword: !!user?.mustChangePassword,
    createdAt:
      user?.createdAt instanceof Date ? user.createdAt.toISOString() : user?.createdAt ?? null,
  };
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) return jsonResponse(origin, { ok: false, message: "Missing SESSION_SECRET" }, 500);

  const session = readSession(req, secret);
  if (!session?.userId) return jsonResponse(origin, { ok: false, message: "Not logged in" }, 401);

  const forbidden = requirePlatformSuperAdmin(origin, session);
  if (forbidden) return forbidden;

  const rateLimit = await enforceAdminRateLimit(origin, session);
  if (rateLimit) return rateLimit;

  const { id } = await context.params;
  let companyObjectId: ObjectId;
  try {
    companyObjectId = new ObjectId(id);
  } catch {
    return jsonResponse(origin, { ok: false, message: "Invalid company id" }, 400);
  }

  try {
    const db = await getDb();
    const company = await db.collection("companies").findOne({
      _id: companyObjectId,
      ...buildActiveCompanyFilter(),
    });

    if (!company) {
      return jsonResponse(origin, { ok: false, message: "Company not found" }, 404);
    }

    const companyId = companyObjectId.toString();
    const users = await db
      .collection("users")
      .find(buildMembershipCompanyQuery(companyId))
      .sort({ createdAt: -1 })
      .toArray();
    const normalizedUsers = users.map((user) => normalizeCompanyUser(user, companyId));
    const owner = normalizedUsers.find((user) => user.role === "owner");
    const usersCount = await countCompanyUsers(db, companyId);
    const projectsCount = await countCompanyProjects(db, companyId);

    const companyPayload = {
      id: companyId,
      name: safeString(company?.name),
      slug: safeString(company?.slug),
      createdAt:
        company?.createdAt instanceof Date
          ? company.createdAt.toISOString()
          : company?.createdAt ?? null,
      deletedAt:
        company?.deletedAt instanceof Date
          ? company.deletedAt.toISOString()
          : company?.deletedAt ?? null,
      updatedAt:
        company?.updatedAt instanceof Date
          ? company.updatedAt.toISOString()
          : company?.updatedAt ?? null,
      ownerEmail: safeString(owner?.email) || null,
      ownerFirstName: safeString(owner?.firstName) || null,
      ownerLastName: safeString(owner?.lastName) || null,
      usersCount,
      projectsCount,
      subscription: hasStoredCompanySubscription(company)
        ? buildCompanySubscriptionResponse(company)
        : null,
    };

    return jsonResponse(origin, {
      ok: true,
      company: {
        ...companyPayload,
        users: normalizedUsers,
      },
      users: normalizedUsers,
      data: {
        company: {
          ...companyPayload,
          notes: safeString(company?.notes),
        },
        users: normalizedUsers,
      },
    });
  } catch (e: any) {
    console.error("ADMIN COMPANY DETAIL ERROR:", e);
    return jsonResponse(origin, { ok: false, message: e?.message || "Unknown error" }, 500);
  }
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) return jsonResponse(origin, { ok: false, message: "Missing SESSION_SECRET" }, 500);

  const session = readSession(req, secret);
  if (!session?.userId) return jsonResponse(origin, { ok: false, message: "Not logged in" }, 401);

  const forbidden = requirePlatformSuperAdmin(origin, session);
  if (forbidden) return forbidden;

  const rateLimit = await enforceAdminRateLimit(origin, session);
  if (rateLimit) return rateLimit;

  const { id } = await context.params;
  let companyObjectId: ObjectId;
  try {
    companyObjectId = new ObjectId(id);
  } catch {
    return jsonResponse(origin, { ok: false, message: "Invalid company id" }, 400);
  }

  try {
    const db = await getDb();
    const companies = db.collection("companies");
    const users = db.collection("users");
    const company = await companies.findOne({
      _id: companyObjectId,
      ...buildActiveCompanyFilter(),
    });

    if (!company) {
      return jsonResponse(origin, { ok: false, message: "Company not found" }, 404);
    }

    await companies.updateOne({ _id: companyObjectId }, { $set: buildCompanyDeletePatch() });
    const deactivate = buildDeactivateUsersUpdate(companyObjectId.toString());
    await users.updateMany(deactivate.filter, deactivate.update as any);

    return jsonResponse(origin, { ok: true });
  } catch (e: any) {
    console.error("ADMIN COMPANY DELETE ERROR:", e);
    return jsonResponse(origin, { ok: false, message: e?.message || "Unknown error" }, 500);
  }
}
