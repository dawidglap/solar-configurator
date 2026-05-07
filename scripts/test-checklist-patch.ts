import "dotenv/config";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import { PATCH as patchChecklistItem } from "../src/app/api/plannings/[planningId]/checklist/[itemKey]/route";
import { CHECKLIST_ITEMS } from "../src/lib/checklistCatalog";

function sign(payload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function buildSessionCookie(session: Record<string, unknown>, secret: string) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `session=${payload}.${sign(payload, secret)}`;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  assert.ok(uri, "Missing MONGODB_URI");
  assert.ok(secret, "Missing SESSION_SECRET");

  const client = new MongoClient(uri);
  const planningId = new ObjectId();
  const companyId = `test-company-${Date.now()}`;
  const userId = `test-user-${Date.now()}`;

  try {
    await client.connect();
    const db = client.db();

    await db.collection("plannings").insertOne({
      _id: planningId,
      companyId,
      title: "Checklist Route Test",
      createdAt: new Date(),
      updatedAt: new Date(),
      commercial: {
        stage: "lead",
      },
    });

    const cookie = buildSessionCookie(
      {
        userId,
        id: userId,
        firstName: "Max",
        lastName: "Müller",
        name: "Max Müller",
        email: "max@example.com",
        activeCompanyId: companyId,
        role: "admin",
      },
      secret,
    );

    for (const item of CHECKLIST_ITEMS) {
      const req = new Request(
        `http://localhost/api/plannings/${planningId.toString()}/checklist/${item.key}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            cookie,
          },
          body: JSON.stringify({ done: true, note: `test:${item.key}` }),
        },
      );

      const res = await patchChecklistItem(req, {
        params: Promise.resolve({
          planningId: planningId.toString(),
          itemKey: item.key,
        }),
      });

      const json = await res.json();
      assert.equal(
        res.status,
        200,
        `PATCH failed for ${item.key}: ${JSON.stringify(json)}`,
      );
      assert.equal(json?.ok, true, `PATCH not ok for ${item.key}`);
      assert.equal(json?.event?.itemKey, item.key, `Wrong event key for ${item.key}`);
    }

    console.log(`Checklist PATCH regression test passed for ${CHECKLIST_ITEMS.length} item keys.`);
  } finally {
    await client.db().collection("plannings").deleteOne({ _id: planningId }).catch(() => {});
    await client.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error("test-checklist-patch failed:", error);
  process.exit(1);
});
