import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";

process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/offer-signature-unit-tests";

const TRANSPARENT_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const loadOffer = () => import("../src/lib/offerSignatures");
const loadOrder = () => import("../src/lib/orderSignatures");

test("creates a 32-byte base64url token and stores only its hashable form", async () => {
  const { isValidOfferToken, newOfferSignatureToken } = await loadOffer();
  const { sha256 } = await loadOrder();
  const created = newOfferSignatureToken();
  assert.equal(created.token.length, 43);
  assert.equal(isValidOfferToken(created.token), true);
  assert.equal(created.hash, sha256(created.token));
  assert.equal(created.hash.includes(created.token), false);
});

test("validates request defaults, place and expiry", async () => {
  const { parseOfferSignatureRequest } = await loadOffer();
  assert.deepEqual(parseOfferSignatureRequest({ place: "remote" }), {
    email: "",
    message: "",
    expiresInDays: 30,
    sendEmail: false,
    place: "remote",
  });
  assert.throws(() => parseOfferSignatureRequest({}), /Abschlussort/);
  assert.throws(() => parseOfferSignatureRequest({ place: "remote", expiresInDays: 0 }), /zwischen 1 und 90/);
});

test("offer signature status serialization exposes no token hash", async () => {
  const { buildDefaultOfferSignatureFields, buildOfferSignatureResponse } = await loadOffer();
  const response = buildOfferSignatureResponse({
    _id: "64f000000000000000000001",
    ...buildDefaultOfferSignatureFields(),
    offerSignatureStatus: "sent",
    offerSignatureTokenHash: "secret-hash",
  }) as Record<string, unknown>;
  assert.equal(response.signatureStatus, "sent");
  assert.equal(response.signatureLink, null);
  assert.equal("offerSignatureTokenHash" in response, false);
});

test("serializes public customer and GeoAdmin offer fields", async () => {
  const { buildPublicOfferCustomerFields } = await loadOffer();
  assert.deepEqual(
    buildPublicOfferCustomerFields(
      {
        data: {
          profile: {
            customerType: "private",
            contactSalutation: "Herr",
            contactLastName: "Rizzoli",
            buildingStreet: "Schachenstrasse",
            buildingStreetNo: "4",
            buildingZip: "9450",
            buildingCity: "Lüchingen",
            egid: "1234567",
            parcelNumber: "1042",
          },
        },
      },
      null,
    ),
    {
      salutation: "herr",
      customerLastName: "Rizzoli",
      customerType: "private",
      customerCompanyName: null,
      addressStreet: "Schachenstrasse",
      addressHouseNumber: "4",
      addressZip: "9450",
      addressCity: "Lüchingen",
      egid: "1234567",
      buildingNumber: "1234567",
      parcelNumber: "1042",
    },
  );
});

test("normalizes and validates the optional payout IBAN", async () => {
  const { parseOfferAcceptanceDetails } = await loadOffer();
  assert.deepEqual(
    parseOfferAcceptanceDetails({
      propertyStreet: "  Schachenstrasse ",
      propertyHouseNumber: " 4 ",
      propertyZip: " 9450 ",
      propertyCity: " Lüchingen ",
      buildingNumber: " 1234567 ",
      parcelNumber: " 1042 ",
      bankAccountHolder: " Nicola Rizzoli ",
      bankIban: "ch93 0076 2011 6238 5295 7",
    }),
    {
      propertyStreet: "Schachenstrasse",
      propertyHouseNumber: "4",
      propertyZip: "9450",
      propertyCity: "Lüchingen",
      buildingNumber: "1234567",
      parcelNumber: "1042",
      bankAccountHolder: "Nicola Rizzoli",
      bankIban: "CH9300762011623852957",
    },
  );
  assert.throws(
    () => parseOfferAcceptanceDetails({ bankIban: "CH9300762011623852958" }),
    /Ungültige IBAN/,
  );
  assert.throws(
    () => parseOfferAcceptanceDetails({ propertyHouseNumber: "x".repeat(21) }),
    /maximal 20/,
  );
});

test("creates signed offer and confirmation PDFs with protocol pages", async () => {
  const {
    appendOfferConfirmationSignatureProtocol,
    createOfferConfirmationPdf,
    createSignedOrderPdf,
    sha256,
  } = await loadOrder();
  const source = await PDFDocument.create();
  source.addPage([595.28, 841.89]);
  const sourcePdf = Buffer.from(await source.save());
  const signedAt = new Date("2026-08-10T12:00:00.000Z");
  const signedOffer = await createSignedOrderPdf({
    sourcePdf,
    signaturePng: Buffer.from(TRANSPARENT_PNG, "base64"),
    orderId: "OFF-2026-0042",
    customerName: "Max Muster",
    projectTitle: "Solaranlage Zürich",
    totalInklMwst: 35_940,
    signerName: "Max Muster",
    signerEmail: "max@example.ch",
    place: "Zürich",
    signedAt,
    signerIp: "192.0.2.42",
    signerUserAgent: "QA Browser",
    sourcePdfSha256: sha256(sourcePdf),
    documentKind: "Offerte",
    openedAt: new Date("2026-08-10T11:55:00.000Z"),
    tokenId: sha256("token"),
    signaturePlace: "onsite_customer",
  });
  assert.equal((await PDFDocument.load(signedOffer)).getPageCount(), 2);

  const confirmation = await createOfferConfirmationPdf({
    sourcePdf,
    orderId: "AUF-2026-0007",
    offerNumber: "OFF-2026-0042",
    customerName: "Max Muster",
    projectTitle: "Solaranlage Zürich",
    signerName: "Max Muster",
    signedAt,
    totalInklMwst: 35_940,
    payments: [{ label: "Anzahlung", pct: 50, amount: 17_970 }],
    propertyStreet: "Schachenstrasse",
    propertyHouseNumber: "4",
    propertyZip: "9450",
    propertyCity: "Lüchingen",
    buildingNumber: "1234567",
    parcelNumber: "1042",
    bankAccountHolder: "Nicola Rizzoli",
    bankIban: "CH9300762011623852957",
    withdrawalRightApplies: true,
    withdrawalUntil: new Date("2026-08-24T12:00:00.000Z"),
  });
  const loadedConfirmation = await PDFDocument.load(confirmation);
  assert.equal(loadedConfirmation.getPageCount(), 2);
  assert.equal(loadedConfirmation.getTitle(), "Auftragsbestätigung AUF-2026-0007");

  const signedConfirmation = await appendOfferConfirmationSignatureProtocol({
    confirmationPdf: confirmation,
    signaturePng: Buffer.from(TRANSPARENT_PNG, "base64"),
    orderId: "AUF-2026-0007",
    customerName: "Max Muster",
    projectTitle: "Solaranlage Zürich",
    totalInklMwst: 35_940,
    signerName: "Max Muster",
    signerEmail: "max@example.ch",
    place: "Zürich",
    signedAt,
    signerIp: "192.0.2.42",
    signerUserAgent: "QA Browser",
    signedOfferSha256: sha256(signedOffer),
  });
  const loadedSignedConfirmation = await PDFDocument.load(signedConfirmation);
  assert.equal(loadedSignedConfirmation.getPageCount(), 3);
  assert.equal(loadedSignedConfirmation.getTitle(), "AUF-2026-0007 - unterschrieben");
});
