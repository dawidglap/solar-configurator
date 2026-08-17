import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import crypto from "crypto";
import { getCorsHeaders } from "@/lib/cors";
import { enforceActiveSubscription } from "@/lib/subscription";
import {
  companyIdToObjectId,
  getCompanyDocumentsMap,
  getPublicCompanyDocumentUrl,
  ensureCompanyDocumentIndexes,
} from "@/lib/companyDocuments";

export const runtime = "nodejs";

/* ---------------- CORS OPTIONS ---------------- */

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

/* ---------------- Session helpers ---------------- */

function sign(payload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function getCookie(req: Request, name: string) {
  const cookie = req.headers.get("cookie") || "";
  const parts = cookie.split(";").map((p) => p.trim());
  const found = parts.find((p) => p.startsWith(name + "="));
  return found ? decodeURIComponent(found.split("=").slice(1).join("=")) : null;
}

function readSession(req: Request, secret: string) {
  const token = getCookie(req, "session");
  if (!token) return null;

  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  if (sign(payload, secret) !== sig) return null;

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/* ---------------- Helpers ---------------- */

function safeString(v: unknown) {
  return typeof v === "string" ? v.trim() : "";
}

function safeBoolean(v: unknown, fallback = false) {
  return typeof v === "boolean" ? v : fallback;
}

function safeNullableObjectIdString(v: unknown) {
  const s = safeString(v);
  if (!s) return null;
  try {
    return String(new ObjectId(s));
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}

function deepMergeProfile(base: any, patch: any): any {
  if (!isPlainObject(patch)) return patch;
  const merged: Record<string, any> = isPlainObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (["__proto__", "prototype", "constructor"].includes(key) || value === undefined) continue;
    merged[key] = isPlainObject(value) ? deepMergeProfile(merged[key], value) : value;
  }
  return merged;
}

function normalizeQrBill(value: any) {
  const referenceType = safeString(value?.referenceType).toUpperCase();
  const language = safeString(value?.language).toLowerCase();
  return {
    enabled: typeof value?.enabled === "boolean" ? value.enabled : true,
    referenceType: ["QRR", "SCOR", "NON"].includes(referenceType) ? referenceType : "NON",
    qrIban: safeString(value?.qrIban),
    language: ["de", "fr", "it", "en"].includes(language) ? language : "de",
    creditor: {
      street: safeString(value?.creditor?.street),
      houseNumber: safeString(value?.creditor?.houseNumber),
      zip: safeString(value?.creditor?.zip),
      city: safeString(value?.creditor?.city),
      country: safeString(value?.creditor?.country).toUpperCase(),
    },
  };
}

function jsonResponse(origin: string | null, body: any, status = 200) {
  const payload =
    body &&
    typeof body === "object" &&
    body.ok === false &&
    !safeString(body.message) &&
    safeString(body.error)
      ? { ...body, message: safeString(body.error) }
      : body;
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...getCorsHeaders(origin),
    },
  });
}

