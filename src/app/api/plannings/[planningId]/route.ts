// src/app/api/plannings/[planningId]/route.ts
import { MongoClient, ObjectId } from "mongodb";
import crypto from "crypto";

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

export async function PATCH(req: Request, ctx: { params: { planningId: string } }) {
  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  if (!uri)
    return Response.json({ ok: false, error: "Missing MONGODB_URI" }, { status: 500 });
  if (!secret)
    return Response.json({ ok: false, error: "Missing SESSION_SECRET" }, { status: 500 });

  const session = readSession(req, secret);
  if (!session) return Response.json({ ok: false, error: "Not logged in" }, { status: 401 });

  const planningId = ctx?.params?.planningId;
  if (!planningId) {
    return Response.json(
      { ok: false, error: "Route params missing. Check folder name is [planningId]." },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const profile = body.profile;
  const ist = body.ist;
  const planner = body.planner;

  if (
    (!profile || typeof profile !== "object") &&
    (!ist || typeof ist !== "object") &&
    (!planner || typeof planner !== "object")
  ) {
    return Response.json(
      { ok: false, error: "Send { profile }, { ist } or { planner }" },
      { status: 400 }
    );
  }

  const setObj: any = { updatedAt: new Date() };

  // dopo Profil si passa a IST
  if (profile) {
    setObj["data.profile"] = profile;
    setObj.currentStep = "ist";
  }

  // dopo IST si passa a Building (mappa)
  if (ist) {
    setObj["data.ist"] = ist;
    setObj.currentStep = "building";
  }

  // dopo planner (roof + moduli) si passa a offer/review
  if (planner) {
    setObj["data.planner"] = planner;
    setObj.currentStep = "offer";
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

  try {
    await client.connect();
    const db = client.db();
    const plannings = db.collection("plannings");

    const res = await plannings.updateOne(
      { _id: new ObjectId(planningId), companyId: session.activeCompanyId },
      { $set: setObj }
    );

    if (res.matchedCount === 0) {
      return Response.json({ ok: false, error: "Planning not found" }, { status: 404 });
    }

    return Response.json({ ok: true });
  } catch (e: any) {
    console.error("UPDATE PLANNING ERROR:", e);
    return Response.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  } finally {
    await client.close().catch(() => {});
  }
}

export async function GET(req: Request, ctx: { params: { planningId: string } }) {
  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  if (!uri)
    return Response.json({ ok: false, error: "Missing MONGODB_URI" }, { status: 500 });
  if (!secret)
    return Response.json({ ok: false, error: "Missing SESSION_SECRET" }, { status: 500 });

  const session = readSession(req, secret);
  if (!session) return Response.json({ ok: false, error: "Not logged in" }, { status: 401 });

  const planningId = ctx?.params?.planningId;
  if (!planningId) {
    return Response.json(
      { ok: false, error: "Route params missing. Check folder name is [planningId]." },
      { status: 500 }
    );
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

  try {
    await client.connect();
    const db = client.db();
    const plannings = db.collection("plannings");

    const doc = await plannings.findOne({
      _id: new ObjectId(planningId),
      companyId: session.activeCompanyId,
    });

    if (!doc) return Response.json({ ok: false, error: "Planning not found" }, { status: 404 });

    return Response.json({ ok: true, planning: doc });
  } catch (e: any) {
    console.error("GET PLANNING ERROR:", e);
    return Response.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  } finally {
    await client.close().catch(() => {});
  }
}
