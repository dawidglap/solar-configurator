import "dotenv/config";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import { POST as generateOrder } from "../src/app/api/plannings/[planningId]/generate-order/route";
import { getMongoClient } from "../src/lib/db";

function sign(payload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function buildSessionCookie(session: Record<string, unknown>, secret: string) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `session=${payload}.${sign(payload, secret)}`;
}

function buildPlanningDoc(args: { companyId: string; planningId: ObjectId; withPayments: boolean }) {
  return {
    _id: args.planningId,
    companyId: args.companyId,
    title: "Generate Order Test",
    planningNumber: `ANG-TEST-${Date.now()}`,
    commercial: {
      stage: "offer",
      valueChf: 12000,
    },
    summary: {
      customerName: "Test Kunde",
      moduleCount: 20,
      selectedPanelId: "",
      dcPowerKw: 8.2,
      roofCount: 1,
      hasSnapshot: false,
      lastCalculatedAt: null,
    },
    data: {
      profile: {
        firstName: "Test",
        lastName: "Kunde",
        email: "test@example.com",
        phone: "+41 79 000 00 00",
      },
      parts: {
        items: [
          {
            category: "module",
            name: "PV-Modul",
            quantity: 20,
            unitPriceNet: 500,
          },
        ],
        reportSections: {
          projektuebersicht: true,
          technischeEckdaten: true,
          analyse: true,
        },
      },
      angebot: {
        payments: args.withPayments
          ? [{ pct: 100, label: "Schlussrechnung" }]
          : [],
      },
      reportOptions: {
        mwstIncluded: true,
      },
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function callGenerateOrder(args: {
  planningId: string;
  companyId: string;
  secret: string;
}) {
  const cookie = buildSessionCookie(
    {
      userId: new ObjectId().toString(),
      id: new ObjectId().toString(),
      firstName: "Test",
      lastName: "Admin",
      name: "Test Admin",
      email: "admin@example.com",
      activeCompanyId: args.companyId,
      role: "admin",
    },
    args.secret,
  );

  const req = new Request(`http://localhost/api/plannings/${args.planningId}/generate-order`, {
    method: "POST",
    headers: {
      cookie,
    },
  });
  const res = await generateOrder(req, {
    params: Promise.resolve({
      planningId: args.planningId,
    }),
  });

  return {
    status: res.status,
    json: await res.json(),
  };
}

async function main() {
  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  assert.ok(uri, "Missing MONGODB_URI");
  assert.ok(secret, "Missing SESSION_SECRET");

  process.env.CLOUDINARY_CLOUD_NAME = "";
  process.env.CLOUDINARY_API_KEY = "";
  process.env.CLOUDINARY_API_SECRET = "";

  const client = new MongoClient(uri);
  const companyId = new ObjectId().toString();
  const happyPlanningId = new ObjectId();
  const missingIbanCompanyId = new ObjectId().toString();
  const missingIbanPlanningId = new ObjectId();
  const missingPaymentsCompanyId = new ObjectId().toString();
  const missingPaymentsPlanningId = new ObjectId();

  try {
    await client.connect();
    const db = client.db();

    await db.collection("companies").insertMany([
      {
        _id: new ObjectId(companyId),
        name: "Generate Order Happy Path Co",
        billing: {
          iban: "CH9300762011623852957",
        },
        pipelineStages: [
          { key: "offer", label: "Offer", order: 0, type: "open", color: "hsl(200 70% 50%)" },
          { key: "won", label: "Won", order: 1, type: "won", color: "hsl(160 60% 45%)" },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        _id: new ObjectId(missingIbanCompanyId),
        name: "Generate Order Missing IBAN Co",
        pipelineStages: [
          { key: "offer", label: "Offer", order: 0, type: "open", color: "hsl(200 70% 50%)" },
          { key: "won", label: "Won", order: 1, type: "won", color: "hsl(160 60% 45%)" },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        _id: new ObjectId(missingPaymentsCompanyId),
        name: "Generate Order Missing Payments Co",
        billing: {
          iban: "CH9300762011623852957",
        },
        pipelineStages: [
          { key: "offer", label: "Offer", order: 0, type: "open", color: "hsl(200 70% 50%)" },
          { key: "won", label: "Won", order: 1, type: "won", color: "hsl(160 60% 45%)" },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    await db.collection("plannings").insertMany([
      buildPlanningDoc({ companyId, planningId: happyPlanningId, withPayments: true }),
      buildPlanningDoc({
        companyId: missingIbanCompanyId,
        planningId: missingIbanPlanningId,
        withPayments: true,
      }),
      buildPlanningDoc({
        companyId: missingPaymentsCompanyId,
        planningId: missingPaymentsPlanningId,
        withPayments: false,
      }),
    ]);

    const happy = await callGenerateOrder({
      planningId: happyPlanningId.toString(),
      companyId,
      secret,
    });
    assert.equal(happy.status, 200, `happy-path failed: ${JSON.stringify(happy.json)}`);
    assert.equal(happy.json?.ok, true);
    assert.equal(typeof happy.json?.orderId, "string");
    assert.equal(happy.json?.order?.currentStepKey, "gewonnen");
    assert.ok(Array.isArray(happy.json?.stepsState));

    const happyRepeat = await callGenerateOrder({
      planningId: happyPlanningId.toString(),
      companyId,
      secret,
    });
    assert.equal(happyRepeat.status, 409, `repeat failed: ${JSON.stringify(happyRepeat.json)}`);
    assert.equal(happyRepeat.json?.ok, true);
    assert.equal(happyRepeat.json?.alreadyGenerated, true);
    assert.equal(happyRepeat.json?.orderId, happy.json?.orderId);

    const missingIban = await callGenerateOrder({
      planningId: missingIbanPlanningId.toString(),
      companyId: missingIbanCompanyId,
      secret,
    });
    assert.equal(missingIban.status, 400, `missing-iban failed: ${JSON.stringify(missingIban.json)}`);
    assert.equal(missingIban.json?.ok, false);
    assert.equal(missingIban.json?.code, "COMPANY_IBAN_MISSING");

    const missingPayments = await callGenerateOrder({
      planningId: missingPaymentsPlanningId.toString(),
      companyId: missingPaymentsCompanyId,
      secret,
    });
    assert.equal(
      missingPayments.status,
      400,
      `missing-payments failed: ${JSON.stringify(missingPayments.json)}`,
    );
    assert.equal(missingPayments.json?.ok, false);
    assert.equal(missingPayments.json?.code, "NO_INVOICE_RATES");

    console.log("Generate order route test passed.");
  } finally {
    await client.db().collection("executionTasks").deleteMany({
      companyId: { $in: [companyId, missingIbanCompanyId, missingPaymentsCompanyId] },
    }).catch(() => {});
    await client.db().collection("auftrag_steps_state").deleteMany({
      companyId: { $in: [new ObjectId(companyId), new ObjectId(missingIbanCompanyId), new ObjectId(missingPaymentsCompanyId)] },
    }).catch(() => {});
    await client.db().collection("auftraege").deleteMany({
      companyId: { $in: [new ObjectId(companyId), new ObjectId(missingIbanCompanyId), new ObjectId(missingPaymentsCompanyId)] },
    }).catch(() => {});
    await client.db().collection("auftrag_pipeline_templates").deleteMany({
      companyId: { $in: [new ObjectId(companyId), new ObjectId(missingIbanCompanyId), new ObjectId(missingPaymentsCompanyId)] },
    }).catch(() => {});
    await client.db().collection("invoices").deleteMany({
      companyId: { $in: [companyId, missingIbanCompanyId, missingPaymentsCompanyId] },
    }).catch(() => {});
    await client.db().collection("plannings").deleteMany({
      _id: { $in: [happyPlanningId, missingIbanPlanningId, missingPaymentsPlanningId] },
    }).catch(() => {});
    await client.db().collection("companies").deleteMany({
      _id: { $in: [new ObjectId(companyId), new ObjectId(missingIbanCompanyId), new ObjectId(missingPaymentsCompanyId)] },
    }).catch(() => {});
    await getMongoClient().then((sharedClient) => sharedClient.close()).catch(() => {});
    await client.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error("test-generate-order failed:", error);
  process.exit(1);
});
