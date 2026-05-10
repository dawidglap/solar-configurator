import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { jsonResponse, mongoIdToString, safeString, toObjectIdOrNull, type SessionPayload } from "@/lib/api-session";
import { getSessionUserId, getSessionUserName } from "@/lib/tasks";

export const COMPANY_PLANS = [
  "starter",
  "professional",
  "business",
  "enterprise",
] as const;

export const COMPANY_SUBSCRIPTION_STATUSES = [
  "active",
  "expiring_soon",
  "suspended",
] as const;

export type CompanyPlan = (typeof COMPANY_PLANS)[number];
export type CompanySubscriptionStatus = (typeof COMPANY_SUBSCRIPTION_STATUSES)[number];

export type NormalizedCompanySubscription = {
  plan: CompanyPlan;
  subscriptionStatus: CompanySubscriptionStatus;
  validUntil: Date;
  maxUsers: number;
  notes: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const ADMIN_RATE_LIMIT_WINDOW_MS = 60_000;
const ADMIN_RATE_LIMIT_MAX = 60;

const adminRateLimitState = new Map<
  string,
  {
    count: number;
    resetAt: number;
  }
>();

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

export function isValidCompanyPlan(value: unknown): value is CompanyPlan {
  return COMPANY_PLANS.includes(value as CompanyPlan);
}

export function isValidCompanySubscriptionStatus(
  value: unknown,
): value is CompanySubscriptionStatus {
  return COMPANY_SUBSCRIPTION_STATUSES.includes(value as CompanySubscriptionStatus);
}

export function isPlatformSuperAdmin(session: SessionPayload | null | undefined) {
  return (session as any)?.isPlatformSuperAdmin === true;
}

export function buildNewCompanySubscriptionDefaults(now = new Date()) {
  return {
    plan: "starter" as const,
    subscriptionStatus: "active" as const,
    validUntil: addDays(now, 30),
    maxUsers: 5,
    notes: "",
  };
}

export function buildExistingCompanyMigrationDefaults(now = new Date()) {
  return {
    plan: "professional" as const,
    subscriptionStatus: "active" as const,
    validUntil: addDays(now, 365),
    maxUsers: 20,
    notes: "",
  };
}

export function slugifyCompanyName(name: string) {
  return safeString(name)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function parseFutureDateInput(value: unknown) {
  const raw = safeString(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function normalizeCompanySubscription(
  company: any,
  fallback = buildExistingCompanyMigrationDefaults(),
): NormalizedCompanySubscription {
  const plan = isValidCompanyPlan(company?.plan) ? company.plan : fallback.plan;
  const subscriptionStatus = isValidCompanySubscriptionStatus(company?.subscriptionStatus)
    ? company.subscriptionStatus
    : fallback.subscriptionStatus;
  const validUntil =
    company?.validUntil instanceof Date && !Number.isNaN(company.validUntil.getTime())
      ? company.validUntil
      : fallback.validUntil;
  const maxUsers =
    typeof company?.maxUsers === "number" && Number.isFinite(company.maxUsers) && company.maxUsers >= 1
      ? Math.floor(company.maxUsers)
      : fallback.maxUsers;
  const notes = typeof company?.notes === "string" ? company.notes : fallback.notes;

  return {
    plan,
    subscriptionStatus,
    validUntil,
    maxUsers,
    notes,
  };
}

export function computeDaysRemaining(validUntil: Date | string | null | undefined) {
  const date =
    validUntil instanceof Date ? validUntil : typeof validUntil === "string" ? new Date(validUntil) : null;
  if (!date || Number.isNaN(date.getTime())) return 0;
  const diff = date.getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / DAY_MS));
}

export function buildCompanySubscriptionResponse(company: any) {
  const normalized = normalizeCompanySubscription(company);
  return {
    plan: normalized.plan,
    status: normalized.subscriptionStatus,
    validUntil: normalized.validUntil.toISOString(),
    maxUsers: normalized.maxUsers,
    daysRemaining: computeDaysRemaining(normalized.validUntil),
  };
}

export function buildCompanyIdVariants(companyId: string) {
  const normalized = safeString(companyId);
  const objectId = toObjectIdOrNull(normalized);
  return objectId ? [normalized, objectId] : [normalized];
}

export function buildMembershipCompanyQuery(companyId: string) {
  const variants = buildCompanyIdVariants(companyId);
  return {
    memberships: {
      $elemMatch: {
        companyId: { $in: variants },
      },
    },
  };
}

export function buildActiveMembershipCompanyQuery(companyId: string) {
  const variants = buildCompanyIdVariants(companyId);
  return {
    memberships: {
      $elemMatch: {
        companyId: { $in: variants },
        status: "active",
      },
    },
  };
}

export async function ensureCompanySubscriptionIndexes(db: Db) {
  const companies = db.collection("companies");
  await Promise.all([
    companies.createIndex({ deletedAt: 1, subscriptionStatus: 1 }),
    companies.createIndex({ plan: 1, deletedAt: 1 }),
    companies.createIndex({ validUntil: 1, deletedAt: 1 }),
  ]);
}

export async function ensureCompanySubscriptionFields(db: Db, company: any) {
  if (!company?._id) return company;

  const defaults = buildExistingCompanyMigrationDefaults();
  const patch: Record<string, unknown> = {};

  if (!isValidCompanyPlan(company.plan)) {
    patch.plan = defaults.plan;
  }

  if (!isValidCompanySubscriptionStatus(company.subscriptionStatus)) {
    patch.subscriptionStatus = defaults.subscriptionStatus;
  }

  if (!(company.validUntil instanceof Date) || Number.isNaN(company.validUntil.getTime())) {
    patch.validUntil = defaults.validUntil;
  }

  if (
    typeof company.maxUsers !== "number" ||
    !Number.isFinite(company.maxUsers) ||
    company.maxUsers < 1
  ) {
    patch.maxUsers = defaults.maxUsers;
  }

  if (typeof company.notes !== "string") {
    patch.notes = defaults.notes;
  }

  if (Object.keys(patch).length === 0) {
    return {
      ...company,
      ...normalizeCompanySubscription(company, defaults),
    };
  }

  await db.collection("companies").updateOne(
    { _id: company._id },
    { $set: { ...patch, updatedAt: new Date() } },
  );

  return {
    ...company,
    ...patch,
  };
}

export async function getCompanyById(db: Db, companyId: string) {
  const objectId = toObjectIdOrNull(companyId);
  if (!objectId) return null;

  const company = await db.collection("companies").findOne({
    _id: objectId,
    deletedAt: { $exists: false },
  });

  if (!company) return null;
  return ensureCompanySubscriptionFields(db, company);
}

export async function enforceAdminRateLimit(
  origin: string | null,
  session: SessionPayload | null | undefined,
) {
  const userId = getSessionUserId(session);
  if (!userId) {
    return jsonResponse(origin, { ok: false, message: "Not logged in" }, 401);
  }

  const now = Date.now();
  const state = adminRateLimitState.get(userId);
  if (!state || state.resetAt <= now) {
    adminRateLimitState.set(userId, {
      count: 1,
      resetAt: now + ADMIN_RATE_LIMIT_WINDOW_MS,
    });
    return null;
  }

  if (state.count >= ADMIN_RATE_LIMIT_MAX) {
    return jsonResponse(origin, { ok: false, message: "Rate limit exceeded" }, 429);
  }

  state.count += 1;
  adminRateLimitState.set(userId, state);
  return null;
}

export function requirePlatformSuperAdmin(
  origin: string | null,
  session: SessionPayload | null | undefined,
) {
  if (isPlatformSuperAdmin(session)) return null;
  return jsonResponse(origin, { ok: false, message: "Forbidden" }, 403);
}

export async function enforceActiveSubscription(
  db: Db,
  origin: string | null,
  session: SessionPayload | null | undefined,
) {
  if (!session?.activeCompanyId || isPlatformSuperAdmin(session)) {
    return null;
  }

  const companyId = safeString(session.activeCompanyId);
  if (!companyId) return null;

  const company = await getCompanyById(db, companyId);
  if (!company) {
    return jsonResponse(origin, { ok: false, message: "Company not found" }, 404);
  }

  const normalized = normalizeCompanySubscription(company);
  const now = new Date();
  let currentStatus = normalized.subscriptionStatus;

  if (normalized.validUntil.getTime() < now.getTime()) {
    currentStatus = "suspended";
    if (company.subscriptionStatus !== "suspended") {
      await db.collection("companies").updateOne(
        { _id: company._id },
        {
          $set: {
            subscriptionStatus: "suspended",
            updatedAt: now,
          },
        },
      );
    }
  }

  if (currentStatus === "suspended") {
    return jsonResponse(
      origin,
      {
        ok: false,
        error: "subscription_suspended",
        validUntil: normalized.validUntil.toISOString(),
      },
      403,
    );
  }

  return null;
}

export async function buildUniqueCompanySlug(db: Db, name: string) {
  const base = slugifyCompanyName(name) || "company";
  const companies = db.collection("companies");
  let candidate = base;
  let counter = 2;

  while (await companies.findOne({ slug: candidate, deletedAt: { $exists: false } }, { projection: { _id: 1 } })) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }

  return candidate;
}

export async function countCompanyUsers(db: Db, companyId: string) {
  const users = await db
    .collection("users")
    .find({
      status: { $ne: "inactive" },
      ...buildActiveMembershipCompanyQuery(companyId),
    })
    .project({ _id: 1 })
    .toArray();

  return users.length;
}

export function normalizeAdminCompanyListItem(company: any, userCount: number) {
  const subscription = normalizeCompanySubscription(company);
  return {
    id: mongoIdToString(company?._id),
    name: safeString(company?.name),
    plan: subscription.plan,
    subscriptionStatus: subscription.subscriptionStatus,
    validUntil: subscription.validUntil.toISOString(),
    maxUsers: subscription.maxUsers,
    userCount,
    createdAt:
      company?.createdAt instanceof Date
        ? company.createdAt.toISOString()
        : company?.createdAt ?? null,
    notes: subscription.notes,
  };
}

export function buildDefaultOwnerPassword() {
  return "Helionic2026!";
}

export function buildCompanyDeletePatch() {
  const now = new Date();
  return {
    deletedAt: now,
    updatedAt: now,
  };
}

export function buildDeactivateUsersUpdate(companyId: string) {
  const variants = buildCompanyIdVariants(companyId);
  return {
    filter: {
      memberships: {
        $elemMatch: {
          companyId: { $in: variants },
        },
      },
    },
    update: [
      {
        $set: {
          status: "inactive",
          updatedAt: new Date(),
          memberships: {
            $map: {
              input: "$memberships",
              as: "membership",
              in: {
                $cond: [
                  { $in: ["$$membership.companyId", variants] },
                  { $mergeObjects: ["$$membership", { status: "inactive" }] },
                  "$$membership",
                ],
              },
            },
          },
        },
      },
    ],
  };
}

export async function createCompanyBackfillMigration(db: Db) {
  const defaults = buildExistingCompanyMigrationDefaults();
  await db.collection("companies").updateMany(
    {
      $or: [
        { plan: { $exists: false } },
        { subscriptionStatus: { $exists: false } },
        { validUntil: { $exists: false } },
        { maxUsers: { $exists: false } },
        { notes: { $exists: false } },
      ],
    },
    {
      $set: {
        plan: defaults.plan,
        subscriptionStatus: defaults.subscriptionStatus,
        validUntil: defaults.validUntil,
        maxUsers: defaults.maxUsers,
        notes: defaults.notes,
        updatedAt: new Date(),
      },
    },
  );
}

export function buildSubscriptionAuditEvent(
  session: SessionPayload | null | undefined,
  changes: Record<string, unknown>,
) {
  return {
    at: new Date().toISOString(),
    by: getSessionUserId(session) || null,
    byName: getSessionUserName(session) || null,
    changes,
  };
}
