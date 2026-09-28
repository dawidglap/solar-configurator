import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ObjectId } from "mongodb";

process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/planning-files-unit-tests";

const loadPlanningFiles = () => import("../src/lib/planningFiles");

test("Dateien exposes the authenticated inline endpoint instead of direct Cloudinary delivery", async () => {
  const { buildAuthenticatedPlanningFileUrl, normalizePlanningFile } = await loadPlanningFiles();
  const fileId = new ObjectId("64f000000000000000000002");
  const doc = {
    _id: fileId,
    companyId: "company-1",
    planningId: "64f000000000000000000001",
    category: "offer",
    title: "Angebot",
    originalFileName: "angebot.pdf",
    fileType: "pdf",
    mimeType: "application/pdf",
    cloudinaryPublicId: "private/path/angebot.pdf",
    cloudinaryResourceType: "raw",
    cloudinaryUrl: "http://res.cloudinary.example/raw/upload/private/path/angebot.pdf",
    cloudinarySecureUrl: "https://res.cloudinary.example/raw/upload/private/path/angebot.pdf",
  };

  const expected =
    "/api/plannings/64f000000000000000000001/files/64f000000000000000000002/download?disposition=inline";
  assert.equal(buildAuthenticatedPlanningFileUrl(doc), expected);

  const normalized = normalizePlanningFile(doc);
  assert.equal(normalized.downloadUrl, expected);
  assert.equal(normalized.cloudinaryUrl, expected);
  assert.equal(normalized.cloudinarySecureUrl, expected);
  assert.equal(normalized.cloudinaryPublicId, doc.cloudinaryPublicId);
  assert.equal(JSON.stringify(normalized).includes("res.cloudinary"), false);
});

test("authenticated file URLs require both planning and file identity", async () => {
  const { buildAuthenticatedPlanningFileUrl } = await loadPlanningFiles();
  assert.equal(buildAuthenticatedPlanningFileUrl({ _id: new ObjectId() }), "");
  assert.equal(buildAuthenticatedPlanningFileUrl({ planningId: "planning-1" }), "");
});

test("download diagnostics never log signed Cloudinary URLs or storage identifiers", () => {
  const source = readFileSync(
    new URL(
      "../src/app/api/plannings/[planningId]/files/[fileId]/download/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const logBlock = source.slice(
    source.indexOf('console.info("PLANNING FILE DOWNLOAD"'),
    source.indexOf("if (!upstream.ok)"),
  );
  assert.doesNotMatch(logBlock, /generatedUrl|cloudinaryPublicId|publicIdWithExtension/);
});
