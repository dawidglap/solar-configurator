import "dotenv/config";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import { DELETE as deleteInvoice } from "../src/app/api/invoices/[invoiceId]/route";
import { resyncOrderInvoices } from "../src/lib/invoices";

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
  const companyId = new ObjectId().toString();
  const companyObjectId = new ObjectId(companyId);
  const planningId = new ObjectId();
  const userId = new ObjectId().toString();
  const orderId = "AUF-2026-DELETE";
  const sessionCookie = buildSessionCookie(
    {
      userId,
      id: userId,
      firstName: "Delete",
      lastName: "Tester",
      name: "Delete Tester",
      email: "delete.tester@example.com",
      activeCompanyId: companyId,
      role: "admin",
    },
    secret,
  );

  const pdfFileId = new ObjectId();
  const parentInvoiceId = new ObjectId();
  const mahnungId = new ObjectId();
  const gutschriftId = new ObjectId();
  const blockedInvoiceId = new ObjectId();
  const blockedChildId = new ObjectId();
  const deletableInvoiceId = new ObjectId();
  const gapOrderId = "AUF-2026-GAP";

  try {
    await client.connect();
    const db = client.db();
    const now = new Date();

    await db.collection("companies").insertOne({
      _id: companyObjectId,
      name: "Delete Test Company",
      billing: { iban: "CH9300762011623852957" },
      paymentDefaults: { currency: "CHF", termDays: 30 },
      createdAt: now,
      updatedAt: now,
    });

    await db.collection("plannings").insertMany([
      {
        _id: planningId,
        companyId,
        title: "Delete Test Planning",
        planningNumber: "ANG-DEL-1",
        orderId,
        orderStatus: "generated",
        summary: { customerName: "Delete Kunde" },
        data: {
          profile: { firstName: "Delete", lastName: "Kunde", salutation: "Herr" },
          angebot: {
            payments: [
              { label: "Anzahlung", pct: 50 },
              { label: "Schlussrechnung", pct: 50 },
            ],
          },
        },
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: new ObjectId(),
        companyId,
        title: "Gap Sync Planning",
        planningNumber: "ANG-GAP-1",
        orderId: gapOrderId,
        orderStatus: "generated",
        summary: { customerName: "Gap Kunde" },
        data: {
          profile: { firstName: "Gap", lastName: "Kunde", salutation: "Herr" },
          angebot: {
            payments: [
              { label: "Rate 1", pct: 30 },
              { label: "Rate 2", pct: 30 },
              { label: "Rate 3", pct: 40 },
            ],
          },
        },
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await db.collection("planningFiles").insertOne({
      _id: pdfFileId,
      companyId,
      planningId: planningId.toString(),
      category: "invoice_pdf",
      title: "Rechnung RE-000001",
      originalFileName: "Rechnung_RE-000001.pdf",
      mimeType: "application/pdf",
      size: 128,
      cloudinaryPublicId: "",
      cloudinaryResourceType: "raw",
      cloudinaryDeliveryType: "upload",
      isDeleted: false,
      deletedAt: null,
      deletedByUserId: null,
      deletedByName: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });

    await db.collection("invoices").insertMany([
      {
        _id: parentInvoiceId,
        companyId,
        planningId: planningId.toString(),
        orderId,
        invoiceNumber: "RE-910001",
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
        issueDate: now,
        dueDate: now,
        status: "mahnung",
        paymentStatus: "offen",
        paidAt: null,
        paidAmount: 0,
        anrede: "Herr",
        bodyText: "Parent",
        internalNote: "",
        pdfFileId,
        createdAt: now,
        updatedAt: now,
        dunningEligible: true,
        dunningLevel: 0,
      },
      {
        _id: mahnungId,
        companyId,
        planningId: planningId.toString(),
        orderId,
        invoiceNumber: "RE-910002",
        invoiceType: "mahnung",
        parentInvoiceId,
        rateIndex: 0,
        position: 0,
        rateLabel: "Mahnung",
        label: "Mahnung",
        pct: 50,
        amount: 1000,
        amountChf: 1000,
        currency: "CHF",
        issueDate: now,
        dueDate: now,
        status: "mahnung",
        paymentStatus: "offen",
        paidAt: null,
        paidAmount: 0,
        anrede: "Herr",
        bodyText: "Mahnung",
        internalNote: "",
        pdfFileId,
        createdAt: now,
        updatedAt: now,
        dunningEligible: false,
        dunningLevel: 1,
        parentPreviousStatus: "heruntergeladen",
      },
      {
        _id: gutschriftId,
        companyId,
        planningId: planningId.toString(),
        orderId,
        invoiceNumber: "RE-910003",
        invoiceType: "gutschrift",
        parentInvoiceId,
        rateIndex: 0,
        position: 1,
        rateLabel: "Gutschrift",
        label: "Gutschrift",
        pct: 0,
        amount: -100,
        amountChf: -100,
        currency: "CHF",
        issueDate: now,
        dueDate: now,
        status: "storniert",
        paymentStatus: "bezahlt",
        paidAt: now,
        paidAmount: 100,
        anrede: "Herr",
        bodyText: "Gutschrift",
        internalNote: "",
        pdfFileId: null,
        createdAt: now,
        updatedAt: now,
        dunningEligible: false,
        dunningLevel: 0,
      },
      {
        _id: blockedInvoiceId,
        companyId,
        planningId: planningId.toString(),
        orderId,
        invoiceNumber: "RE-910004",
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
        issueDate: now,
        dueDate: now,
        status: "heruntergeladen",
        paymentStatus: "offen",
        paidAt: null,
        paidAmount: 0,
        anrede: "Herr",
        bodyText: "Blocked",
        internalNote: "",
        pdfFileId: null,
        createdAt: now,
        updatedAt: now,
        dunningEligible: false,
        dunningLevel: 0,
      },
      {
        _id: blockedChildId,
        companyId,
        planningId: planningId.toString(),
        orderId,
        invoiceNumber: "RE-910005",
        invoiceType: "gutschrift",
        parentInvoiceId: blockedInvoiceId,
        rateIndex: 1,
        position: 1,
        rateLabel: "Blocked Child",
        label: "Blocked Child",
        pct: 0,
        amount: -50,
        amountChf: -50,
        currency: "CHF",
        issueDate: now,
        dueDate: now,
        status: "entwurf",
        paymentStatus: "offen",
        paidAt: null,
        paidAmount: 0,
        anrede: "Herr",
        bodyText: "Blocked Child",
        internalNote: "",
        pdfFileId: null,
        createdAt: now,
        updatedAt: now,
        dunningEligible: false,
        dunningLevel: 0,
      },
      {
        _id: deletableInvoiceId,
        companyId,
        planningId: planningId.toString(),
        orderId,
        invoiceNumber: "RE-910006",
        invoiceType: "rechnung",
        parentInvoiceId: null,
        rateIndex: 2,
        position: 2,
        rateLabel: "Frei",
        label: "Frei",
        pct: 10,
        percentage: 10,
        amount: 200,
        amountChf: 200,
        currency: "CHF",
        issueDate: now,
        dueDate: now,
        status: "heruntergeladen",
        paymentStatus: "offen",
        paidAt: null,
        paidAmount: 0,
        anrede: "Herr",
        bodyText: "Delete me",
        internalNote: "",
        pdfFileId: null,
        createdAt: now,
        updatedAt: now,
        dunningEligible: false,
        dunningLevel: 0,
      },
      {
        _id: new ObjectId(),
        companyId,
        planningId: planningId.toString(),
        orderId: gapOrderId,
        invoiceNumber: "RE-920001",
        invoiceType: "rechnung",
        parentInvoiceId: null,
        rateIndex: 0,
        position: 0,
        rateLabel: "Rate 1",
        label: "Rate 1",
        pct: 30,
        percentage: 30,
        amount: 300,
        amountChf: 300,
        currency: "CHF",
        issueDate: now,
        dueDate: now,
        status: "entwurf",
        paymentStatus: "offen",
        paidAt: null,
        paidAmount: 0,
        anrede: "Herr",
        bodyText: "Rate 1",
        internalNote: "",
        pdfFileId: null,
        createdAt: now,
        updatedAt: now,
        dunningEligible: false,
        dunningLevel: 0,
      },
      {
        _id: new ObjectId(),
        companyId,
        planningId: planningId.toString(),
        orderId: gapOrderId,
        invoiceNumber: "RE-920003",
        invoiceType: "rechnung",
        parentInvoiceId: null,
        rateIndex: 2,
        position: 2,
        rateLabel: "Rate 3",
        label: "Rate 3",
        pct: 40,
        percentage: 40,
        amount: 400,
        amountChf: 400,
        currency: "CHF",
        issueDate: now,
        dueDate: now,
        status: "entwurf",
        paymentStatus: "offen",
        paidAt: null,
        paidAmount: 0,
        anrede: "Herr",
        bodyText: "Rate 3",
        internalNote: "",
        pdfFileId: null,
        createdAt: now,
        updatedAt: now,
        dunningEligible: false,
        dunningLevel: 0,
      },
    ]);

    const deleteMahnungRes = await deleteInvoice(
      new Request(`http://localhost/api/invoices/${mahnungId}`, {
        method: "DELETE",
        headers: { cookie: sessionCookie },
      }),
      { params: Promise.resolve({ invoiceId: mahnungId.toString() }) },
    );
    assert.equal(deleteMahnungRes.status, 200);
    const parentAfterMahnungDelete = await db.collection("invoices").findOne({ _id: parentInvoiceId });
    const deletedMahnung = await db.collection("invoices").findOne({ _id: mahnungId });
    const deletedPdfFile = await db.collection("planningFiles").findOne({ _id: pdfFileId });
    assert.equal(parentAfterMahnungDelete?.status, "heruntergeladen");
    assert.equal(deletedMahnung, null);
    assert.equal(deletedPdfFile?.isDeleted, true);

    const deleteGutschriftRes = await deleteInvoice(
      new Request(`http://localhost/api/invoices/${gutschriftId}`, {
        method: "DELETE",
        headers: { cookie: sessionCookie },
      }),
      { params: Promise.resolve({ invoiceId: gutschriftId.toString() }) },
    );
    assert.equal(deleteGutschriftRes.status, 200);
    assert.equal(await db.collection("invoices").findOne({ _id: gutschriftId }), null);

    const blockedDeleteRes = await deleteInvoice(
      new Request(`http://localhost/api/invoices/${blockedInvoiceId}`, {
        method: "DELETE",
        headers: { cookie: sessionCookie },
      }),
      { params: Promise.resolve({ invoiceId: blockedInvoiceId.toString() }) },
    );
    assert.equal(blockedDeleteRes.status, 409);

    const deletableDeleteRes = await deleteInvoice(
      new Request(`http://localhost/api/invoices/${deletableInvoiceId}`, {
        method: "DELETE",
        headers: { cookie: sessionCookie },
      }),
      { params: Promise.resolve({ invoiceId: deletableInvoiceId.toString() }) },
    );
    assert.equal(deletableDeleteRes.status, 200);
    assert.equal(await db.collection("invoices").findOne({ _id: deletableInvoiceId }), null);

    const gapPlanning = await db.collection("plannings").findOne({ orderId: gapOrderId });
    const gapCompany = await db.collection("companies").findOne({ _id: companyObjectId });
    const resyncResult = await resyncOrderInvoices({
      db,
      companyId,
      planning: gapPlanning,
      company: gapCompany,
      session: {
        activeCompanyId: companyId,
        role: "admin",
        id: userId,
        userId,
        name: "Delete Tester",
        email: "delete.tester@example.com",
      } as any,
      orderId: gapOrderId,
      orderGeneratedAt: now,
      totalInklMwst: 1000,
    });
    assert.equal(resyncResult.ok, true);
    const gapInvoices = await db
      .collection("invoices")
      .find({ companyId, orderId: gapOrderId, invoiceType: "rechnung" })
      .sort({ rateIndex: 1 })
      .toArray();
    assert.equal(gapInvoices.length, 2);
    assert.deepEqual(
      gapInvoices.map((invoice) => invoice.rateIndex),
      [0, 2],
    );

    console.log("test-invoices-delete: ok");
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("test-invoices-delete: failed", error);
  process.exitCode = 1;
});
