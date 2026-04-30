import type { Db, ObjectId } from "mongodb";
import { safeString, mongoIdToString, toObjectIdOrNull } from "@/lib/api-session";

export const MONTAGE_STATUSES = [
  "draft",
  "planned",
  "confirmed",
  "in_progress",
  "completed",
  "delayed",
  "cancelled",
] as const;

export const MONTAGE_PAYMENT_STATUSES = [
  "paid",
  "partially_paid",
  "unpaid",
] as const;

export type MontageStatus = (typeof MONTAGE_STATUSES)[number];
export type MontagePaymentStatus = (typeof MONTAGE_PAYMENT_STATUSES)[number];

export type MontageChecklist = {
  materialDelivered: boolean;
  scaffoldingReady: boolean;
  roofAccessConfirmed: boolean;
  electricianScheduled: boolean;
  customerConfirmed: boolean;
  photosUploaded: boolean;
};

export type NormalizedInstaller = {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  status: string;
};

export function getMontagesCollection(db: Db) {
  return db.collection("montages");
}

export function getUsersCollection(db: Db) {
  return db.collection("users");
}

export function getPlanningsCollection(db: Db) {
  return db.collection("plannings");
}

export function getCustomersCollection(db: Db) {
  return db.collection("customers");
}

export async function ensureMontageIndexes(db: Db) {
  const montages = getMontagesCollection(db);

  await Promise.all([
    montages.createIndex({ companyId: 1, planningId: 1 }),
    montages.createIndex({ companyId: 1, projectId: 1 }),
    montages.createIndex({ companyId: 1, status: 1 }),
    montages.createIndex({ companyId: 1, startDate: 1, endDate: 1 }),
    montages.createIndex({ companyId: 1, assignedInstallerIds: 1 }),
  ]);
}

export function defaultMontageChecklist(): MontageChecklist {
  return {
    materialDelivered: false,
    scaffoldingReady: false,
    roofAccessConfirmed: false,
    electricianScheduled: false,
    customerConfirmed: false,
    photosUploaded: false,
  };
}

export function normalizeMontageChecklist(
  checklist: any
): MontageChecklist {
  return {
    materialDelivered: !!checklist?.materialDelivered,
    scaffoldingReady: !!checklist?.scaffoldingReady,
    roofAccessConfirmed: !!checklist?.roofAccessConfirmed,
    electricianScheduled: !!checklist?.electricianScheduled,
    customerConfirmed: !!checklist?.customerConfirmed,
    photosUploaded: !!checklist?.photosUploaded,
  };
}

export function normalizeMontageAddress(address: any) {
  return {
    street: safeString(address?.street),
    zip: safeString(address?.zip),
    city: safeString(address?.city),
    country: safeString(address?.country) || "CH",
  };
}

