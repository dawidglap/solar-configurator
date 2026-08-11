import type { Db } from "mongodb";
import { mongoIdToString, safeString, toObjectIdOrNull, type SessionPayload } from "@/lib/api-session";

export const USER_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FIELD_LIMITS = {
  firstName: 120,
  lastName: 120,
  workEmail: 320,
  phone: 100,
  jobTitle: 200,
  emailSignature: 2000,
} as const;

export class UserProfileValidationError extends Error {}

function normalizeOptionalText(value: unknown, field: keyof typeof FIELD_LIMITS) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new UserProfileValidationError(`${field} muss ein Text sein.`);
  }
  const normalized = value.trim();
  if (normalized.length > FIELD_LIMITS[field]) {
    throw new UserProfileValidationError(
      field === "emailSignature"
        ? "Die E-Mail-Signatur darf höchstens 2000 Zeichen lang sein."
        : `${field} ist zu lang.`,
    );
  }
  return normalized || null;
}

export function normalizeWorkEmail(value: unknown) {
  const normalized = normalizeOptionalText(value, "workEmail")?.toLowerCase() ?? null;
  if (normalized && !USER_EMAIL_PATTERN.test(normalized)) {
    throw new UserProfileValidationError("Die Geschäfts-E-Mail-Adresse ist ungültig.");
  }
  return normalized;
}

export function parseUserProfilePatch(
  body: any,
  options: { includeNames?: boolean } = {},
) {
  const patch: Record<string, string | null> = {};
  const fields = ["workEmail", "phone", "jobTitle", "emailSignature"] as const;

  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(body ?? {}, field)) continue;
    patch[field] = field === "workEmail"
      ? normalizeWorkEmail(body[field])
      : normalizeOptionalText(body[field], field);
  }

  if (options.includeNames) {
    for (const field of ["firstName", "lastName"] as const) {
      if (!Object.prototype.hasOwnProperty.call(body ?? {}, field)) continue;
      patch[field] = normalizeOptionalText(body[field], field);
    }
  }

  return patch;
}

export function normalizeUserProfile(user: any) {
  return {
    firstName: safeString(user?.firstName),
    lastName: safeString(user?.lastName),
    email: safeString(user?.email).toLowerCase(),
    workEmail: safeString(user?.workEmail).toLowerCase() || null,
    phone: safeString(user?.phone) || null,
    jobTitle: safeString(user?.jobTitle) || null,
    emailSignature: safeString(user?.emailSignature) || null,
  };
}

export function hasCurrentSessionVersion(user: any, session: SessionPayload | null | undefined) {
  if ((session as any)?.isServiceSession === true) return true;
  const storedVersion = Number.isInteger(user?.sessionVersion) ? Number(user.sessionVersion) : 0;
  const sessionVersion = Number.isInteger((session as any)?.sessionVersion)
    ? Number((session as any).sessionVersion)
    : 0;
  return storedVersion === sessionVersion;
}

export async function isCurrentSessionValid(
  db: Db,
  session: SessionPayload | null | undefined,
) {
  if ((session as any)?.isServiceSession === true) return true;
  const userId = toObjectIdOrNull(session?.userId);
  if (!userId) return false;
  const user = await db.collection("users").findOne(
    { _id: userId },
    { projection: { sessionVersion: 1, status: 1 } },
  );
  return !!user && safeString(user.status).toLowerCase() !== "inactive" && hasCurrentSessionVersion(user, session);
}

function companyContactEmail(company: any) {
  return (
    safeString(company?.contact?.email) ||
    safeString(company?.email) ||
    safeString(company?.billing?.email) ||
    null
  );
}

function companyContactPhone(company: any) {
  return (
    safeString(company?.contact?.phone) ||
    safeString(company?.contact?.mobile) ||
    safeString(company?.phone) ||
    null
  );
}

export async function resolvePlanningSellerContact(args: {
  db: Db;
  planning: any;
  company: any;
}) {
  const candidates = [
    args.planning?.commercial?.assignedToUserId,
    args.planning?.offerSignatureRequestedByUserId,
    args.planning?.createdByUserId,
    args.planning?.orderGeneratedByUserId,
    args.planning?.signatureRequestedByUserId,
  ];
  let seller: any = null;
  for (const candidate of candidates) {
    const id = toObjectIdOrNull(candidate);
    if (!id) continue;
    seller = await args.db.collection("users").findOne(
      { _id: id },
      { projection: { firstName: 1, lastName: 1, name: 1, email: 1, workEmail: 1, phone: 1 } },
    );
    if (seller) break;
  }

  const sellerName = seller
    ? [safeString(seller.firstName), safeString(seller.lastName)].filter(Boolean).join(" ") ||
      safeString(seller.name) ||
      safeString(seller.email)
    : safeString(args.planning?.offerSignatureRequestedByName) || null;

  return {
    sellerName,
    sellerEmail: safeString(seller?.workEmail).toLowerCase() || companyContactEmail(args.company),
    sellerPhone: safeString(seller?.phone) || companyContactPhone(args.company),
    sellerUserId: mongoIdToString(seller?._id) || null,
  };
}
