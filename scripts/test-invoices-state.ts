import "dotenv/config";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import { GET as getInvoicesList, POST as createInvoice } from "../src/app/api/invoices/route";
import { GET as getOrderInvoices } from "../src/app/api/orders/[orderId]/invoices/route";
import { GET as getInvoiceById, PATCH as patchInvoice } from "../src/app/api/invoices/[invoiceId]/route";
import { POST as runDunningCron } from "../src/app/api/cron/invoices-dunning/route";
import { getMongoClient } from "../src/lib/db";

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
  const cronSecret = process.env.CRON_SECRET || "test-cron-secret";

  assert.ok(uri, "Missing MONGODB_URI");
  assert.ok(secret, "Missing SESSION_SECRET");
  process.env.CRON_SECRET = cronSecret;

  const client = new MongoClient(uri);
  const companyId = new ObjectId().toString();
  const companyObjectId = new ObjectId(companyId);
  const planningId = new ObjectId();
  const customerId = new ObjectId().toString();
  const orderId = "AUF-2026-9999";
  const draftInvoiceId = new ObjectId();
  const sentInvoiceId = new ObjectId();
  const overdueInvoiceId = new ObjectId();
  const userId = new ObjectId().toString();
  const sessionCookie = buildSessionCookie(
    {
      userId,
      id: userId,
      firstName: "Invoice",
      lastName: "Tester",
      name: "Invoice Tester",
      email: "invoice.tester@example.com",
      activeCompanyId: companyId,
      role: "admin",
    },
    secret,
  );

  try {
    await client.connect();
    const db = client.db();
    await db.collection("companies").insertOne({
      _id: companyObjectId,
      name: "Invoices Test Company",
      billing: { iban: "CH9300762011623852957" },
      paymentDefaults: { currency: "CHF", dunningTermDays: 10, termDays: 30 },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.collection("plannings").insertOne({
      _id: planningId,
      companyId,
      customerId,
      title: "Invoice Test Planning",
      planningNumber: "ANG-TEST-1",
      orderId,
      orderStatus: "generated",
      summary: {
        customerName: "Invoice Test Kunde",
        moduleCount: 12,
        dcPowerKw: 5.4,
        roofCount: 1,
      },
      data: {
        profile: {
          firstName: "Invoice",
          lastName: "Kunde",
          salutation: "Herr",
        },
        parts: {
          items: [
            {
              category: "module",
              name: "PV-Modul",
              quantity: 10,
              unitPriceNet: 200,
            },
          ],
        },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const now = new Date();
    await db.collection("invoices").insertMany([
      {
        _id: draftInvoiceId,
        companyId,
        planningId: planningId.toString(),
        orderId,
        invoiceNumber: "RE-900001",
        invoiceType: "rechnung",
        parentInvoiceId: null,
        rateIndex: 0,
        position: 0,
        rateLabel: "Anzahlung",
        label: "Anzahlung",
        pct: 50,
        percentage: 50,
        amount: 1000,
        amountChf: 1000,
        currency: "CHF",
        discountPct: 0,
        discountChf: 0,
        skontoPct: 0,
        skontoChf: 0,
        skontoDays: 0,
        mwstIncluded: true,
        positionMenge: 1,
        positionEinheit: "Pauschal",
        positionPreis: 1000,
        issueDate: now,
        dueDate: now,
        status: "entwurf",
        paymentStatus: "offen",
        paidAt: null,
        paidAmount: 0,
        anrede: "Herr",
        bodyText: "Draft invoice",
        internalNote: "",
        pdfFileId: null,
        createdAt: now,
        updatedAt: now,
        createdByUserId: userId,
        createdByName: "Invoice Tester",
        createdByEmail: "invoice.tester@example.com",
        dunningEligible: false,
        dunningLevel: 0,
      },
      {
        _id: sentInvoiceId,
        companyId,
        planningId: planningId.toString(),
        orderId,
        invoiceNumber: "RE-900002",
        invoiceType: "rechnung",
        parentInvoiceId: null,
        rateIndex: 1,
        position: 1,
        rateLabel: "Schlussrechnung",
        label: "Schlussrechnung",
        pct: 50,
        percentage: 50,
        amount: 1200,
        amountChf: 1200,
        currency: "CHF",
        discountPct: 0,
        discountChf: 0,
        skontoPct: 0,
        skontoChf: 0,
        skontoDays: 0,
        mwstIncluded: true,
        positionMenge: 1,
        positionEinheit: "Pauschal",
        positionPreis: 1200,
        issueDate: now,
        dueDate: now,
        status: "versendet",
        paymentStatus: "offen",
        paidAt: null,
        paidAmount: 0,
        anrede: "Herr",
        bodyText: "Sent invoice",
        internalNote: "",
        pdfFileId: null,
        createdAt: now,
        updatedAt: now,
        createdByUserId: userId,
        createdByName: "Invoice Tester",
        createdByEmail: "invoice.tester@example.com",
        dunningEligible: false,
        dunningLevel: 0,
      },
      {
        _id: overdueInvoiceId,
        companyId,
        planningId: planningId.toString(),
        orderId,
        invoiceNumber: "RE-900003",
        invoiceType: "rechnung",
        parentInvoiceId: null,
        rateIndex: 2,
        position: 2,
        rateLabel: "Überfällig",
        label: "Überfällig",
        pct: 10,
        percentage: 10,
        amount: 300,
        amountChf: 300,
        currency: "CHF",
        discountPct: 0,
        discountChf: 0,
        skontoPct: 0,
        skontoChf: 0,
        skontoDays: 0,
        mwstIncluded: true,
        positionMenge: 1,
        positionEinheit: "Pauschal",
        positionPreis: 300,
        issueDate: new Date(now.getTime() - 8 * 86_400_000),
        dueDate: new Date(now.getTime() - 6 * 86_400_000),
        status: "versendet",
        paymentStatus: "offen",
        paidAt: null,
        paidAmount: 0,
        anrede: "Herr",
        bodyText: "Overdue invoice",
        internalNote: "",
        pdfFileId: null,
        createdAt: now,
        updatedAt: now,
        createdByUserId: userId,
        createdByName: "Invoice Tester",
        createdByEmail: "invoice.tester@example.com",
        dunningEligible: false,
        dunningLevel: 0,
      },
    ]);

    const draftPatchReq = new Request(`http://localhost/api/invoices/${draftInvoiceId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        cookie: sessionCookie,
      },
      body: JSON.stringify({
        rateLabel: "Neue Rate",
        bodyText: "Geaenderter Text",
        amount: 1500,
        discountPct: 5,
        discountChf: 75,
        skontoPct: 2,
        skontoChf: 30,
        skontoDays: 10,
        mwstIncluded: true,
        positionMenge: 3,
        positionEinheit: "Stk",
        positionPreis: 500,
        dueDate: "2026-07-30T00:00:00.000Z",
      }),
    });
    const draftPatchRes = await patchInvoice(draftPatchReq, {
      params: Promise.resolve({ invoiceId: draftInvoiceId.toString() }),
    });
    const draftPatchJson = await draftPatchRes.json();
    assert.equal(draftPatchRes.status, 200, `draft patch failed: ${JSON.stringify(draftPatchJson)}`);
    assert.equal(draftPatchJson?.invoice?.amount, 1500);
    assert.equal(draftPatchJson?.invoice?.discountPct, 5);
    assert.equal(draftPatchJson?.invoice?.positionEinheit, "Stk");

    const draftGetRes = await getInvoiceById(
      new Request(`http://localhost/api/invoices/${draftInvoiceId}`, {
        method: "GET",
        headers: { cookie: sessionCookie },
      }),
      { params: Promise.resolve({ invoiceId: draftInvoiceId.toString() }) },
    );
    const draftGetJson = await draftGetRes.json();
    assert.equal(draftGetRes.status, 200);
    assert.equal(draftGetJson?.invoice?.rateLabel, "Neue Rate");
    assert.equal(draftGetJson?.invoice?.skontoDays, 10);

    const sentLockedRes = await patchInvoice(
      new Request(`http://localhost/api/invoices/${sentInvoiceId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          cookie: sessionCookie,
        },
        body: JSON.stringify({ amount: 1400 }),
      }),
      { params: Promise.resolve({ invoiceId: sentInvoiceId.toString() }) },
    );
    const sentLockedJson = await sentLockedRes.json();
    assert.equal(sentLockedRes.status, 409, `sent lock failed: ${JSON.stringify(sentLockedJson)}`);
    assert.equal(sentLockedJson?.code, "INVOICE_LOCKED");

    const sentPaidRes = await patchInvoice(
      new Request(`http://localhost/api/invoices/${sentInvoiceId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          cookie: sessionCookie,
        },
        body: JSON.stringify({ paidAmount: 1200 }),
      }),
      { params: Promise.resolve({ invoiceId: sentInvoiceId.toString() }) },
    );
    const sentPaidJson = await sentPaidRes.json();
    assert.equal(sentPaidRes.status, 200, `sent paid failed: ${JSON.stringify(sentPaidJson)}`);
    assert.equal(sentPaidJson?.invoice?.paymentStatus, "bezahlt");
    assert.ok(sentPaidJson?.invoice?.paidAt);

    const cronRes = await runDunningCron(
      new Request("http://localhost/api/cron/invoices-dunning", {
        method: "POST",
        headers: {
          "x-cron-secret": cronSecret,
        },
      }),
    );
    const cronJson = await cronRes.json();
    assert.equal(cronRes.status, 200, `cron failed: ${JSON.stringify(cronJson)}`);

    const overdueAfterCron = await db.collection("invoices").findOne({ _id: overdueInvoiceId });
    assert.equal(overdueAfterCron?.dunningLevel, 1);
    assert.equal(overdueAfterCron?.status, "mahnung");
    const event = await db.collection("invoice_events").findOne({
      invoiceId: overdueInvoiceId,
      type: "dunning_level_up",
    });
    assert.ok(event, "missing dunning event");

    const manualInvoiceRes = await createInvoice(
      new Request("http://localhost/api/invoices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: sessionCookie,
        },
        body: JSON.stringify({
          orderId,
          invoiceType: "rechnung",
          parentInvoiceId: sentInvoiceId.toString(),
          amount: 450,
          rateLabel: "Pagamento residuo relativo a R1",
        }),
      }),
    );
    const manualInvoiceJson = await manualInvoiceRes.json();
    assert.equal(manualInvoiceRes.status, 200, `manual invoice failed: ${JSON.stringify(manualInvoiceJson)}`);
    assert.equal(manualInvoiceJson?.invoice?.invoiceNumber, `${orderId}-R4`);

    const orderInvoicesRes = await getOrderInvoices(
      new Request(`http://localhost/api/orders/${orderId}/invoices`, {
        method: "GET",
        headers: { cookie: sessionCookie },
      }),
      { params: Promise.resolve({ orderId }) },
    );
    const orderInvoicesJson = await orderInvoicesRes.json();
    assert.equal(orderInvoicesRes.status, 200);
    const draftFromOrder = (orderInvoicesJson?.items ?? []).find((item: any) => item.id === draftInvoiceId.toString());
    assert.equal(draftFromOrder?.discountPct, 5);
    assert.equal(draftFromOrder?.positionPreis, 500);

    const listRes = await getInvoicesList(
      new Request("http://localhost/api/invoices?type=rechnung", {
        method: "GET",
        headers: { cookie: sessionCookie },
      }),
    );
    const listJson = await listRes.json();
    assert.equal(listRes.status, 200, `invoice list failed: ${JSON.stringify(listJson)}`);
    const overdueFromList = (listJson?.items ?? []).find((item: any) => item.id === overdueInvoiceId.toString());
    assert.equal(overdueFromList?.dunningLevel, 1);
    assert.ok((overdueFromList?.daysOverdue ?? 0) >= 5);

    console.log("Invoices state test passed.");
  } finally {
    await client.db().collection("invoice_events").deleteMany({ companyId }).catch(() => {});
    await client.db().collection("invoices").deleteMany({ companyId }).catch(() => {});
    await client.db().collection("plannings").deleteMany({ _id: planningId }).catch(() => {});
    await client.db().collection("companies").deleteOne({ _id: companyObjectId }).catch(() => {});
    await getMongoClient().then((sharedClient) => sharedClient.close()).catch(() => {});
    await client.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error("test-invoices-state failed:", error);
  process.exit(1);
});
