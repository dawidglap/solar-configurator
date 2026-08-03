import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { PDFDocument } from "pdf-lib";
import {
  calculateQrReferenceCheckDigit,
  createInvoiceQrPaymentPart,
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
    const result = getQrEligibility({ ...invoice, amount: 100.005, paidAmount: 20 });
    assert.equal(result.eligible, true);
    assert.equal(result.openAmount, 80.01);
    assert.equal(result.warning, null);
  });

  test("skips disabled QR bills", () => {
    const result = getQrEligibility(invoice, { enabled: false });
    assert.equal(result.eligible, false);
    assert.match(result.warning ?? "", /deaktiviert/i);
  });

  test("skips cancelled, credit-note, paid and non-positive invoices", () => {
    for (const candidate of [
      { ...invoice, status: "storniert" },
      { ...invoice, invoiceType: "gutschrift" },
      { ...invoice, paymentStatus: "bezahlt" },
      { ...invoice, paidAmount: 100 },
    ]) {
      const result = getQrEligibility(candidate);
      assert.equal(result.eligible, false);
      assert.match(result.warning ?? "", /.+/);
    }
  });
});

describe("PDFKit payment-part renderer", () => {
  test("renders RE-000042 as an exact 210 x 105 mm payment part", async () => {
    const result = await createInvoiceQrPaymentPart({
      invoice: {
        invoiceNumber: "RE-000042",
        invoiceType: "rechnung",
        status: "entwurf",
        paymentStatus: "offen",
        amount: 37_562.34,
        paidAmount: 0,
        rateLabel: "Anzahlung",
        qrReferenceType: "QRR",
        qrReference: generateQrReference("42"),
      },
      planning: { data: { profile: {} } },
      company: {
        name: "Helionic Muster AG",
        bank: { accountHolder: "Helionic Muster AG" },
        qrBill: {
          enabled: true,
          referenceType: "QRR",
          qrIban: "CH44 3199 9123 0008 8901 2",
          language: "de",
          creditor: {
            street: "Solarstrasse",
            houseNumber: "7",
            zip: "8000",
            city: "Zürich",
            country: "CH",
          },
        },
      },
      customer: {
        firstName: "Peter",
        lastName: "Muster",
        street: "Musterstrasse",
        streetNo: "1",
        zip: "8000",
        city: "Zürich",
        country: "CH",
      },
    });

    assert.equal(result.qrBillWarning, null);
    assert.ok(result.paymentPartPdfBytes);
    const pdf = await PDFDocument.load(result.paymentPartPdfBytes);
    const size = pdf.getPage(0).getSize();
    assert.ok(Math.abs(size.width - 595.276) < 0.01);
    assert.ok(Math.abs(size.height - 297.638) < 0.01);
  });

  test("returns a warning instead of silently omitting an ineligible payment part", async () => {
    const result = await createInvoiceQrPaymentPart({
      invoice: {
        invoiceNumber: "RE-000042",
        invoiceType: "rechnung",
        status: "entwurf",
        paymentStatus: "bezahlt",
        amount: 37_562.34,
        paidAmount: 37_562.34,
      },
      planning: {},
      company: { qrBill: { enabled: true } },
    });

    assert.equal(result.paymentPartPdfBytes, null);
    assert.match(result.qrBillWarning ?? "", /bezahlt/i);
  });
});
