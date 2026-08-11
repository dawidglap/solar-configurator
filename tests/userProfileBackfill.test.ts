import assert from "node:assert/strict";
import test from "node:test";
import {
  buildUserProfileBackfillPatch,
  deriveProfileJobTitle,
  deriveProfileWorkEmail,
  transliterateProfileEmailPart,
} from "../src/lib/userProfileBackfill";

test("transliterates names and applies the Max Müller special case", () => {
  assert.equal(transliterateProfileEmailPart(" Dörte Weiß "), "doerteweiss");
  assert.equal(deriveProfileWorkEmail({ firstName: "Max", lastName: "Müller" }), "dg18@live.it");
  assert.equal(deriveProfileWorkEmail({ firstName: "Max", lastName: "Mueller" }), "dg18@live.it");
  assert.equal(
    deriveProfileWorkEmail({ firstName: "Jörg-Alex", lastName: "Häßler" }),
    "joergalex.haessler@demo-company.ch",
  );
});

test("derives titles from the demo-company membership role", () => {
  assert.equal(deriveProfileJobTitle("owner"), "Geschäftsführer");
  assert.equal(deriveProfileJobTitle("sales"), "Verkaufsberater");
  assert.equal(deriveProfileJobTitle("viewer"), "Mitarbeiter");
});

test("fills only empty profile fields and builds the signature from effective values", () => {
  const patch = buildUserProfileBackfillPatch({
    user: {
      firstName: "Anna",
      lastName: "Keller",
      email: "login@example.ch",
      workEmail: "anna@external.example",
      phone: "",
      jobTitle: "Projektleiterin",
    },
    membership: { role: "sales" },
    companyName: "Demo Company",
    index: 7,
  });
  assert.equal(patch.workEmail, undefined);
  assert.equal(patch.jobTitle, undefined);
  assert.equal(patch.phone, "+41 44 000 00 07");
  assert.equal(
    patch.emailSignature,
    "Freundliche Grüsse\nAnna Keller\nProjektleiterin\n\nDemo Company\nTel. +41 44 000 00 07\nanna@external.example",
  );
});

test("is idempotent unless force is requested", () => {
  const user = {
    firstName: "Anna",
    lastName: "Keller",
    workEmail: "anna@example.ch",
    phone: "+41 1",
    jobTitle: "Alt",
    emailSignature: "Bestehend",
  };
  const common = { user, membership: { role: "admin" }, companyName: "Demo Company", index: 1 };
  assert.deepEqual(buildUserProfileBackfillPatch(common), {});
  assert.deepEqual(buildUserProfileBackfillPatch({ ...common, force: true }), {
    workEmail: "anna.keller@demo-company.ch",
    phone: "+41 44 000 00 01",
    jobTitle: "Administrator",
    emailSignature:
      "Freundliche Grüsse\nAnna Keller\nAdministrator\n\nDemo Company\nTel. +41 44 000 00 01\nanna.keller@demo-company.ch",
  });
});
