import { getDb } from "@/lib/db";
import bcrypt from "bcryptjs";
import { getCorsHeaders } from "@/lib/cors";
import { buildNewCompanySubscriptionDefaults, buildUniqueCompanySlug } from "@/lib/subscription";

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (!process.env.MONGODB_URI) {
    return Response.json(
      { ok: false, error: "Missing MONGODB_URI" },
      { status: 500, headers: getCorsHeaders(origin) }
    );
  }

  // ⚠️ Cambia questi 3 valori come vuoi (per test)
  const COMPANY_NAME = "Demo Company";
  const OWNER_EMAIL = "owner@demo.com";
  const OWNER_PASSWORD = "Demo12345";

  try {
    const db = await getDb();

    const companies = db.collection("companies");
    const users = db.collection("users");

    // Evita di creare due volte lo stesso owner
    const existing = await users.findOne({ email: OWNER_EMAIL });
    if (existing) {
      return Response.json({
        ok: false,
        error: "Owner already exists",
        email: OWNER_EMAIL,
      }, { status: 400, headers: getCorsHeaders(origin) });
    }

    const now = new Date();
    const subscriptionDefaults = buildNewCompanySubscriptionDefaults(now);
    const companyRes = await companies.insertOne({
      name: COMPANY_NAME,
      slug: await buildUniqueCompanySlug(db, COMPANY_NAME),
      ...subscriptionDefaults,
      createdAt: now,
      updatedAt: now,
    });

    const passwordHash = await bcrypt.hash(OWNER_PASSWORD, 10);

    const userRes = await users.insertOne({
      email: OWNER_EMAIL,
      passwordHash,
      mustChangePassword: false,
      status: "active",
      memberships: [
        { companyId: companyRes.insertedId, role: "owner", status: "active", isDefault: true },
      ],
      createdAt: now,
      updatedAt: now,
    });

    return Response.json({
      ok: true,
      companyId: companyRes.insertedId.toString(),
      ownerUserId: userRes.insertedId.toString(),
      ownerEmail: OWNER_EMAIL,
      ownerPassword: OWNER_PASSWORD, // solo per test; dopo lo togliamo
    }, { headers: getCorsHeaders(origin) });
  } catch (e: any) {
    return Response.json(
      { ok: false, message: e?.message ?? "Unknown error" },
      { status: 500, headers: getCorsHeaders(origin) }
    );
  }
}
