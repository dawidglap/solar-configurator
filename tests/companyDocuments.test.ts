import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import {
  createPublicCompanyDocumentToken,
  getPublicCompanyDocumentUrl,
  normalizeCompanyDocument,
  normalizeCompanyDocumentKind,
  uploadCompanyDocument,
  verifyPublicCompanyDocumentToken,
} from "../src/lib/companyDocuments";

process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/company-document-unit-tests";

test("only AGB remains a supported company-document kind", () => {
  assert.equal(normalizeCompanyDocumentKind("agb"), "agb");
  assert.equal(normalizeCompanyDocumentKind("vollmacht"), null);
  assert.equal(normalizeCompanyDocumentKind("bestellformular"), null);
});

test("public AGB tokens are signed and reject tampering", () => {
  const values = {
    companyId: "64f000000000000000000001",
    fileId: "64f000000000000000000002",
    kind: "agb" as const,
    secret: "unit-test-secret",
  };
  const token = createPublicCompanyDocumentToken(values);
  assert.deepEqual(verifyPublicCompanyDocumentToken(token, values.secret), {
    companyId: values.companyId,
    fileId: values.fileId,
    kind: "agb",
  });
  assert.equal(verifyPublicCompanyDocumentToken(`${token}x`, values.secret), null);
  assert.equal(verifyPublicCompanyDocumentToken(token, "wrong-secret"), null);
  assert.match(
    getPublicCompanyDocumentUrl({
      baseUrl: "https://planner.helionic.ch",
      companyId: values.companyId,
      document: { fileId: values.fileId },
      secret: values.secret,
    }) || "",
    /^https:\/\/planner\.helionic\.ch\/api\/public\/company-document\//,
  );
});

test("company document responses expose camelCase fileName", () => {
  const normalized = normalizeCompanyDocument({
    _id: "64f000000000000000000002",
    filename: "AGB Solar AG.pdf",
    length: 123,
    metadata: { kind: "agb", uploadedAt: new Date("2026-08-17T10:00:00.000Z") },
  });
  assert.equal(normalized?.fileName, "AGB Solar AG.pdf");
  assert.equal(normalized?.uploadedAt, "2026-08-17T10:00:00.000Z");
});

test("non-PDF company-document uploads are rejected before persistence", async () => {
  const file = new File(["plain text"], "agb.txt", { type: "text/plain" });
  await assert.rejects(
    uploadCompanyDocument({
      db: {} as any,
      companyId: "64f000000000000000000001",
      kind: "agb",
      file,
      session: {} as any,
    }),
    /Nur PDF-Dateien/,
  );
});

test("spoofed PDF MIME types are rejected by file signature", async () => {
  const file = new File(["plain text"], "agb.pdf", { type: "application/pdf" });
  await assert.rejects(
    uploadCompanyDocument({
      db: {} as any,
      companyId: "64f000000000000000000001",
      kind: "agb",
      file,
      session: {} as any,
    }),
    /gültige PDF-Dateien/,
  );
});

test("AGB pages append to the generated offer/order PDF", async () => {
  const { appendPdfAttachment, getEnabledCompanyDocumentKinds } = await import("../src/lib/planningDocuments");
  assert.deepEqual(getEnabledCompanyDocumentKinds({}), ["agb"]);
  assert.deepEqual(
    getEnabledCompanyDocumentKinds({ data: { parts: { formDocuments: { agb: false } } } }),
    ["agb"],
  );
  const document = await PDFDocument.create();
  document.addPage([595, 842]);
  const agb = await PDFDocument.create();
  agb.addPage([595, 842]);
  agb.addPage([595, 842]);
  const appended = await appendPdfAttachment(document, await agb.save());
  assert.equal(appended, 2);
  assert.equal(document.getPageCount(), 3);
});
