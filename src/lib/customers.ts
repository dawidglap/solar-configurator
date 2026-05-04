import type { Db } from "mongodb";

type CustomerType = "private" | "company";

export function safeCustomerString(v: unknown) {
  return typeof v === "string" ? v.trim() : "";
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

export function normalizeCustomerDoc(doc: any) {
  return {
    id: String(doc._id),
    type: doc.type ?? "private",
    name:
      safeCustomerString(doc.name) ||
      safeCustomerString(doc.companyName) ||
      [safeCustomerString(doc.firstName), safeCustomerString(doc.lastName)]
        .filter(Boolean)
        .join(" ")
        .trim(),
    firstName: doc.firstName ?? "",
    lastName: doc.lastName ?? "",
    companyName: doc.companyName ?? "",
    email: doc.email ?? "",
    phone: doc.phone ?? "",
    address: doc.address ?? "",
    notes: doc.notes ?? "",
    createdAt: doc.createdAt ?? null,
    updatedAt: doc.updatedAt ?? null,
  };
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
        deletedAt: { $exists: false },
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
        deletedAt: { $exists: false },
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
      deletedAt: { $exists: false },
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
      ]) {
        try {
          await customers.dropIndex(indexName);
        } catch {}
      }

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

      await customers.createIndex(
        { companyId: 1, email: 1 },
        {
          name: "uniq_company_email_active_v2",
          unique: true,
          partialFilterExpression: {
            duplicateOfCustomerId: null,
            deletedAt: { $exists: false },
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
            deletedAt: { $exists: false },
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
            deletedAt: { $exists: false },
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
