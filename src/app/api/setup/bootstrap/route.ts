import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";

export async function POST() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    return Response.json({ ok: false, error: "Missing MONGODB_URI" }, { status: 500 });
  }

  // ⚠️ Cambia questi 3 valori come vuoi (per test)
  const COMPANY_NAME = "Demo Company";
  const OWNER_EMAIL = "owner@demo.com";
  const OWNER_PASSWORD = "Demo12345";

  const client = new MongoClient(uri);
  await client.connect();

  try {
    const db = client.db(); // userà il DB dal connection string (/sola)

    const companies = db.collection("companies");
    const users = db.collection("users");

    // Evita di creare due volte lo stesso owner
    const existing = await users.findOne({ email: OWNER_EMAIL });
    if (existing) {
      return Response.json({
        ok: false,
        error: "Owner already exists",
        email: OWNER_EMAIL,
      }, { status: 400 });
    }

    const companyRes = await companies.insertOne({
      name: COMPANY_NAME,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const passwordHash = await bcrypt.hash(OWNER_PASSWORD, 10);

    const userRes = await users.insertOne({
      email: OWNER_EMAIL,
      passwordHash,
      memberships: [
        { companyId: companyRes.insertedId, role: "owner", status: "active" },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return Response.json({
      ok: true,
      companyId: companyRes.insertedId.toString(),
      ownerUserId: userRes.insertedId.toString(),
      ownerEmail: OWNER_EMAIL,
      ownerPassword: OWNER_PASSWORD, // solo per test; dopo lo togliamo
    });
  } catch (e: any) {
    return Response.json(
      { ok: false, message: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  } finally {
    await client.close();
  }
}
