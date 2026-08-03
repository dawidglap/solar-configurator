import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  calculateQrReferenceCheckDigit,
  generateQrReference,
  generateScorReference,
  getQrEligibility,
  isQrIban,
  isValidIban,
  isValidQrReference,
  isValidScorReference,
} from "../src/lib/swissQrBill";

describe("QR reference modulo 10 recursive", () => {
  const vectors = [
    ["21000000000313947143000901", "210000000003139471430009017"],
    ["21570300007520033455900012", "215703000075200334559000126"],
    ["00000000000000000000000000", "000000000000000000000000000"],
  ] as const;

  for (const [payload, expected] of vectors) {
    test(`${payload} -> ${expected}`, () => {
      assert.equal(calculateQrReferenceCheckDigit(payload), expected.slice(-1));
      assert.equal(generateQrReference(payload), expected);
      assert.equal(isValidQrReference(expected), true);
    });
  }

  test("rejects a changed check digit", () => {
    assert.equal(isValidQrReference("210000000003139471430009018"), false);
  });
});

describe("ISO 11649 creditor reference mod 97-10", () => {
  const vectors = [
    ["2348231", "RF712348231"],
    ["539007547034", "RF18539007547034"],
    ["5000056789012345", "RF485000056789012345"],
  ] as const;

  for (const [payload, expected] of vectors) {
    test(`${payload} -> ${expected}`, () => {
      assert.equal(generateScorReference(payload), expected);
      assert.equal(isValidScorReference(expected), true);
    });
  }

  test("rejects a changed check digit", () => {
    assert.equal(isValidScorReference("RF19539007547034"), false);
  });
});

describe("IBAN validation", () => {
  test("accepts a valid conventional Swiss IBAN", () => {
    assert.equal(isValidIban("CH58 0079 1123 0008 8901 2"), true);
  });

  test("accepts a valid Swiss QR-IBAN", () => {
    assert.equal(isValidIban("CH44 3199 9123 0008 8901 2"), true);
  });

  test("rejects an invalid checksum", () => {
    assert.equal(isValidIban("CH45 3199 9123 0008 8901 2"), false);
  });
});

describe("QR-IBAN detection", () => {
  test("detects QR-IID 31999", () => {
    assert.equal(isQrIban("CH44 3199 9123 0008 8901 2"), true);
  });

  test("detects QR-IID 30788", () => {
    assert.equal(isQrIban("CH05 3078 8000 0506 6413 3"), true);
  });

  test("does not classify a conventional IID as QR-IID", () => {
    assert.equal(isQrIban("CH58 0079 1123 0008 8901 2"), false);
  });
});

describe("invoice QR eligibility", () => {
  const invoice = {
    invoiceType: "rechnung",
    status: "entwurf",
    paymentStatus: "offen",
    amount: 100,
    paidAmount: 20,
  };

  test("uses the rounded open amount", () => {
    assert.deepEqual(getQrEligibility({ ...invoice, amount: 100.005, paidAmount: 20 }), {
      eligible: true,
      openAmount: 80.01,
    });
  });

  test("skips disabled QR bills", () => {
    assert.equal(getQrEligibility(invoice, { enabled: false }).eligible, false);
  });

  test("skips cancelled, credit-note, paid and non-positive invoices", () => {
    assert.equal(getQrEligibility({ ...invoice, status: "storniert" }).eligible, false);
    assert.equal(getQrEligibility({ ...invoice, invoiceType: "gutschrift" }).eligible, false);
    assert.equal(getQrEligibility({ ...invoice, paymentStatus: "bezahlt" }).eligible, false);
    assert.equal(getQrEligibility({ ...invoice, paidAmount: 100 }).eligible, false);
  });
});
