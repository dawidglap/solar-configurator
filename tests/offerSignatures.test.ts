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

test("accepts an optional unrestricted signature place and defaults it to remote", async () => {
  const { parseOfferSignatureRequest } = await loadOffer();
  assert.deepEqual(parseOfferSignatureRequest({}), {
    email: "",
    message: "",
    expiresInDays: 30,
    sendEmail: false,
    place: "remote",
  });
  assert.equal(parseOfferSignatureRequest({ place: null }).place, "remote");
  assert.equal(parseOfferSignatureRequest({ place: "" }).place, "remote");
  assert.equal(parseOfferSignatureRequest({ place: "Zürich" }).place, "Zürich");
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

test("public offers expose the same token-protected AGB URL as termsUrl", async () => {
  const { buildPublicOfferTermsUrls } = await loadOffer();
  assert.deepEqual(
    buildPublicOfferTermsUrls("https://planner.helionic.ch", "token/value", true),
    {
      agbUrl: "https://planner.helionic.ch/api/public/offer-signature/token%2Fvalue/terms",
      termsUrl: "https://planner.helionic.ch/api/public/offer-signature/token%2Fvalue/terms",
    },
  );
  assert.deepEqual(buildPublicOfferTermsUrls("https://planner.helionic.ch", "token", false), {
    agbUrl: null,
    termsUrl: null,
  });
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
            landRegisterNumber: "4567",
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
      landRegisterNumber: "4567",
    },
  );
});

test("resolves public object addresses from planning, building and billing fallbacks", async () => {
  const { resolveOfferPropertyAddress } = await loadOffer();
  const customer = {
    buildingStreet: "Gebäudeweg",
    buildingStreetNo: "8",
    buildingZip: "9000",
    buildingCity: "St. Gallen",
    street: "Rechnungsweg",
    streetNo: "9",
    zip: "8000",
    city: "Zürich",
  };
  assert.deepEqual(
    resolveOfferPropertyAddress(
      {
        propertyStreet: "Planstrasse 4",
        propertyZip: "9430",
        propertyCity: "St. Margrethen",
      },
      customer,
    ),
    {
      addressStreet: "Planstrasse",
      addressHouseNumber: "4",
      propertyStreetLine: "Planstrasse 4",
      propertyZip: "9430",
      propertyCity: "St. Margrethen",
      objectAddress: "Planstrasse 4, 9430 St. Margrethen",
    },
  );
  assert.equal(
    resolveOfferPropertyAddress({}, customer).objectAddress,
    "Gebäudeweg 8, 9000 St. Gallen",
  );
  assert.equal(
    resolveOfferPropertyAddress({}, {
      street: "Rechnungsweg",
      streetNo: "9",
      zip: "8000",
      city: "Zürich",
    }).objectAddress,
    "Rechnungsweg 9, 8000 Zürich",
  );
  assert.equal(
    resolveOfferPropertyAddress({
      objectAddress: "Schachenstrasse 4, 9430 St. Margrethen",
    }, null).objectAddress,
    "Schachenstrasse 4, 9430 St. Margrethen",
  );
});

