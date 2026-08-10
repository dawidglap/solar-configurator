import type { Db } from "mongodb";
import { activeDocumentFilter } from "@/lib/trash";

type CustomerType = "private" | "company";

export const CUSTOMER_PUBLIC_PROJECTION = {
  _id: 1,
  companyId: 1,
  type: 1,
  name: 1,
  salutation: 1,
  firstName: 1,
  lastName: 1,
  companyName: 1,
  contactPerson: 1,
  legalForm: 1,
  email: 1,
  phone: 1,
  mobile: 1,
  businessPhone: 1,
  businessMobile: 1,
  businessEmail: 1,
  street: 1,
  streetNo: 1,
  zip: 1,
  city: 1,
  country: 1,
  buildingStreet: 1,
  buildingStreetNo: 1,
  buildingZip: 1,
  buildingCity: 1,
  egid: 1,
  buildingNumber: 1,
  buildingNumberSource: 1,
  parcelNumber: 1,
  parcelNumberSource: 1,
  geoAdminFeatureId: 1,
  geoAdminEasting: 1,
  geoAdminNorthing: 1,
  geoAdminResolvedAt: 1,
  subsidyPayoutAccountHolder: 1,
  subsidyPayoutIban: 1,
  source: 1,
  tags: 1,
  address: 1,
  notes: 1,
  createdAt: 1,
  updatedAt: 1,
} as const;

const PATCHABLE_CUSTOMER_STRING_FIELDS = [
  "name",
  "salutation",
  "firstName",
  "lastName",
  "companyName",
  "contactPerson",
  "legalForm",
  "phone",
  "mobile",
  "businessPhone",
  "businessMobile",
  "street",
  "streetNo",
  "zip",
  "city",
  "buildingStreet",
  "buildingStreetNo",
  "buildingZip",
  "buildingCity",
  "egid",
  "buildingNumber",
  "parcelNumber",
  "source",
  "address",
  "notes",
] as const;

export function safeCustomerString(v: unknown) {
  return typeof v === "string" ? v.trim() : "";
}

export function normalizeStoredCustomerTags(v: unknown) {
  if (!Array.isArray(v)) return [];
  return Array.from(
    new Set(v.map((value) => safeCustomerString(value)).filter(Boolean)),
  );
}

export function normalizeCustomerEmail(v: unknown) {
  return safeCustomerString(v).toLowerCase();
}

export function normalizeStoredCustomerString(v: unknown) {
  const value = safeCustomerString(v);
  return value || null;
}

export function normalizeStoredCustomerEmail(v: unknown) {
  const value = normalizeCustomerEmail(v);
  return value || null;
}

export function normalizeStoredCustomerCountry(v: unknown) {
  const value = safeCustomerString(v).toUpperCase();
  return /^[A-Z]{2}$/.test(value) ? value : "CH";
}

export function computeCustomerAddress(doc: any) {
  const street = safeCustomerString(doc?.street);
  const streetNo = safeCustomerString(doc?.streetNo);
  const zip = safeCustomerString(doc?.zip);
  const city = safeCustomerString(doc?.city);
  const streetLine = [street, streetNo].filter(Boolean).join(" ").trim();
  const placeLine = [zip, city].filter(Boolean).join(" ").trim();
  const computed = [streetLine, placeLine].filter(Boolean).join(", ").trim();
  return computed || safeCustomerString(doc?.address);
}

export function normalizeCustomerDoc(doc: any) {
  return {
    id: String(doc._id),
    companyId: safeCustomerString(doc.companyId),
    type: doc.type ?? "private",
    name:
      safeCustomerString(doc.name) ||
      safeCustomerString(doc.companyName) ||
      [safeCustomerString(doc.firstName), safeCustomerString(doc.lastName)]
        .filter(Boolean)
        .join(" ")
        .trim(),
    salutation: doc.salutation ?? "",
    firstName: doc.firstName ?? "",
    lastName: doc.lastName ?? "",
    company: doc.companyName ?? "",
    companyName: doc.companyName ?? "",
    contactPerson: doc.contactPerson ?? "",
    legalForm: doc.legalForm ?? "",
    email: doc.email ?? "",
    phone: doc.phone ?? "",
    mobile: doc.mobile ?? "",
    businessPhone: doc.businessPhone ?? "",
    businessMobile: doc.businessMobile ?? "",
    businessEmail: doc.businessEmail ?? "",
    street: doc.street ?? "",
    streetNo: doc.streetNo ?? "",
    zip: doc.zip ?? "",
    city: doc.city ?? "",
    country: normalizeStoredCustomerCountry(doc.country),
    buildingStreet: doc.buildingStreet ?? "",
    buildingStreetNo: doc.buildingStreetNo ?? "",
    buildingZip: doc.buildingZip ?? "",
    buildingCity: doc.buildingCity ?? "",
    egid: doc.egid ?? null,
    buildingNumber: doc.buildingNumber ?? doc.egid ?? null,
    buildingNumberSource: doc.buildingNumberSource === "manual" ? "manual" : "auto",
    parcelNumber: doc.parcelNumber ?? null,
    parcelNumberSource: doc.parcelNumberSource === "manual" ? "manual" : "auto",
    subsidyPayoutAccountHolder: doc.subsidyPayoutAccountHolder ?? "",
    subsidyPayoutIban: doc.subsidyPayoutIban ?? "",
    source: doc.source ?? "",
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    address: computeCustomerAddress(doc),
    notes: doc.notes ?? "",
    createdAt: doc.createdAt ?? null,
    updatedAt: doc.updatedAt ?? null,
  };
}

