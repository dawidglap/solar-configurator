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

export async function GET(req: Request) {
  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  if (!uri) return Response.json({ ok: false, error: "Missing MONGODB_URI" }, { status: 500 });
  if (!secret) return Response.json({ ok: false, error: "Missing SESSION_SECRET" }, { status: 500 });

  const token = getCookie(req, "session");
  if (!token) return Response.json({ ok: false, error: "Not logged in" }, { status: 401 });

  const [payload, sig] = token.split(".");
  if (!payload || !sig) return Response.json({ ok: false, error: "Invalid session" }, { status: 401 });

  const expected = sign(payload, secret);
  if (expected !== sig) return Response.json({ ok: false, error: "Invalid session" }, { status: 401 });

  let session: any;
  try {
    session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return Response.json({ ok: false, error: "Invalid session payload" }, { status: 401 });
  }

  const client = new MongoClient(uri);
  await client.connect();

  try {
    const db = client.db();
    const users = db.collection("users");

    const user = await users.findOne(
      { _id: new ObjectId(session.userId) },
      { projection: { passwordHash: 0 } }
    );

    if (!user) return Response.json({ ok: false, error: "User not found" }, { status: 401 });

    return Response.json({
      ok: true,
      user,
      activeCompanyId: session.activeCompanyId,
    });
  } finally {
    await client.close();
  }
}
