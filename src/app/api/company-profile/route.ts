import { MongoClient, ObjectId } from "mongodb";
import crypto from "crypto";
import { getCorsHeaders } from "@/lib/cors";

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

function jsonResponse(origin: string | null, body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...getCorsHeaders(origin),
    },
  });
}

function buildDefaultCompanyProfile(company: any) {
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
    companyObjectId = new ObjectId(String(session.activeCompanyId));
  } catch {
    return jsonResponse(origin, { ok: false, error: "Invalid activeCompanyId" }, 400);
  }

  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db();
    const companies = db.collection("companies");

    const company = await companies.findOne({ _id: companyObjectId });

    if (!company) {
      return jsonResponse(origin, { ok: false, error: "Company not found" }, 404);
    }

    return jsonResponse(origin, {
      ok: true,
      companyProfile: buildDefaultCompanyProfile(company),
    });
  } catch (e: any) {
    console.error("GET COMPANY PROFILE ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message || "Unknown error" },
      500
    );
  } finally {
    await client.close().catch(() => {});
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
    companyObjectId = new ObjectId(String(session.activeCompanyId));
  } catch {
    return jsonResponse(origin, { ok: false, error: "Invalid activeCompanyId" }, 400);
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return jsonResponse(origin, { ok: false, error: "Invalid JSON body" }, 400);
  }

  const normalized = normalizePatchInput(body);
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db();
    const companies = db.collection("companies");

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

    return jsonResponse(origin, {
      ok: true,
      companyProfile: buildDefaultCompanyProfile(company),
    });
  } catch (e: any) {
    console.error("PATCH COMPANY PROFILE ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message || "Unknown error" },
      500
    );
  } finally {
    await client.close().catch(() => {});
  }
}