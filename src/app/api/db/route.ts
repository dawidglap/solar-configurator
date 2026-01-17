import { MongoClient } from "mongodb";

export async function GET() {
  try {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      return Response.json({ ok: false, error: "Missing MONGODB_URI" }, { status: 500 });
    }

    const client = new MongoClient(uri);
    await client.connect();

    await client.db("admin").command({ ping: 1 });

    await client.close();

    return Response.json({ ok: true, db: "connected" });
  } catch (e: any) {
    return Response.json(
      { ok: false, db: "error", message: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