function isValidDateString(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidTimeString(value: string) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function normalizeDateOrNull(value: unknown) {
  const s = safeString(value);
  if (!s) return null;
  return isValidDateString(s) ? s : undefined;
}

export function normalizeTimeOrNull(value: unknown) {
  const s = safeString(value);
  if (!s) return null;
  return isValidTimeString(s) ? s : undefined;
}

export function normalizeMontageStatus(value: unknown) {
  const s = safeString(value) as MontageStatus;
  return MONTAGE_STATUSES.includes(s) ? s : undefined;
}

export function normalizeMontagePaymentStatus(value: unknown) {
  const s = safeString(value) as MontagePaymentStatus;
  return MONTAGE_PAYMENT_STATUSES.includes(s) ? s : undefined;
}

export function isUserInstallerForCompany(
  user: any,
  activeCompanyId: string,
  activeCompanyObjectId: ObjectId
) {
  if (!user || safeString(user?.status) !== "active") return false;

  const memberships = Array.isArray(user?.memberships) ? user.memberships : [];
  return memberships.some((membership: any) => {
    const membershipCompanyId = mongoIdToString(membership?.companyId);
    return (
      (membershipCompanyId === activeCompanyId ||
        (membership?.companyId &&
          String(membership?.companyId) === String(activeCompanyObjectId))) &&
      safeString(membership?.role) === "installer" &&
      safeString(membership?.status) === "active"
    );
  });
}

export function normalizeInstaller(
  user: any,
  activeCompanyId: string,
  activeCompanyObjectId: ObjectId
): NormalizedInstaller {
  const firstName = safeString(user?.firstName);
  const lastName = safeString(user?.lastName);
  const email = safeString(user?.email);
  const fullName = [firstName, lastName].filter(Boolean).join(" ") || email;

  const memberships = Array.isArray(user?.memberships) ? user.memberships : [];
  const membership = memberships.find((membership: any) => {
    const membershipCompanyId = mongoIdToString(membership?.companyId);
    return (
      membershipCompanyId === activeCompanyId ||
      String(membership?.companyId) === String(activeCompanyObjectId)
    );
  });

  return {
    id: mongoIdToString(user?._id),
    firstName,
    lastName,
    fullName,
    email,
    status:
      safeString(membership?.status) || safeString(user?.status) || "active",
  };
}

export async function validateInstallerIds(
  db: Db,
  assignedInstallerIds: unknown,
  activeCompanyId: string,
  activeCompanyObjectId: ObjectId
) {
  if (assignedInstallerIds == null) {
    return {
      installerIds: [] as ObjectId[],
      installerDocs: [] as any[],
    };
  }

  if (!Array.isArray(assignedInstallerIds)) {
    throw new Error("assignedInstallerIds must be an array");
  }

  const installerIds = assignedInstallerIds
    .map((value) => toObjectIdOrNull(value))
    .filter((value): value is ObjectId => !!value);

  const uniqueInstallerIds = Array.from(
    new Map(installerIds.map((value) => [String(value), value])).values()
  );

  if (uniqueInstallerIds.length !== assignedInstallerIds.length) {
    throw new Error("One or more assignedInstallerIds are invalid");
  }

  if (uniqueInstallerIds.length === 0) {
    return {
      installerIds: [] as ObjectId[],
      installerDocs: [] as any[],
    };
  }

  const users = getUsersCollection(db);
  const docs = await users
    .find({
      _id: { $in: uniqueInstallerIds },
      status: "active",
    })
    .toArray();

  const validDocs = docs.filter((doc) =>
    isUserInstallerForCompany(doc, activeCompanyId, activeCompanyObjectId)
  );

  if (validDocs.length !== uniqueInstallerIds.length) {
    throw new Error(
      "One or more assignedInstallerIds are not active installers for this company"
    );
  }

  return {
    installerIds: uniqueInstallerIds,
    installerDocs: validDocs,
  };
}

export function isPlanningMontageReady(planning: any) {
  const data = planning?.data ?? {};

  return (
    safeString(data?.offerStatus) === "paid" ||
    safeString(data?.paymentStatus) === "paid" ||
    safeString(data?.angebotStatus) === "paid" ||
    data?.montageReady === true ||
    safeString(data?.reportOptions?.paymentStatus) === "paid" ||
    safeString(data?.offer?.status) === "paid" ||
    safeString(data?.angebot?.status) === "paid"
  );
}

function parseAddressLine(raw: string) {
  const trimmed = safeString(raw);
  if (!trimmed) return null;

  const match = trimmed.match(/^(.*?)(?:,\s*|\s+)(\d{4,5})\s+(.+)$/);
  if (!match) {
    return {
      street: trimmed,
      zip: "",
      city: "",
      country: "CH",
    };
  }

  return {
    street: safeString(match[1]),
    zip: safeString(match[2]),
    city: safeString(match[3]),
    country: "CH",
  };
}

export function extractAddressFromPlanning(planning: any, customer?: any) {
  const profile = planning?.data?.profile ?? planning?.data?.planner?.profile ?? {};
  const buildingStreet =
    safeString(profile?.buildingStreet) ||
    safeString(profile?.street) ||
    safeString(profile?.billingStreet);
  const buildingStreetNo =
    safeString(profile?.buildingStreetNo) ||
    safeString(profile?.streetNo) ||
    safeString(profile?.billingStreetNo);
  const buildingZip =
    safeString(profile?.buildingZip) ||
    safeString(profile?.zip) ||
    safeString(profile?.billingZip);
  const buildingCity =
    safeString(profile?.buildingCity) ||
    safeString(profile?.city) ||
    safeString(profile?.billingCity);

  if (buildingStreet || buildingStreetNo || buildingZip || buildingCity) {
    return normalizeMontageAddress({
      street: [buildingStreet, buildingStreetNo].filter(Boolean).join(" "),
      zip: buildingZip,
      city: buildingCity,
      country: "CH",
    });
  }

  const snapshotAddress =
    safeString(planning?.data?.planner?.snapshot?.address) ||
    safeString(planning?.data?.snapshot?.address);
  if (snapshotAddress) {
    return normalizeMontageAddress(parseAddressLine(snapshotAddress));
  }

  const customerAddress = safeString(customer?.address);
  if (customerAddress) {
    return normalizeMontageAddress(parseAddressLine(customerAddress));
  }

  return normalizeMontageAddress(null);
}

export function buildMontageTitleFromPlanning(planning: any, customer?: any) {
  const planningNumber = safeString(planning?.planningNumber);
  const customerName =
    safeString(planning?.summary?.customerName) ||
    safeString(customer?.name) ||
    [
      safeString(customer?.firstName),
      safeString(customer?.lastName),
    ]
      .filter(Boolean)
      .join(" ") ||
    safeString(customer?.companyName) ||
    safeString(planning?.title);

  const address = extractAddressFromPlanning(planning, customer);
  const locality = [address.street, [address.zip, address.city].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");

  return (
    [customerName, planningNumber].filter(Boolean).join(" - ") ||
    [planningNumber, locality].filter(Boolean).join(" - ") ||
    "Montage"
  );
}

export async function assertCompanyScopedPlanning(
  db: Db,
  planningId: string,
  activeCompanyId: string
) {
  const planningObjectId = toObjectIdOrNull(planningId);
  if (!planningObjectId) return null;

  return getPlanningsCollection(db).findOne({
    _id: planningObjectId,
    companyId: activeCompanyId,
  });
}

export function buildMontageDoc(params: {
  activeCompanyObjectId: ObjectId;
  planningObjectId: ObjectId;
  userObjectId: ObjectId;
  planning: any;
  customer?: any;
  projectId?: ObjectId | null;
  offerId?: ObjectId | null;
  customerId?: ObjectId | null;
}) {
  const now = new Date();

  return {
    companyId: params.activeCompanyObjectId,
    projectId: params.projectId ?? null,
    planningId: params.planningObjectId,
    offerId: params.offerId ?? null,
    customerId: params.customerId ?? null,
    title: buildMontageTitleFromPlanning(params.planning, params.customer),
    status: "draft" as MontageStatus,
    paymentStatus: "paid" as MontagePaymentStatus,
    montageReady: true,
    startDate: null,
    endDate: null,
    startTime: null,
    endTime: null,
    assignedInstallerIds: [] as ObjectId[],
    address: extractAddressFromPlanning(params.planning, params.customer),
    notes: "",
    checklist: defaultMontageChecklist(),
    createdAt: now,
    updatedAt: now,
    createdBy: params.userObjectId,
  };
}

export function normalizeMontage(
  doc: any,
  opts?: {
    installersById?: Map<string, any>;
    customerById?: Map<string, any>;
    planningById?: Map<string, any>;
  }
) {
  const assignedInstallerIds = Array.isArray(doc?.assignedInstallerIds)
    ? doc.assignedInstallerIds.map((value: any) => mongoIdToString(value)).filter(Boolean)
    : [];

  const installers = assignedInstallerIds
    .map((id: string) => {
      const user = opts?.installersById?.get(id);
      if (!user) return null;
      return {
        id,
        fullName:
          [safeString(user?.firstName), safeString(user?.lastName)]
            .filter(Boolean)
            .join(" ") || safeString(user?.email),
        email: safeString(user?.email),
      };
    })
    .filter(
      (
        value: { id: string; fullName: string; email: string } | null
      ): value is { id: string; fullName: string; email: string } => !!value
    );

  const customerId = mongoIdToString(doc?.customerId);
  const planningId = mongoIdToString(doc?.planningId);
  const customer = customerId ? opts?.customerById?.get(customerId) : null;
  const planning = planningId ? opts?.planningById?.get(planningId) : null;

  const customerName =
    safeString(planning?.summary?.customerName) ||
    safeString(customer?.name) ||
    [safeString(customer?.firstName), safeString(customer?.lastName)]
      .filter(Boolean)
      .join(" ") ||
    safeString(customer?.companyName) ||
    undefined;

  const planningNumber = safeString(planning?.planningNumber) || undefined;

  return {
    id: mongoIdToString(doc?._id),
    companyId: mongoIdToString(doc?.companyId),
    projectId: mongoIdToString(doc?.projectId) || null,
    planningId,
    offerId: mongoIdToString(doc?.offerId) || null,
    customerId: customerId || null,
    title: safeString(doc?.title),
    status: safeString(doc?.status),
    paymentStatus: safeString(doc?.paymentStatus),
    montageReady: !!doc?.montageReady,
    startDate: doc?.startDate ?? null,
    endDate: doc?.endDate ?? null,
    startTime: doc?.startTime ?? null,
    endTime: doc?.endTime ?? null,
    assignedInstallerIds,
    installers,
    address: normalizeMontageAddress(doc?.address),
    notes: safeString(doc?.notes),
    checklist: normalizeMontageChecklist(doc?.checklist),
    ...(customerName ? { customerName } : {}),
    ...(planningNumber ? { planningNumber } : {}),
    createdAt: doc?.createdAt instanceof Date ? doc.createdAt.toISOString() : String(doc?.createdAt ?? ""),
    updatedAt: doc?.updatedAt instanceof Date ? doc.updatedAt.toISOString() : String(doc?.updatedAt ?? ""),
  };
}