function buildDefaultCompanyProfile(company: any, documents?: any, agbUrl: string | null = null) {
  const normalizedDocuments = documents?.agb
    ? { agb: { ...documents.agb, url: agbUrl || documents.agb.url } }
    : {};
  return {
    id: String(company?._id ?? ""),
    name: safeString(company?.name),

    legalForm: safeString(company?.legalForm),
    uid: safeString(company?.uid),
    vatNumber: safeString(company?.vatNumber),
    commercialRegisterNumber: safeString(company?.commercialRegisterNumber),

    address: {
      street: safeString(company?.address?.street),
      zip: safeString(company?.address?.zip),
      city: safeString(company?.address?.city),
      country: safeString(company?.address?.country) || "Schweiz",
    },

    contact: {
      phone: safeString(company?.contact?.phone),
      mobile: safeString(company?.contact?.mobile),
      email: safeString(company?.contact?.email),
      website: safeString(company?.contact?.website),
    },

    billing: {
      bankName: safeString(company?.billing?.bankName),
      iban: safeString(company?.billing?.iban),
      bic: safeString(company?.billing?.bic),
      accountHolder: safeString(company?.billing?.accountHolder),
    },

    bank: {
      bankName: safeString(company?.bank?.bankName) || safeString(company?.billing?.bankName),
      iban: safeString(company?.bank?.iban) || safeString(company?.billing?.iban),
      accountHolder:
        safeString(company?.bank?.accountHolder) || safeString(company?.billing?.accountHolder),
      bicSwift: safeString(company?.bank?.bicSwift) || safeString(company?.billing?.bic),
    },

    qrBill: normalizeQrBill(company?.qrBill),

    paymentDefaults: {
      termDays:
        typeof company?.paymentDefaults?.termDays === "number"
          ? company.paymentDefaults.termDays
          : 30,
      currency: safeString(company?.paymentDefaults?.currency) || "CHF",
      dunningFees: Array.isArray(company?.paymentDefaults?.dunningFees)
        ? company.paymentDefaults.dunningFees.map((value: unknown) => Number(value) || 0)
        : [],
      dunningTermDays:
        typeof company?.paymentDefaults?.dunningTermDays === "number"
          ? company.paymentDefaults.dunningTermDays
          : 10,
    },

    templates: {
      invoiceText: safeString(company?.templates?.invoiceText),
    },

    branding: {
      logoUrl: safeString(company?.branding?.logoUrl),
      primaryColor: safeString(company?.branding?.primaryColor) || "#3DBBA0",
    },

    defaults: {
      language: safeString(company?.defaults?.language) || "de",
      currency: safeString(company?.defaults?.currency) || "CHF",
      timezone: safeString(company?.defaults?.timezone) || "Europe/Zurich",
    },

    pdfSettings: {
      showLogo: safeBoolean(company?.pdfSettings?.showLogo, true),
      showFooter: safeBoolean(company?.pdfSettings?.showFooter, true),

      footerCompanyName: safeString(company?.pdfSettings?.footerCompanyName),
      footerAddressLine: safeString(company?.pdfSettings?.footerAddressLine),
      footerEmail: safeString(company?.pdfSettings?.footerEmail),
      footerWebsite: safeString(company?.pdfSettings?.footerWebsite),
      footerPhone: safeString(company?.pdfSettings?.footerPhone),
      footerMobile: safeString(company?.pdfSettings?.footerMobile),
      footerBankName: safeString(company?.pdfSettings?.footerBankName),
      footerAccountHolder: safeString(company?.pdfSettings?.footerAccountHolder),
      footerIban: safeString(company?.pdfSettings?.footerIban),
      footerBic: safeString(company?.pdfSettings?.footerBic),
      footerVatNumber: safeString(company?.pdfSettings?.footerVatNumber),
      footerUidNumber: safeString(company?.pdfSettings?.footerUidNumber),
    },

    defaultContacts: {
      offerSignerUserId: safeNullableObjectIdString(
        company?.defaultContacts?.offerSignerUserId
      ),
      offerAdvisorUserId: safeNullableObjectIdString(
        company?.defaultContacts?.offerAdvisorUserId
      ),
    },

    agbUrl,
    agbAvailable: Boolean(normalizedDocuments.agb),
    documents: normalizedDocuments,

    createdAt: company?.createdAt ?? null,
    updatedAt: company?.updatedAt ?? null,
  };
}

