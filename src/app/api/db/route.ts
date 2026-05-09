import { MongoClient } from "mongodb";
import { getCorsHeaders } from "@/lib/cors";

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

export async function GET(req: Request) {
  const origin = req.headers.get("origin");
  try {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      return Response.json(
        { ok: false, error: "Missing MONGODB_URI" },
        { status: 500, headers: getCorsHeaders(origin) }
      );
    }

    const client = new MongoClient(uri);
    await client.connect();

    await client.db("admin").command({ ping: 1 });

    await client.close();

    return Response.json({ ok: true, db: "connected" }, { headers: getCorsHeaders(origin) });
  } catch (e: any) {
    return Response.json(
      { ok: false, db: "error", message: e?.message ?? "Unknown error" },
      { status: 500, headers: getCorsHeaders(origin) }
    );
  }
}
