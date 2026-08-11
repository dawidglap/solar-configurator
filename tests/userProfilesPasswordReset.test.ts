import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId } from "mongodb";
import {
  hasCurrentSessionVersion,
  normalizeWorkEmail,
  parseUserProfilePatch,
  UserProfileValidationError,
  resolvePlanningSellerContact,
} from "../src/lib/userProfiles";
import {
  createPasswordResetToken,
  hashPasswordResetToken,
  validatePasswordResetRedirect,
} from "../src/lib/passwordReset";

test("normalizes and validates personal profile fields", () => {
  assert.equal(normalizeWorkEmail("  DAWID@Demo-Company.ch "), "dawid@demo-company.ch");
  assert.deepEqual(parseUserProfilePatch({ phone: " +41 79 123 45 67 ", jobTitle: " Verkauf " }), {
    phone: "+41 79 123 45 67",
    jobTitle: "Verkauf",
  });
  assert.throws(() => normalizeWorkEmail("kein-email"), UserProfileValidationError);
  assert.throws(
    () => parseUserProfilePatch({ emailSignature: "x".repeat(2001) }),
    UserProfileValidationError,
  );
});

test("creates opaque reset tokens and stable SHA-256 hashes", () => {
  const token = createPasswordResetToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(hashPasswordResetToken(token), hashPasswordResetToken(token));
  assert.match(hashPasswordResetToken(token), /^[a-f0-9]{64}$/);
});

test("allows only configured application origins for reset redirects", () => {
  assert.equal(
    validatePasswordResetRedirect("https://app.helionic.ch/passwort-zuruecksetzen")?.origin,
    "https://app.helionic.ch",
  );
  assert.equal(validatePasswordResetRedirect("https://evil.example/reset"), null);
  assert.equal(validatePasswordResetRedirect("javascript:alert(1)"), null);
});

test("session version invalidates old signed cookies after a password reset", () => {
  assert.equal(hasCurrentSessionVersion({}, {}), true);
  assert.equal(hasCurrentSessionVersion({ sessionVersion: 1 }, { sessionVersion: 0 }), false);
  assert.equal(hasCurrentSessionVersion({ sessionVersion: 2 }, { sessionVersion: 2 }), true);
});

test("public signature seller contact prefers the assigned user's work address", async () => {
  const sellerId = new ObjectId();
  const db = {
    collection(name: string) {
      assert.equal(name, "users");
      return {
        findOne: async () => ({
          _id: sellerId,
          firstName: "Dawid",
          lastName: "Glap",
          email: "login@example.ch",
          workEmail: "dawid@demo-company.ch",
          phone: "+41 79 123 45 67",
        }),
      };
    },
  };
  const seller = await resolvePlanningSellerContact({
    db: db as any,
    planning: { commercial: { assignedToUserId: sellerId } },
    company: { contact: { email: "info@demo-company.ch" } },
  });
  assert.deepEqual(seller, {
    sellerName: "Dawid Glap",
    sellerEmail: "dawid@demo-company.ch",
    sellerPhone: "+41 79 123 45 67",
    sellerUserId: sellerId.toString(),
  });
});