function normalizePatchInput(body: any) {
  return {
    name: safeString(body?.name),

    legalForm: safeString(body?.legalForm),
    uid: safeString(body?.uid),
    vatNumber: safeString(body?.vatNumber),
    commercialRegisterNumber: safeString(body?.commercialRegisterNumber),

    address: {
      street: safeString(body?.address?.street),
      zip: safeString(body?.address?.zip),
      city: safeString(body?.address?.city),
      country: safeString(body?.address?.country) || "Schweiz",
    },

    contact: {
      phone: safeString(body?.contact?.phone),
      mobile: safeString(body?.contact?.mobile),
      email: safeString(body?.contact?.email),
      website: safeString(body?.contact?.website),
    },

    billing: {
      bankName: safeString(body?.billing?.bankName),
      iban: safeString(body?.billing?.iban),
      bic: safeString(body?.billing?.bic),
      accountHolder: safeString(body?.billing?.accountHolder),
    },

    bank: {
      bankName: safeString(body?.bank?.bankName),
      iban: safeString(body?.bank?.iban),
      accountHolder: safeString(body?.bank?.accountHolder),
      bicSwift: safeString(body?.bank?.bicSwift),
    },

    qrBill: normalizeQrBill(body?.qrBill),

    paymentDefaults: {
      termDays:
        typeof body?.paymentDefaults?.termDays === "number"
          ? body.paymentDefaults.termDays
          : 30,
      currency: safeString(body?.paymentDefaults?.currency) || "CHF",
      dunningFees: Array.isArray(body?.paymentDefaults?.dunningFees)
        ? body.paymentDefaults.dunningFees.map((value: unknown) => Number(value) || 0)
        : [],
      dunningTermDays:
        typeof body?.paymentDefaults?.dunningTermDays === "number"
          ? body.paymentDefaults.dunningTermDays
          : 10,
    },

    templates: {
      invoiceText: safeString(body?.templates?.invoiceText),
    },

    branding: {
      logoUrl: safeString(body?.branding?.logoUrl),
      primaryColor: safeString(body?.branding?.primaryColor) || "#3DBBA0",
    },

    defaults: {
      language: safeString(body?.defaults?.language) || "de",
      currency: safeString(body?.defaults?.currency) || "CHF",
      timezone: safeString(body?.defaults?.timezone) || "Europe/Zurich",
    },

    pdfSettings: {
      showLogo: safeBoolean(body?.pdfSettings?.showLogo, true),
      showFooter: safeBoolean(body?.pdfSettings?.showFooter, true),

      footerCompanyName: safeString(body?.pdfSettings?.footerCompanyName),
      footerAddressLine: safeString(body?.pdfSettings?.footerAddressLine),
      footerEmail: safeString(body?.pdfSettings?.footerEmail),
      footerWebsite: safeString(body?.pdfSettings?.footerWebsite),
      footerPhone: safeString(body?.pdfSettings?.footerPhone),
      footerMobile: safeString(body?.pdfSettings?.footerMobile),
      footerBankName: safeString(body?.pdfSettings?.footerBankName),
      footerAccountHolder: safeString(body?.pdfSettings?.footerAccountHolder),
      footerIban: safeString(body?.pdfSettings?.footerIban),
      footerBic: safeString(body?.pdfSettings?.footerBic),
      footerVatNumber: safeString(body?.pdfSettings?.footerVatNumber),
      footerUidNumber: safeString(body?.pdfSettings?.footerUidNumber),
    },

    defaultContacts: {
      offerSignerUserId: safeNullableObjectIdString(
        body?.defaultContacts?.offerSignerUserId
      ),
      offerAdvisorUserId: safeNullableObjectIdString(
        body?.defaultContacts?.offerAdvisorUserId
      ),
    },
  };
}

/* ---------------- GET ---------------- */

