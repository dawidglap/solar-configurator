import bcrypt from "bcryptjs";
import { getCorsHeaders } from "@/lib/cors";
import { getDb } from "@/lib/db";
import { readSession, safeString } from "@/lib/api-session";
import {
  buildDefaultOwnerPassword,
  buildNewCompanySubscriptionDefaults,
  buildUniqueCompanySlug,
  countCompanyUsers,
  createCompanyBackfillMigration,
  enforceAdminRateLimit,
  ensureCompanySubscriptionIndexes,
  isValidCompanyPlan,
  normalizeAdminCompanyListItem,
  parseFutureDateInput,
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
  if (!secret) return jsonResponse(origin, { ok: false, message: "Missing SESSION_SECRET" }, 500);

  const session = readSession(req, secret);
  if (!session?.userId) return jsonResponse(origin, { ok: false, message: "Not logged in" }, 401);

  const forbidden = requirePlatformSuperAdmin(origin, session);
  if (forbidden) return forbidden;

  const rateLimit = await enforceAdminRateLimit(origin, session);
  if (rateLimit) return rateLimit;

  try {
    const db = await getDb();
    await ensureCompanySubscriptionIndexes(db);
    await createCompanyBackfillMigration(db);

    const companies = await db
      .collection("companies")
      .find({ deletedAt: { $exists: false } })
      .sort({ createdAt: -1 })
      .toArray();

    const data = await Promise.all(
      companies.map(async (company) =>
        normalizeAdminCompanyListItem(company, await countCompanyUsers(db, String(company._id))),
      ),
    );

    return jsonResponse(origin, { ok: true, data });
  } catch (e: any) {
    console.error("ADMIN COMPANIES GET ERROR:", e);
    return jsonResponse(origin, { ok: false, message: e?.message || "Unknown error" }, 500);
  }
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) return jsonResponse(origin, { ok: false, message: "Missing SESSION_SECRET" }, 500);

  const session = readSession(req, secret);
  if (!session?.userId) return jsonResponse(origin, { ok: false, message: "Not logged in" }, 401);

  const forbidden = requirePlatformSuperAdmin(origin, session);
  if (forbidden) return forbidden;

  const rateLimit = await enforceAdminRateLimit(origin, session);
  if (rateLimit) return rateLimit;

  const body = await req.json().catch(() => ({}));
  const name = safeString(body?.name);
  const ownerEmail = safeString(body?.ownerEmail).toLowerCase();
  const ownerFirstName = safeString(body?.ownerFirstName);
  const ownerLastName = safeString(body?.ownerLastName);
  const plan = body?.plan;
  const validUntil = parseFutureDateInput(body?.validUntil);
  const maxUsers = Number(body?.maxUsers);
  const notes = safeString(body?.notes);

  if (!name || !ownerEmail || !ownerFirstName || !ownerLastName) {
    return jsonResponse(origin, { ok: false, message: "Missing required fields" }, 400);
  }
  if (!isValidCompanyPlan(plan)) {
    return jsonResponse(origin, { ok: false, message: "Invalid plan" }, 400);
  }
  if (!validUntil || validUntil.getTime() <= Date.now()) {
    return jsonResponse(origin, { ok: false, message: "validUntil must be in the future" }, 400);
  }
  if (!Number.isFinite(maxUsers) || maxUsers < 1) {
    return jsonResponse(origin, { ok: false, message: "maxUsers must be >= 1" }, 400);
  }

  try {
    const db = await getDb();
    const companies = db.collection("companies");
    const users = db.collection("users");
    await ensureCompanySubscriptionIndexes(db);

    const existingUser = await users.findOne({ email: ownerEmail }, { projection: { _id: 1 } });
    if (existingUser) {
      return jsonResponse(origin, { ok: false, message: "Owner email already exists" }, 409);
    }

    const now = new Date();
    const slug = await buildUniqueCompanySlug(db, name);
    const companyDefaults = buildNewCompanySubscriptionDefaults(now);

    const companyDoc = {
      name,
      slug,
      plan,
      subscriptionStatus: "active" as const,
      validUntil,
      maxUsers: Math.floor(maxUsers),
      notes: notes || companyDefaults.notes,
      createdAt: now,
      updatedAt: now,
    };

    const companyRes = await companies.insertOne(companyDoc);

    const defaultPassword = buildDefaultOwnerPassword();
    const passwordHash = await bcrypt.hash(defaultPassword, 10);

    const ownerDoc = {
      email: ownerEmail,
      firstName: ownerFirstName,
      lastName: ownerLastName,
      passwordHash,
      mustChangePassword: true,
      isPlatformSuperAdmin: false,
      status: "active",
      memberships: [
        {
          companyId: companyRes.insertedId,
          role: "owner",
          status: "active",
          isDefault: true,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    const ownerRes = await users.insertOne(ownerDoc);

    return jsonResponse(origin, {
      ok: true,
      data: {
        company: normalizeAdminCompanyListItem(
          { _id: companyRes.insertedId, ...companyDoc },
          1,
        ),
        owner: {
          email: ownerEmail,
          defaultPassword,
          id: ownerRes.insertedId.toString(),
        },
      },
    });
  } catch (e: any) {
    console.error("ADMIN COMPANIES POST ERROR:", e);
    return jsonResponse(origin, { ok: false, message: e?.message || "Unknown error" }, 500);
  }
}
