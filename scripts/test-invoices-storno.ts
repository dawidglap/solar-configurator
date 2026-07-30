import "dotenv/config";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { MongoClient, ObjectId } from "mongodb";
import { PATCH as patchInvoice } from "../src/app/api/invoices/[invoiceId]/route";
import { POST as createMahnung } from "../src/app/api/invoices/[invoiceId]/mahnung/route";
import { POST as renderInvoicePdf } from "../src/app/api/invoices/[invoiceId]/pdf/route";
import { GET as getOrders } from "../src/app/api/orders/route";

function sign(payload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function buildSessionCookie(session: Record<string, unknown>, secret: string) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `session=${payload}.${sign(payload, secret)}`;
}

function pdfContainsText(pdfBytes: Buffer, needle: string) {
  const needleBuffer = Buffer.from(needle, "latin1");
  const needleHex = needleBuffer.toString("hex").toUpperCase();
  if (pdfBytes.includes(needleBuffer)) return true;

  let cursor = 0;
  while (cursor < pdfBytes.length) {
    const streamIndex = pdfBytes.indexOf(Buffer.from("stream"), cursor);
    if (streamIndex === -1) break;

    let dataStart = streamIndex + "stream".length;
    if (pdfBytes[dataStart] === 0x0d && pdfBytes[dataStart + 1] === 0x0a) {
      dataStart += 2;
    } else if (pdfBytes[dataStart] === 0x0a || pdfBytes[dataStart] === 0x0d) {
      dataStart += 1;
    }

    const endStreamIndex = pdfBytes.indexOf(Buffer.from("endstream"), dataStart);
    if (endStreamIndex === -1) break;

    let dataEnd = endStreamIndex;
    while (
      dataEnd > dataStart &&
      (pdfBytes[dataEnd - 1] === 0x0a || pdfBytes[dataEnd - 1] === 0x0d)
    ) {
      dataEnd -= 1;
    }

    const streamData = pdfBytes.subarray(dataStart, dataEnd);
    const dictSnippet = pdfBytes
      .subarray(Math.max(0, streamIndex - 400), streamIndex)
      .toString("latin1");
    const candidates = [streamData];

    if (dictSnippet.includes("/FlateDecode")) {
      try {
        candidates.push(zlib.inflateSync(streamData));
      } catch {}
    }

    for (const candidate of candidates) {
      if (candidate.includes(needleBuffer)) return true;
      const candidateText = candidate.toString("latin1").toUpperCase();
      if (candidateText.includes(needleHex)) return true;
    }

    cursor = endStreamIndex + "endstream".length;
  }

  return false;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  assert.ok(uri, "Missing MONGODB_URI");
  assert.ok(secret, "Missing SESSION_SECRET");

  const client = new MongoClient(uri);
  const companyId = new ObjectId().toString();
  const companyObjectId = new ObjectId(companyId);
  const planningId = new ObjectId();
  const userId = new ObjectId().toString();
  const orderId = "AUF-2026-STORNO";
  const invoiceId = new ObjectId();
  const mahnungId = new ObjectId();
  const sessionCookie = buildSessionCookie(
    {
      userId,
      id: userId,
      firstName: "Storno",
      lastName: "Tester",
      name: "Storno Tester",
      email: "storno.tester@example.com",
      activeCompanyId: companyId,
      role: "admin",
    },
    secret,
  );

  try {
    await client.connect();
    const db = client.db();
    const now = new Date();

    await db.collection("companies").insertOne({
      _id: companyObjectId,
      name: "Storno Test Company",
      billing: { iban: "CH9300762011623852957" },
      paymentDefaults: { currency: "CHF", termDays: 30, dunningTermDays: 10 },
      createdAt: now,
      updatedAt: now,
    });

    await db.collection("plannings").insertOne({
      _id: planningId,
      companyId,
      title: "Storno Test Planning",
      planningNumber: "ANG-STORNO-1",
      orderId,
      orderStatus: "generated",
      customerId: new ObjectId().toString(),
      summary: { customerName: "Storno Kunde" },
      data: {
        profile: {
          firstName: "Storno",
          lastName: "Kunde",
          salutation: "Herr",
          street: "Bahnhofstrasse 1",
          zip: "8000",
          city: "Zürich",
        },
        angebot: {
          payments: [{ label: "Schlussrechnung", pct: 100 }],
        },
      },
      createdAt: now,
      updatedAt: now,
    });

    await db.collection("invoices").insertMany([
      {
        _id: invoiceId,
        companyId,
        planningId: planningId.toString(),
        orderId,
        invoiceNumber: "RE-930001",
        invoiceType: "rechnung",
        parentInvoiceId: null,
        rateIndex: 0,
        position: 0,
        rateLabel: "Schlussrechnung",
        label: "Schlussrechnung",
        pct: 100,
        percentage: 100,
        amount: 1500,
        amountChf: 1500,
        currency: "CHF",
        discountPct: 0,
        discountChf: 0,
        skontoPct: 0,
        skontoChf: 0,
        skontoDays: 0,
        mwstIncluded: true,
        positionMenge: 1,
        positionEinheit: "Pauschal",
        positionPreis: 1500,
        issueDate: now,
        dueDate: now,
        status: "versendet",
        paymentStatus: "offen",
        paidAt: null,
        paidAmount: 0,
        anrede: "Herr",
        bodyText: "Bitte bezahlen Sie die Rechnung.",
        internalNote: "",
        pdfFileId: null,
        createdAt: now,
        updatedAt: now,
        dunningEligible: true,
        dunningLevel: 1,
      },
      {
        _id: mahnungId,
        companyId,
        planningId: planningId.toString(),
        orderId,
        invoiceNumber: "RE-930002",
        invoiceType: "mahnung",
        parentInvoiceId: invoiceId,
        rateIndex: 0,
        position: 0,
        rateLabel: "Mahnung",
        label: "Mahnung",
        pct: 100,
        percentage: 100,
        amount: 1500,
        amountChf: 1500,
        currency: "CHF",
        issueDate: now,
        dueDate: now,
        status: "mahnung",
        paymentStatus: "offen",
        paidAt: null,
        paidAmount: 0,
        anrede: "Herr",
        bodyText: "Mahnung offen.",
        internalNote: "",
        pdfFileId: null,
        createdAt: now,
        updatedAt: now,
        dunningEligible: false,
        dunningLevel: 1,
      },
    ]);

    const stornoRes = await patchInvoice(
      new Request(`http://localhost/api/invoices/${invoiceId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          cookie: sessionCookie,
        },
        body: JSON.stringify({ status: "storniert" }),
      }),
      { params: Promise.resolve({ invoiceId: invoiceId.toString() }) },
    );
    assert.equal(stornoRes.status, 200);
    const stornoJson = await stornoRes.json();
    assert.equal(stornoJson.invoice.status, "storniert");
    assert.equal(stornoJson.invoice.dunningLevel, 0);
    assert.ok(stornoJson.invoice.cancelledAt);
    assert.equal(stornoJson.invoice.cancelledByName, "Storno Tester");

    const childMahnung = await db.collection("invoices").findOne({ _id: mahnungId });
    assert.equal(childMahnung?.status, "storniert");
    assert.equal(childMahnung?.dunningLevel, 0);
    assert.ok(childMahnung?.cancelledAt);

    const ordersRes = await getOrders(
      new Request("http://localhost/api/orders?status=generated", {
        headers: { cookie: sessionCookie },
      }),
    );
    assert.equal(ordersRes.status, 200);
    const ordersJson = await ordersRes.json();
    assert.equal(ordersJson.items.length, 1);
    assert.equal(ordersJson.items[0].invoicesOpenAmount, 0);

    const amountPatchRes = await patchInvoice(
      new Request(`http://localhost/api/invoices/${invoiceId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          cookie: sessionCookie,
        },
        body: JSON.stringify({ amount: 100 }),
      }),
      { params: Promise.resolve({ invoiceId: invoiceId.toString() }) },
    );
    assert.equal(amountPatchRes.status, 409);
    const amountPatchJson = await amountPatchRes.json();
    assert.equal(amountPatchJson.message, "Stornierte Rechnung ist schreibgeschützt.");

    const notePatchRes = await patchInvoice(
      new Request(`http://localhost/api/invoices/${invoiceId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          cookie: sessionCookie,
        },
        body: JSON.stringify({ internalNote: "nur intern" }),
      }),
      { params: Promise.resolve({ invoiceId: invoiceId.toString() }) },
    );
    assert.equal(notePatchRes.status, 200);

    const mahnungRes = await createMahnung(
      new Request(`http://localhost/api/invoices/${invoiceId}/mahnung`, {
        method: "POST",
        headers: { cookie: sessionCookie },
      }),
      { params: Promise.resolve({ invoiceId: invoiceId.toString() }) },
    );
    assert.equal(mahnungRes.status, 409);

    const pdfRes = await renderInvoicePdf(
      new Request(`http://localhost/api/invoices/${invoiceId}/pdf`, {
        method: "POST",
        headers: { cookie: sessionCookie },
      }),
      { params: Promise.resolve({ invoiceId: invoiceId.toString() }) },
    );
    assert.equal(pdfRes.status, 200);
    const pdfBytes = Buffer.from(await pdfRes.arrayBuffer());
    assert.equal(pdfRes.headers.get("content-type"), "application/pdf");
    assert.equal(pdfContainsText(pdfBytes, "STORNIERT"), true);
    const invoiceAfterPdf = await db.collection("invoices").findOne({ _id: invoiceId });
    assert.equal(invoiceAfterPdf?.status, "storniert");

    const secondStornoRes = await patchInvoice(
      new Request(`http://localhost/api/invoices/${invoiceId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          cookie: sessionCookie,
        },
        body: JSON.stringify({ status: "storniert" }),
      }),
      { params: Promise.resolve({ invoiceId: invoiceId.toString() }) },
    );
    assert.equal(secondStornoRes.status, 200);
    const secondStornoJson = await secondStornoRes.json();
    assert.equal(secondStornoJson.invoice.cancelledAt, stornoJson.invoice.cancelledAt);

    const undoStornoRes = await patchInvoice(
      new Request(`http://localhost/api/invoices/${invoiceId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          cookie: sessionCookie,
        },
        body: JSON.stringify({ status: "versendet" }),
      }),
      { params: Promise.resolve({ invoiceId: invoiceId.toString() }) },
    );
    assert.equal(undoStornoRes.status, 200);
    const undoStornoJson = await undoStornoRes.json();
    assert.equal(undoStornoJson.invoice.status, "versendet");
    assert.equal(undoStornoJson.invoice.cancelledAt, null);
    assert.equal(undoStornoJson.invoice.cancelledByName, null);

    console.log("test-invoices-storno: ok");
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("test-invoices-storno: failed", error);
  process.exitCode = 1;
});