export function buildCustomerCreateDoc(body: any, companyId: string) {
  const type: CustomerType = body?.type === "company" ? "company" : "private";
  const doc: Record<string, any> = {
    companyId,
    type,
    name: safeCustomerString(body?.name) || null,
    salutation: normalizeStoredCustomerString(body?.salutation),
    firstName: normalizeStoredCustomerString(body?.firstName),
    lastName: normalizeStoredCustomerString(body?.lastName),
    companyName: normalizeStoredCustomerString(body?.companyName ?? body?.company),
    contactPerson: normalizeStoredCustomerString(body?.contactPerson),
    legalForm: normalizeStoredCustomerString(body?.legalForm),
    email: normalizeStoredCustomerEmail(body?.email),
    phone: normalizeStoredCustomerString(body?.phone),
    mobile: normalizeStoredCustomerString(body?.mobile),
    businessPhone: normalizeStoredCustomerString(body?.businessPhone),
    businessMobile: normalizeStoredCustomerString(body?.businessMobile),
    businessEmail: normalizeStoredCustomerEmail(body?.businessEmail),
    street: normalizeStoredCustomerString(body?.street),
    streetNo: normalizeStoredCustomerString(body?.streetNo),
    zip: normalizeStoredCustomerString(body?.zip),
    city: normalizeStoredCustomerString(body?.city),
    country: normalizeStoredCustomerCountry(body?.country),
    buildingStreet: normalizeStoredCustomerString(body?.buildingStreet),
    buildingStreetNo: normalizeStoredCustomerString(body?.buildingStreetNo),
    buildingZip: normalizeStoredCustomerString(body?.buildingZip),
    buildingCity: normalizeStoredCustomerString(body?.buildingCity),
    egid: normalizeStoredCustomerString(body?.egid),
    buildingNumber: normalizeStoredCustomerString(body?.buildingNumber ?? body?.egid),
    buildingNumberSource:
      body?.buildingNumberSource === "manual" ||
      (safeCustomerString(body?.buildingNumber ?? body?.egid) &&
        body?.buildingNumberSource !== "auto")
        ? "manual"
        : "auto",
    parcelNumber: normalizeStoredCustomerString(body?.parcelNumber),
    parcelNumberSource: body?.parcelNumberSource === "manual" ||
      (safeCustomerString(body?.parcelNumber) && body?.parcelNumberSource !== "auto")
      ? "manual"
      : "auto",
    geoAdminFeatureId: null,
    geoAdminEasting: null,
    geoAdminNorthing: null,
    geoAdminResolvedAt: null,
    subsidyPayoutAccountHolder: normalizeStoredCustomerString(body?.subsidyPayoutAccountHolder),
    subsidyPayoutIban: normalizeStoredCustomerString(body?.subsidyPayoutIban)?.replace(/\s+/g, "").toUpperCase() || null,
    source: normalizeStoredCustomerString(body?.source),
    tags: normalizeStoredCustomerTags(body?.tags),
    notes: normalizeStoredCustomerString(body?.notes),
  };
  doc.address = computeCustomerAddress(doc) || normalizeStoredCustomerString(body?.address);
  return doc;
}