export async function GET(req: Request) {
  const origin = req.headers.get("origin");

  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  if (!uri) {
    return jsonResponse(origin, { ok: false, error: "Missing MONGODB_URI" }, 500);
  }

  if (!secret) {
    return jsonResponse(origin, { ok: false, error: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }

  let companyObjectId: ObjectId;
  try {
    companyObjectId = companyIdToObjectId(String(session.activeCompanyId));
  } catch {
    return jsonResponse(origin, { ok: false, error: "Invalid activeCompanyId" }, 400);
  }


  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session as any);
    if (subscriptionError) return subscriptionError;
    const companies = db.collection("companies");
    await ensureCompanyDocumentIndexes(db);

    const company = await companies.findOne({ _id: companyObjectId });

    if (!company) {
      return jsonResponse(origin, { ok: false, error: "Company not found" }, 404);
    }

    const documents = await getCompanyDocumentsMap(db, String(session.activeCompanyId));
    const agbUrl = documents.agb
      ? getPublicCompanyDocumentUrl({
          baseUrl: new URL(req.url).origin,
          companyId: String(session.activeCompanyId),
          document: documents.agb,
          secret,
        })
      : null;

    const companyProfile = buildDefaultCompanyProfile(company, documents, agbUrl);
    return jsonResponse(origin, {
      ok: true,
      companyProfile,
      ...companyProfile,
    });
  } catch (e: any) {
    console.error("GET COMPANY PROFILE ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message || "Unknown error" },
      500
    );
  }
}

/* ---------------- PATCH ---------------- */

export async function PATCH(req: Request) {
  const origin = req.headers.get("origin");

  const uri = process.env.MONGODB_URI;
  const secret = process.env.SESSION_SECRET;

  if (!uri) {
    return jsonResponse(origin, { ok: false, error: "Missing MONGODB_URI" }, 500);
  }

  if (!secret) {
    return jsonResponse(origin, { ok: false, error: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }

  let companyObjectId: ObjectId;
  try {
    companyObjectId = companyIdToObjectId(String(session.activeCompanyId));
  } catch {
    return jsonResponse(origin, { ok: false, error: "Invalid activeCompanyId" }, 400);
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return jsonResponse(origin, { ok: false, error: "Invalid JSON body" }, 400);
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session as any);
    if (subscriptionError) return subscriptionError;
    const companies = db.collection("companies");
    const existingCompany = await companies.findOne({ _id: companyObjectId });
    const normalized = normalizePatchInput(deepMergeProfile(existingCompany ?? {}, body));

    const updateDoc = {
      $set: {
        name: normalized.name || "Ihre Firma",

        legalForm: normalized.legalForm,
        uid: normalized.uid,
        vatNumber: normalized.vatNumber,
        commercialRegisterNumber: normalized.commercialRegisterNumber,

        address: normalized.address,
        contact: normalized.contact,
        billing: normalized.billing,
        bank: normalized.bank,
        qrBill: normalized.qrBill,
        paymentDefaults: normalized.paymentDefaults,
        templates: normalized.templates,
        branding: normalized.branding,
        defaults: normalized.defaults,
        pdfSettings: normalized.pdfSettings,
        defaultContacts: {
          offerSignerUserId: normalized.defaultContacts.offerSignerUserId
            ? new ObjectId(normalized.defaultContacts.offerSignerUserId)
            : null,
          offerAdvisorUserId: normalized.defaultContacts.offerAdvisorUserId
            ? new ObjectId(normalized.defaultContacts.offerAdvisorUserId)
            : null,
        },

        updatedAt: new Date(),
      },
      $setOnInsert: {
        createdAt: new Date(),
      },
    };

    await companies.updateOne({ _id: companyObjectId }, updateDoc);

    const company = await companies.findOne({ _id: companyObjectId });
    await ensureCompanyDocumentIndexes(db);
    const documents = await getCompanyDocumentsMap(db, String(session.activeCompanyId));
    const agbUrl = documents.agb
      ? getPublicCompanyDocumentUrl({
          baseUrl: new URL(req.url).origin,
          companyId: String(session.activeCompanyId),
          document: documents.agb,
          secret,
        })
      : null;

    const companyProfile = buildDefaultCompanyProfile(company, documents, agbUrl);
    return jsonResponse(origin, {
      ok: true,
      companyProfile,
      ...companyProfile,
    });
  } catch (e: any) {
    console.error("PATCH COMPANY PROFILE ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message || "Unknown error" },
      500
    );
  }
}
