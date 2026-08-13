import assert from "node:assert/strict";
import test from "node:test";

process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/signature-email-unit-tests";

const loadEmails = () => import("../src/lib/signatureEmails");

test("builds the Edge Function payload with recipients, Reply-To, link and PDF attachment", async () => {
  const { buildSignatureEmailIdempotencyKey, buildSignatureEmailPayload } = await loadEmails();
  const idempotencyKey = buildSignatureEmailIdempotencyKey({
    companyId: "company-1",
    orderId: "AUF-2026-0007",
    kind: "vollmacht_submitted",
  });
  assert.equal(idempotencyKey, "company-1:AUF-2026-0007:vollmacht_submitted");
  const payload = buildSignatureEmailPayload({
    delivery: {
      _id: idempotencyKey,
      kind: "vollmacht_submitted",
      orderId: "AUF-2026-0007",
      companyName: "Demo Solar AG",
      customerName: "Max Muster",
      customerEmail: "kunde@example.ch",
      sellerName: "Sara Solar",
      sellerEmail: "sara@example.ch",
      downloadUrl: "https://planner.example/vollmacht?download=1",
      attachmentFileName: "vollmacht-AUF-2026-0007.pdf",
      attachmentMimeType: "application/pdf",
    },
    attachmentBase64: "JVBERi0=",
  });
  assert.deepEqual(payload.to, ["kunde@example.ch"]);
  assert.deepEqual(payload.recipients, ["kunde@example.ch", "sara@example.ch"]);
  assert.deepEqual(payload.ccEmails, ["sara@example.ch"]);
  assert.equal(payload.replyTo, "sara@example.ch");
  assert.equal(payload.downloadUrl, "https://planner.example/vollmacht?download=1");
  assert.equal(payload.attachments[0].content, "JVBERi0=");
});

test("sends each order and email kind only once", async () => {
  const { queueSignatureDocumentEmail } = await loadEmails();
  const docs = new Map<string, any>();
  const collection = {
    async updateOne(filter: any, update: any) {
      const id = String(filter._id);
      const existing = docs.get(id);
      const next = { ...(existing ?? { _id: id }) };
      if (!existing && update.$setOnInsert) Object.assign(next, update.$setOnInsert);
      if (update.$set) Object.assign(next, update.$set);
      if (update.$inc) {
        for (const [key, value] of Object.entries(update.$inc)) {
          next[key] = Number(next[key] ?? 0) + Number(value);
        }
      }
      if (update.$unset) {
        for (const key of Object.keys(update.$unset)) delete next[key];
      }
      docs.set(id, next);
      return { matchedCount: existing ? 1 : 0, upsertedCount: existing ? 0 : 1 };
    },
    async findOneAndUpdate(filter: any, update: any) {
      const id = String(filter._id);
      const existing = docs.get(id);
      if (!existing || existing.sentAt || !["pending", "failed"].includes(existing.status)) return null;
      const next = { ...existing, ...(update.$set ?? {}) };
      if (update.$inc) {
        for (const [key, value] of Object.entries(update.$inc)) {
          next[key] = Number(next[key] ?? 0) + Number(value);
        }
      }
      docs.set(id, next);
      return next;
    },
    async findOne(filter: any) {
      return docs.get(String(filter._id)) ?? null;
    },
  };
  const db = { collection: () => collection } as any;
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SIGNATURE_EMAIL_FUNCTION_URL;
  const originalToken = process.env.SIGNATURE_EMAIL_FUNCTION_TOKEN;
  let sends = 0;
  process.env.SIGNATURE_EMAIL_FUNCTION_URL = "https://mail.example/functions/v1/send-signature-email";
  process.env.SIGNATURE_EMAIL_FUNCTION_TOKEN = "test-token";
  globalThis.fetch = async () => {
    sends += 1;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  const args = {
    db,
    kind: "offer_accepted" as const,
    companyId: "company-1",
    planningId: "planning-1",
    orderId: "AUF-2026-0007",
    offerNumber: "ANG-2026-3499",
    companyName: "Demo Solar AG",
    customerName: "Max Muster",
    customerEmail: "kunde@example.ch",
    sellerName: "Sara Solar",
    sellerEmail: "sara@example.ch",
    downloadUrl: "https://planner.example/confirmation.pdf",
    attachment: {
      fileId: "64f000000000000000000001",
      fileName: "auftragsbestaetigung-AUF-2026-0007.pdf",
      mimeType: "application/pdf" as const,
      buffer: Buffer.from("%PDF-test"),
    },
  };
  try {
    assert.equal((await queueSignatureDocumentEmail(args)).status, "sent");
    assert.equal((await queueSignatureDocumentEmail(args)).status, "already_sent");
    assert.equal(sends, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SIGNATURE_EMAIL_FUNCTION_URL;
    else process.env.SIGNATURE_EMAIL_FUNCTION_URL = originalUrl;
    if (originalToken === undefined) delete process.env.SIGNATURE_EMAIL_FUNCTION_TOKEN;
    else process.env.SIGNATURE_EMAIL_FUNCTION_TOKEN = originalToken;
  }
});