test("normalizes and validates the optional payout IBAN", async () => {
  const { parseOfferAcceptanceDetails } = await loadOffer();
  assert.deepEqual(parseOfferAcceptanceDetails({}), {
    propertyStreet: null,
    propertyHouseNumber: null,
    propertyZip: null,
    propertyCity: null,
    buildingNumber: null,
    parcelNumber: null,
    bankAccountHolder: null,
    bankIban: null,
  });
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

test("validates required Vollmacht and signature fields without hard IBAN validation", async () => {
  const { DEFAULT_VOLLMACHT_SIGNATURE_METHOD, parseOfferVollmachtDetails } = await loadOffer();
  const parsed = parseOfferVollmachtDetails({
      propertyStreet: " Schachenstrasse 4 ",
      propertyZip: " 9430 ",
      propertyCity: " St. Margrethen ",
      parcelNumber: " 12 ",
      landRegisterNumber: " 4567 ",
      buildingNumber: " 9876543 ",
      bankAccountHolder: " Max Muster ",
      bankName: " Musterbank ",
      bankIban: "ch93 0076 2011 6238 5295 7",
      ownerCompanyName: " Solar Home AG ",
      ownerFirstName: " Dawid ",
      ownerLastName: " Glapiak ",
      ownerBirthDate: "1990-05-20",
      ownerPhone: " +41 79 123 45 67 ",
      ownerEmail: " OWNER@EXAMPLE.CH ",
      signerName: "Ignored Customer Name",
      signatureDate: "2026-08-14",
      signatureImage: `data:image/png;base64,${TRANSPARENT_PNG}`,
    });
  const { signaturePng, ...serialized } = parsed;
  assert.deepEqual(
    serialized,
    {
      propertyStreet: "Schachenstrasse 4",
      propertyZip: "9430",
      propertyCity: "St. Margrethen",
      parcelNumber: "12",
      landRegisterNumber: "4567",
      buildingNumber: "9876543",
      bankAccountHolder: "Max Muster",
      bankName: "Musterbank",
      bankIban: "CH9300762011623852957",
      ownerCompanyName: "Solar Home AG",
      ownerFirstName: "Dawid",
      ownerLastName: "Glapiak",
      ownerBirthDate: "1990-05-20",
      ownerPhone: "+41 79 123 45 67",
      ownerEmail: "owner@example.ch",
      signerFirstName: null,
      signerLastName: null,
      signerName: "Dawid Glapiak",
      signaturePlace: null,
      signatureDate: "2026-08-14",
      signatureImage: `data:image/png;base64,${TRANSPARENT_PNG}`,
      signatureMethod: DEFAULT_VOLLMACHT_SIGNATURE_METHOD,
    },
  );
  assert.equal(signaturePng.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(
    parseOfferVollmachtDetails({
      propertyStreet: "Schachenstrasse",
      propertyZip: "9430",
      propertyCity: "St. Margrethen",
      buildingNumber: "9876543",
      bankAccountHolder: "Max Muster",
      bankName: "Musterbank",
      bankIban: "DE89370400440532013000",
      ownerBirthDate: "1990-05-20",
      ownerPhone: "+41 79 123 45 67",
      ownerEmail: "owner@example.ch",
      signerName: "Dawid Glapiak",
      signatureDate: "2026-08-14",
      signatureImage: `data:image/png;base64,${TRANSPARENT_PNG}`,
    }).bankIban,
    "DE89370400440532013000",
  );
  assert.throws(
    () => parseOfferVollmachtDetails({
      bankAccountHolder: "Max Muster",
      bankIban: "CH9300762011623852957",
    }),
    /Objektstrasse/,
  );
  assert.throws(
    () => parseOfferVollmachtDetails({
      propertyStreet: "Schachenstrasse",
      propertyZip: "9430",
      propertyCity: "St. Margrethen",
      buildingNumber: "9876543",
      bankAccountHolder: "Max Muster",
      bankName: "Musterbank",
      bankIban: "CH9300762011623852957",
      ownerBirthDate: "1990-05-20",
      ownerPhone: "+41 79 123 45 67",
      ownerEmail: "owner@example.ch",
      signerName: "Dawid Glapiak",
      signatureDate: "2026-02-30",
      signatureImage: `data:image/png;base64,${TRANSPARENT_PNG}`,
    }),
    /ungültig/,
  );
});

test("accepts the public Vollmacht street, zip, city and fullName aliases", async () => {
  const { parseOfferVollmachtDetails } = await loadOffer();
  const parsed = parseOfferVollmachtDetails({
    street: " Dorfstrasse 1 ",
    zip: " 3000 ",
    city: " Bern ",
    fullName: " Max Mustermann ",
    buildingNumber: "1234567",
    bankAccountHolder: "Max Mustermann",
    bankName: "Musterbank",
    bankIban: "CH9300762011623852957",
    ownerBirthDate: "1990-05-20",
    ownerPhone: "+41 79 123 45 67",
    ownerEmail: "max@example.ch",
    signatureDate: "2026-08-17",
    signatureImage: `data:image/png;base64,${TRANSPARENT_PNG}`,
  });

  assert.equal(parsed.propertyStreet, "Dorfstrasse 1");
  assert.equal(parsed.propertyZip, "3000");
  assert.equal(parsed.propertyCity, "Bern");
  assert.equal(parsed.signerName, "Max Mustermann");
});

test("defaults Vollmacht to required and honors an explicit false flag", async () => {
  const { isOfferVollmachtRequired } = await loadOffer();
  assert.equal(isOfferVollmachtRequired({}), true);
  assert.equal(isOfferVollmachtRequired({ data: { parts: { formDocuments: {} } } }), true);
  assert.equal(
    isOfferVollmachtRequired({ data: { parts: { formDocuments: { vollmacht: false } } } }),
    false,
  );
});

test("keeps a signed offer token valid for Vollmacht for exactly 30 days", async () => {
  const {
    OFFER_VOLLMACHT_VALIDITY_MS,
    findOfferForVollmacht,
    getOfferVollmachtExpiresAt,
    newOfferSignatureToken,
  } = await loadOffer();
  const { sha256 } = await loadOrder();
  const { token } = newOfferSignatureToken();
  const signedAt = new Date("2026-08-10T12:00:00.000Z");
  const planning = {
    offerSignatureTokenHash: sha256(token),
    offerSignatureStatus: "signed",
    offerSignedAt: signedAt,
  };
  const db = {
    collection: () => ({ findOne: async () => planning }),
  } as any;
  assert.equal(
    getOfferVollmachtExpiresAt(planning)?.toISOString(),
    new Date(signedAt.getTime() + OFFER_VOLLMACHT_VALIDITY_MS).toISOString(),
  );
  assert.equal(
    await findOfferForVollmacht(db, token, new Date(signedAt.getTime() + OFFER_VOLLMACHT_VALIDITY_MS - 1)),
    planning,
  );
  assert.equal(
    await findOfferForVollmacht(db, token, new Date(signedAt.getTime() + OFFER_VOLLMACHT_VALIDITY_MS)),
    null,
  );
});

test("serializes the public Vollmacht prefill without exposing token data", async () => {
  const { buildOfferVollmachtResponse } = await loadOffer();
  const req = new Request("https://app.helionic.ch/api/public/offer-signature/token/vollmacht");
  const response = buildOfferVollmachtResponse({
    planning: {
      planningNumber: "ANG-2026-3499",
      orderId: "AUF-2026-0007",
      offerSignedAt: new Date("2026-08-10T12:00:00.000Z"),
      offerConfirmationPdfFileId: "file-id",
      offerVollmachtPdfFileId: "64f000000000000000000099",
      propertyStreet: "Schachenstrasse 4, 9430 St. Margrethen SG, 9430 St. Margrethen SG",
      propertyHouseNumber: "4",
      propertyZip: "9430",
      propertyCity: "St. Margrethen",
      parcelNumber: "1042",
      landRegisterNumber: "4567",
      subsidyPayoutAccountHolder: "Max Muster",
      subsidyPayoutIban: "CH9300762011623852957",
      summary: { customerName: "Max Muster" },
      data: { parts: { formDocuments: { vollmacht: true } } },
    },
    company: {
      name: "Demo AG",
      uid: "CHE-123.456.789",
      branding: { logoUrl: "https://example.ch/logo.png" },
      address: { street: "Firmenweg 2", zip: "9000", city: "St. Gallen" },
      contact: {
        phone: "+41 71 123 45 67",
        email: "info@demo.ch",
        website: "https://demo.ch",
      },
    },
    customer: { email: "max@example.ch" },
    token: "public-token",
    req,
  });
  assert.equal(response.submitted, false);
  assert.equal(response.vollmachtRequired, true);
  assert.equal(response.objectAddress, "Schachenstrasse 4, 9430 St. Margrethen");
  assert.equal(response.propertyStreet, "Schachenstrasse 4");
  assert.equal(response.propertyZip, "9430");
  assert.equal(response.propertyCity, "St. Margrethen");
  assert.equal(response.parcelNumber, null);
  assert.equal(response.landRegisterNumber, null);
  assert.equal(response.buildingNumber, null);
  assert.equal(response.customerEmail, "max@example.ch");
  assert.equal(response.customerName, "Max Muster");
  assert.equal(response.bankAccountHolder, "Max Muster");
  assert.equal(response.bankIban, "CH9300762011623852957");
  assert.equal(response.companyStreet, "Firmenweg 2");
  assert.equal(response.companyZip, "9000");
  assert.equal(response.companyCity, "St. Gallen");
  assert.equal(response.companyUid, "CHE-123.456.789");
  assert.equal(response.companyPhone, "+41 71 123 45 67");
  assert.equal(response.companyEmail, "info@demo.ch");
  assert.equal(response.companyWebsite, "https://demo.ch");
  assert.match(String(response.confirmationPdfUrl), /type=confirmation$/);
  assert.match(String(response.vollmachtPdfUrl), /vollmacht\?download=1$/);
  assert.equal("offerSignatureTokenHash" in response, false);
  assert.equal("signaturePlace" in response, false);
});

test("returns only customer-submitted cadastral Vollmacht fields", async () => {
  const { buildOfferVollmachtResponse } = await loadOffer();
  const response = buildOfferVollmachtResponse({
    planning: {
      offerSignedAt: new Date("2026-08-10T12:00:00.000Z"),
      vollmachtSubmittedAt: new Date("2026-08-11T12:00:00.000Z"),
      parcelNumber: "AUTO-IGNORED-WHEN-DEDICATED-EXISTS",
      vollmachtParcelNumber: "12",
      vollmachtLandRegisterNumber: "4567",
      vollmachtBuildingNumber: "9876543",
      vollmachtBankName: "Musterbank",
      vollmachtOwnerCompanyName: "Solar Home AG",
      vollmachtOwnerBirthDate: "1990-05-20",
      vollmachtOwnerPhone: "+41 79 123 45 67",
      vollmachtOwnerEmail: "owner@example.ch",
    },
    company: null,
    customer: null,
    token: "public-token",
    req: new Request("https://planner.helionic.ch/api/public/offer-signature/token/vollmacht"),
  });
  assert.equal(response.parcelNumber, "12");
  assert.equal(response.landRegisterNumber, "4567");
  assert.equal(response.buildingNumber, "9876543");
  assert.equal(response.bankName, "Musterbank");
  assert.equal(response.ownerCompanyName, "Solar Home AG");
  assert.equal(response.ownerBirthDate, "1990-05-20");
  assert.equal(response.ownerPhone, "+41 79 123 45 67");
  assert.equal(response.ownerEmail, "owner@example.ch");
});

test("resolves the public customer phone and exact Vollmacht append flag", async () => {
  const { resolvePublicCustomerPhone } = await loadOffer();
  const { shouldAppendVollmachtPage } = await import("../src/lib/planningDocuments");
  assert.equal(
    resolvePublicCustomerPhone({ data: { profile: { contactMobile: "+41 79 111 22 33" } } }, { phone: "fallback" }),
    "+41 79 111 22 33",
  );
  assert.equal(shouldAppendVollmachtPage({ data: { parts: { formDocuments: { vollmacht: true } } } }, "angebot"), true);
  assert.equal(shouldAppendVollmachtPage({ data: { parts: { formDocuments: {} } } }, "angebot"), false);
  assert.equal(shouldAppendVollmachtPage({ data: { parts: { formDocuments: { vollmacht: true } } } }, "auftrag"), false);
});

test("creates signed offer and confirmation PDFs with protocol pages", async () => {
  const {
    appendOfferConfirmationSignatureProtocol,
    createOfferConfirmationPdf,
    createOfferVollmachtPdf,
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
    documentKind: "Angebot",
    openedAt: new Date("2026-08-10T11:55:00.000Z"),
    tokenId: sha256("token"),
    signaturePlace: "onsite_customer",
  });
  const loadedSignedOffer = await PDFDocument.load(signedOffer);
  assert.equal(loadedSignedOffer.getPageCount(), 2);
  assert.equal(loadedSignedOffer.getTitle(), "Angebot OFF-2026-0042 - unterschrieben");

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
    landRegisterNumber: "4567",
    bankAccountHolder: "Nicola Rizzoli",
    bankIban: "CH9300762011623852957",
    withdrawalRightApplies: true,
    withdrawalUntil: new Date("2026-08-24T12:00:00.000Z"),
  });
  const loadedConfirmation = await PDFDocument.load(confirmation);
  assert.equal(loadedConfirmation.getPageCount(), 2);
  assert.equal(loadedConfirmation.getTitle(), "Auftragsbestätigung AUF-2026-0007");

  const vollmacht = await createOfferVollmachtPdf({
    company: {
      name: "Demo Solar AG",
      uid: "CHE-123.456.789",
      address: { street: "Musterweg 1", zip: "8000", city: "Zürich" },
      contact: { email: "info@example.ch", phone: "+41 44 123 45 67", website: "example.ch" },
    },
    orderId: "AUF-2026-0007",
    offerNumber: "OFF-2026-0042",
    customerName: "MUSTER MÜLLER",
    propertyStreet: "Ulica Słupska 4",
    propertyZip: "9430",
    propertyCity: "St. Margrethen",
    parcelNumber: "12",
    landRegisterNumber: "4567",
    buildingNumber: "9876543",
    bankAccountHolder: "Max Muster",
    bankName: "Musterbank",
    bankIban: "CH9300762011623852957",
    ownerCompanyName: "Solar Home AG",
    ownerFirstName: "Dawid",
    ownerLastName: "Glapiak",
    ownerBirthDate: "1990-05-20",
    ownerPhone: "+41 79 123 45 67",
    ownerEmail: "owner@example.ch",
    signerName: "Dawid Glapiak",
    signatureDate: "2026-08-14",
    signaturePng: Buffer.from(TRANSPARENT_PNG, "base64"),
    signatureMethod: "Einfache elektronische Signatur (EES) - online, getippt",
    submittedAt: signedAt,
  });
  const loadedVollmacht = await PDFDocument.load(vollmacht);
  assert.equal(loadedVollmacht.getPageCount(), 1);
  assert.equal(loadedVollmacht.getTitle(), "Vollmacht AUF-2026-0007");

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
  assert.equal(loadedSignedConfirmation.getTitle(), "Auftragsbestätigung AUF-2026-0007 - unterschrieben");
});
