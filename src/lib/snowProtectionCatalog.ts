import { ObjectId, type Db, type Document } from "mongodb";

export const SNOW_PROTECTION_PLANNER_ROLE = "snow_protection" as const;
export const SNOW_PROTECTION_CATEGORY = "mounting" as const;
export const SNOW_PROTECTION_INDEX_NAME =
  "uniq_catalog_company_snow_protection_role" as const;

export type SnowProtectionDuplicate = {
  companyId: string;
  itemIds: string[];
};

function companyIdVariants(companyId: string | ObjectId) {
  const normalized = String(companyId);
  if (!ObjectId.isValid(normalized)) return [normalized];
  return [normalized, new ObjectId(normalized)];
}

export function getPlannerRole(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
  const value = (metadata as Record<string, unknown>).plannerRole;
  return typeof value === "string" ? value.trim() : "";
}

export function isSnowProtectionCatalogItem(item: unknown) {
  if (!item || typeof item !== "object") return false;
  return (
    getPlannerRole((item as Record<string, unknown>).metadata) ===
    SNOW_PROTECTION_PLANNER_ROLE
  );
}

export function isSnowProtectionRoleAssignmentBlocked(
  existingItem: unknown,
  incomingMetadata: unknown,
) {
  return (
    !isSnowProtectionCatalogItem(existingItem) &&
    getPlannerRole(incomingMetadata) === SNOW_PROTECTION_PLANNER_ROLE
  );
}

export function canDeleteCatalogItem(item: unknown) {
  return !isSnowProtectionCatalogItem(item);
}

export function preserveSnowProtectionTechnicalFields(
  existingItem: unknown,
  update: Record<string, unknown>,
) {
  if (!isSnowProtectionCatalogItem(existingItem)) return update;
  return {
    ...update,
    category: SNOW_PROTECTION_CATEGORY,
    unit: "m",
    unitLabel: "m",
    isActive: true,
  };
}

export function preserveSnowProtectionPlannerRole(
  existingMetadata: unknown,
  incomingMetadata: unknown,
) {
  const existing =
    existingMetadata && typeof existingMetadata === "object" && !Array.isArray(existingMetadata)
      ? (existingMetadata as Record<string, unknown>)
      : {};
  const incoming =
    incomingMetadata && typeof incomingMetadata === "object" && !Array.isArray(incomingMetadata)
      ? (incomingMetadata as Record<string, unknown>)
      : {};

  if (getPlannerRole(existing) !== SNOW_PROTECTION_PLANNER_ROLE) return incoming;
  return { ...incoming, plannerRole: SNOW_PROTECTION_PLANNER_ROLE };
}

export function buildSnowProtectionCatalogItem(
  companyId: string | ObjectId,
  now = new Date(),
) {
  return {
    companyId: String(companyId),
    category: SNOW_PROTECTION_CATEGORY,
    subcategory: "",
    brand: "",
    model: "",
    name: "Schneefang",
    description: "",
    longDescription: "",
    features: [] as string[],
    warranty: "",
    compatibility: "",
    notes: "",
    pdfSection: "",
    unit: "m",
    unitLabel: "m",
    priceNet: 0,
    costNet: 0,
    vatRate: 8.1,
    isActive: true,
    sortOrder: 0,
    metadata: { plannerRole: SNOW_PROTECTION_PLANNER_ROLE },
    createdAt: now,
    updatedAt: now,
  };
}

export async function auditSnowProtectionDuplicates(
  db: Db,
): Promise<SnowProtectionDuplicate[]> {
  const docs = await db
    .collection("catalogItems")
    .find(
      { "metadata.plannerRole": SNOW_PROTECTION_PLANNER_ROLE },
      { projection: { _id: 1, companyId: 1 } },
    )
    .toArray();

  const byCompany = new Map<string, string[]>();
  for (const doc of docs) {
    const companyId = String(doc.companyId ?? "");
    const ids = byCompany.get(companyId) ?? [];
    ids.push(String(doc._id));
    byCompany.set(companyId, ids);
  }

  return [...byCompany.entries()]
    .filter(([, itemIds]) => itemIds.length > 1)
    .map(([companyId, itemIds]) => ({ companyId, itemIds }));
}

export async function ensureSnowProtectionUniqueIndex(db: Db) {
  const duplicates = await auditSnowProtectionDuplicates(db);
  if (duplicates.length > 0) {
    const error = new Error(
      `Cannot create ${SNOW_PROTECTION_INDEX_NAME}: duplicate snow protection products exist`,
    );
    Object.assign(error, { code: "SNOW_PROTECTION_DUPLICATES", duplicates });
    throw error;
  }

  return db.collection("catalogItems").createIndex(
    { companyId: 1, "metadata.plannerRole": 1 },
    {
      name: SNOW_PROTECTION_INDEX_NAME,
      unique: true,
      partialFilterExpression: {
        "metadata.plannerRole": SNOW_PROTECTION_PLANNER_ROLE,
      },
    },
  );
}

export async function findSnowProtectionCatalogItem(
  db: Db,
  companyId: string | ObjectId,
) {
  return db.collection("catalogItems").findOne({
    companyId: { $in: companyIdVariants(companyId) },
    "metadata.plannerRole": SNOW_PROTECTION_PLANNER_ROLE,
  });
}

export async function ensureCompanySnowProtectionCatalogItem(
  db: Db,
  companyId: string | ObjectId,
) {
  const normalizedCompanyId = String(companyId);
  const collection = db.collection("catalogItems");
  const existing = await findSnowProtectionCatalogItem(db, companyId);
  if (existing) return { item: existing as Document, created: false };

  const now = new Date();
  let created = false;
  try {
    const result = await collection.updateOne(
      {
        companyId: normalizedCompanyId,
        "metadata.plannerRole": SNOW_PROTECTION_PLANNER_ROLE,
      },
      {
        $setOnInsert: buildSnowProtectionCatalogItem(normalizedCompanyId, now),
      },
      { upsert: true },
    );
    created = result.upsertedCount === 1;
  } catch (error: any) {
    if (error?.code !== 11000) throw error;
  }

  const item = await findSnowProtectionCatalogItem(db, normalizedCompanyId);
  if (!item) throw new Error("Snow protection catalog product could not be initialized");

  return {
    item: item as Document,
    created,
  };
}
