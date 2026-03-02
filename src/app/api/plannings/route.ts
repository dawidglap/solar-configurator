// src/app/api/plannings/route.ts
import { MongoClient } from "mongodb";
import crypto from "crypto";
import { defaultStoreData } from "@/components_v2/state/defaultStoreData";

export const runtime = "nodejs"; // mongodb + crypto + Buffer => Node runtime

function sign(payload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function getCookie(req: Request, name: string) {
  const cookie = req.headers.get("cookie") || "";
  const parts = cookie.split(";").map((p) => p.trim());
  const found = parts.find((p) => p.startsWith(name + "="));
  return found ? decodeURIComponent(found.split("=").slice(1).join("=")) : null;
}

function readSession(req: Request, secret: string) {
  const token = getCookie(req, "session");
  if (!token) return null;

  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  if (sign(payload, secret) !== sig) return null;

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  if (!uri) {
    return Response.json(
      { ok: false, error: "Missing MONGODB_URI" },
      { status: 500 }
    );
  }
  if (!secret) {
    return Response.json(
      { ok: false, error: "Missing SESSION_SECRET" },
      { status: 500 }
    );
  }

  const session = readSession(req, secret);
  if (!session) {
    return Response.json({ ok: false, error: "Not logged in" }, { status: 401 });
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

  try {
    await client.connect();
    const db = client.db();
    const plannings = db.collection("plannings");

    const now = new Date();

    const doc = {
      companyId: session.activeCompanyId,
      createdByUserId: session.userId,
      status: "draft",
      currentStep: "profile",

      // ✅ invece di {}, mettiamo la shape completa
      data: defaultStoreData(),

      createdAt: now,
      updatedAt: now,
    };

    const res = await plannings.insertOne(doc);

    return Response.json({
      ok: true,
      planningId: res.insertedId.toString(),
    });
  } catch (e: any) {
    console.error("CREATE PLANNING ERROR:", e);
    return Response.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  } finally {
    await client.close().catch(() => {});
  }
}

/**
 * ✅ NEW: list plannings for the currently logged-in company
 * Returns only lightweight fields (no full `data`).
 */
export async function GET(req: Request) {
  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  if (!uri) {
    return Response.json(
      { ok: false, error: "Missing MONGODB_URI" },
      { status: 500 }
    );
  }
  if (!secret) {
    return Response.json(
      { ok: false, error: "Missing SESSION_SECRET" },
      { status: 500 }
    );
  }

  const session = readSession(req, secret);
  if (!session) {
    return Response.json({ ok: false, error: "Not logged in" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? 200), 500);

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

  try {
    await client.connect();
    const db = client.db();
    const plannings = db.collection("plannings");

    const docs = await plannings
      .find(
        { companyId: session.activeCompanyId },
        {
          projection: {
            _id: 1,
            status: 1,
            currentStep: 1,
            createdAt: 1,
            updatedAt: 1,
            "data.profile.contactFirstName": 1,
            "data.profile.contactLastName": 1,
            "data.profile.businessName": 1,
          },
        }
      )
      .sort({ updatedAt: -1 })
      .limit(limit)
      .toArray();

    const items = docs.map((d: any) => ({
      id: String(d._id),
      status: d.status ?? "draft",
      currentStep: d.currentStep ?? null,
      createdAt: d.createdAt ?? null,
      updatedAt: d.updatedAt ?? null,
      firstName: d?.data?.profile?.contactFirstName ?? "",
      lastName: d?.data?.profile?.contactLastName ?? "",
      businessName: d?.data?.profile?.businessName ?? "",
    }));

    return Response.json({ ok: true, items });
  } catch (e: any) {
    console.error("LIST PLANNINGS ERROR:", e);
    return Response.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  } finally {
    await client.close().catch(() => {});
  }
}