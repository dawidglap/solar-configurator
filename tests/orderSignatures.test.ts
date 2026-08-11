import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";

process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/order-signature-unit-tests";

function loadSignatures() {
  return import("../src/lib/orderSignatures");
}

const TRANSPARENT_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("accepts only complete 32-byte base64url signature tokens", async () => {
  const { isValidSignatureToken } = await loadSignatures();
  assert.equal(isValidSignatureToken("a".repeat(43)), true);
  assert.equal(isValidSignatureToken("a".repeat(42)), false);
  assert.equal(isValidSignatureToken(`${"a".repeat(42)}+`), false);
});

test("validates signature request parameters", async () => {
  const { parseSignatureRequestInput } = await loadSignatures();
  assert.deepEqual(parseSignatureRequestInput({}), {
    email: "",
    message: "",
    expiresInDays: 14,
    sendEmail: true,
  });
  assert.equal(parseSignatureRequestInput({ expiresInDays: 30, sendEmail: false }).expiresInDays, 30);
  assert.throws(() => parseSignatureRequestInput({ email: "ungueltig" }), /E-Mail/);
  assert.throws(() => parseSignatureRequestInput({ expiresInDays: 0 }), /zwischen 1 und 90/);
  assert.throws(() => parseSignatureRequestInput({ expiresInDays: 1.5 }), /ganze Zahl/);
});

test("validates PNG data URLs and the 2 MB limit", async () => {
  const { validateSignatureImage } = await loadSignatures();
  const decoded = validateSignatureImage(`data:image/png;base64,${TRANSPARENT_PNG}`);
  assert.equal(decoded.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.throws(() => validateSignatureImage("data:image/jpeg;base64,AAAA"), /PNG/);
  const oversized = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    Buffer.alloc(2 * 1024 * 1024),
  ]).toString("base64");
  assert.throws(() => validateSignatureImage(`data:image/png;base64,${oversized}`), /2 MB/);
});

test("normalization never exposes token, IP or user agent", async () => {
  const { buildDefaultOrderSignatureFields, normalizeSignatureFields } = await loadSignatures();
  const normalized = normalizeSignatureFields({
    ...buildDefaultOrderSignatureFields(),
    signatureStatus: "signed",
    signatureToken: "secret",
    signatureTokenHash: "hash",
    signerIp: "192.0.2.1",
    signerUserAgent: "secret agent",
  }) as Record<string, unknown>;
  assert.equal(normalized.signatureStatus, "signed");
  assert.equal("signatureToken" in normalized, false);
  assert.equal("signatureTokenHash" in normalized, false);
  assert.equal("signerIp" in normalized, false);
  assert.equal("signerUserAgent" in normalized, false);
});

test("creates a signed PDF with an additional protocol page", async () => {
  const { createSignedOrderPdf, sha256 } = await loadSignatures();
  const sourceDocument = await PDFDocument.create();
  sourceDocument.addPage([595.28, 841.89]);
  const sourcePdf = Buffer.from(await sourceDocument.save());
  const sourceHash = sha256(sourcePdf);
  const signedPdf = await createSignedOrderPdf({
    sourcePdf,
    signaturePng: Buffer.from(TRANSPARENT_PNG, "base64"),
    orderId: "AUF-2026-0007",
    customerName: "Max Muster",
    projectTitle: "Solaranlage Musterstrasse",
    totalInklMwst: 35_940,
    signerName: "Max Muster",
    signerEmail: "max@example.ch",
    place: "Zürich",
    signedAt: new Date("2026-08-06T12:00:00.000Z"),
    signerIp: "192.0.2.1",
    signerUserAgent: "Mozilla/5.0 Test",
    sourcePdfSha256: sourceHash,
  });
  const loaded = await PDFDocument.load(signedPdf);
  assert.equal(loaded.getPageCount(), 2);
  assert.equal(loaded.getTitle(), "Auftrag AUF-2026-0007 - unterschrieben");
  assert.notEqual(sha256(signedPdf), sourceHash);
});