export function buildCustomerPatchSet(body: any) {
  const setObj: Record<string, any> = {
    updatedAt: new Date(),
  };
  const hasOwn = (key: string) => Object.prototype.hasOwnProperty.call(body, key);

  if (hasOwn("type")) {
    setObj.type = body?.type === "company" ? "company" : "private";
  }

  if (hasOwn("email")) {
    setObj.email = normalizeStoredCustomerEmail(body?.email);
  }

  if (hasOwn("companyName") || hasOwn("company")) {
    setObj.companyName = normalizeStoredCustomerString(body?.companyName ?? body?.company);
  }

  if (hasOwn("country")) {
    setObj.country = normalizeStoredCustomerCountry(body?.country);
  }

  if (hasOwn("tags")) {
    setObj.tags = normalizeStoredCustomerTags(body?.tags);
  }

  if (hasOwn("parcelNumberSource")) {
    setObj.parcelNumberSource = body?.parcelNumberSource === "manual" ? "manual" : "auto";
  } else if (hasOwn("parcelNumber")) {
    setObj.parcelNumberSource = "manual";
  }

  if (hasOwn("buildingNumberSource")) {
    setObj.buildingNumberSource = body?.buildingNumberSource === "manual" ? "manual" : "auto";
  } else if (hasOwn("buildingNumber") || hasOwn("egid")) {
    setObj.buildingNumberSource = "manual";
  }

  for (const field of PATCHABLE_CUSTOMER_STRING_FIELDS) {
    if (!hasOwn(field)) continue;
    setObj[field] = normalizeStoredCustomerString(body?.[field]);
  }

  const shouldRecomputeAddress =
    hasOwn("address") ||
    hasOwn("street") ||
    hasOwn("streetNo") ||
    hasOwn("zip") ||
    hasOwn("city");

  if (shouldRecomputeAddress) {
    const computed = computeCustomerAddress({
      street: setObj.street,
      streetNo: setObj.streetNo,
      zip: setObj.zip,
      city: setObj.city,
      address: setObj.address,
    });
    setObj.address = computed || normalizeStoredCustomerString(body?.address);
  }

  return setObj;
}

export function buildCustomerDedupFilter(input: {
  companyId: string;
  type: CustomerType;
  email?: unknown;
  companyName?: unknown;
  firstName?: unknown;
  lastName?: unknown;
}) {
  const companyId = safeCustomerString(input.companyId);
  const email = normalizeCustomerEmail(input.email);
  const companyName = safeCustomerString(input.companyName);
  const firstName = safeCustomerString(input.firstName);
  const lastName = safeCustomerString(input.lastName);

  if (email) {
    return {
      filter: {
        companyId,
        email,
        duplicateOfCustomerId: null,
        ...activeDocumentFilter(),
      },
      key: "email" as const,
    };
  }

  if (input.type === "company") {
    return {
      filter: {
        companyId,
        companyName,
        duplicateOfCustomerId: null,
        ...activeDocumentFilter(),
      },
      key: "companyName" as const,
    };
  }

  return {
    filter: {
      companyId,
      firstName,
      lastName,
      duplicateOfCustomerId: null,
      ...activeDocumentFilter(),
    },
    key: "personName" as const,
  };
}

let ensureCustomerIndexesPromise: Promise<void> | null = null;

export function ensureCustomerIndexes(db: Db) {
  if (!ensureCustomerIndexesPromise) {
    ensureCustomerIndexesPromise = (async () => {
      const customers = db.collection("customers");

      for (const indexName of [
        "uniq_company_email_nonempty",
        "uniq_company_private_name_without_email",
        "uniq_company_company_name",
        "uniq_company_email_active_v2",
        "uniq_company_private_name_without_email_active_v2",
        "uniq_company_company_name_active_v2",
      ]) {
        try {
          await customers.dropIndex(indexName);
        } catch {}
      }

      await customers.updateMany(
        { deletedAt: { $exists: false } },
        { $set: { deletedAt: null } }
      );
      await customers.updateMany(
        { duplicateOfCustomerId: { $exists: false } },
        { $set: { duplicateOfCustomerId: null } }
      );
      await customers.updateMany({ email: "" }, { $set: { email: null } });
      await customers.updateMany(
        { companyName: "" },
        { $set: { companyName: null } }
      );
      await customers.updateMany(
        { firstName: "" },
        { $set: { firstName: null } }
      );
      await customers.updateMany(
        { lastName: "" },
        { $set: { lastName: null } }
      );
      await customers.updateMany(
        { $or: [{ country: { $exists: false } }, { country: null }, { country: "" }] },
        { $set: { country: "CH" } },
      );

      await customers.createIndex(
        { companyId: 1, email: 1 },
        {
          name: "uniq_company_email_active_v2",
          unique: true,
          partialFilterExpression: {
            duplicateOfCustomerId: null,
            deletedAt: null,
            email: { $type: "string" },
          },
        }
      );

      await customers.createIndex(
        { companyId: 1, firstName: 1, lastName: 1 },
        {
          name: "uniq_company_private_name_without_email_active_v2",
          unique: true,
          partialFilterExpression: {
            duplicateOfCustomerId: null,
            deletedAt: null,
            type: "private",
            email: null,
            firstName: { $type: "string" },
            lastName: { $type: "string" },
          },
        }
      );

      await customers.createIndex(
        { companyId: 1, companyName: 1 },
        {
          name: "uniq_company_company_name_active_v2",
          unique: true,
          partialFilterExpression: {
            duplicateOfCustomerId: null,
            deletedAt: null,
            type: "company",
            companyName: { $type: "string" },
          },
        }
      );
    })().catch((error) => {
      ensureCustomerIndexesPromise = null;
      throw error;
    });
  }

  return ensureCustomerIndexesPromise;
}
