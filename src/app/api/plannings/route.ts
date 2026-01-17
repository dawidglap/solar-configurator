import { MongoClient } from "mongodb";
import crypto from "crypto";
import { defaultStoreData } from "@/components_v2/state/defaultStoreData"; // ✅ NEW

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

  if (!uri)
    return Response.json({ ok: false, error: "Missing MONGODB_URI" }, { status: 500 });
  if (!secret)
    return Response.json({ ok: false, error: "Missing SESSION_SECRET" }, { status: 500 });

  const session = readSession(req, secret);
  if (!session) return Response.json({ ok: false, error: "Not logged in" }, { status: 401 });

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

      // ✅ QUI LA DIFFERENZA: invece di {}, mettiamo la shape completa
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
    return Response.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  } finally {
    await client.close().catch(() => {});
  }
}
