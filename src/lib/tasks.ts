import type { Db } from "mongodb";
import { getCorsHeaders } from "@/lib/cors";
import {
  mongoIdToString,
  safeString,
  toObjectIdOrNull,
  type SessionPayload,
} from "@/lib/api-session";

export const TASK_STATUSES = ["open", "in_progress", "done"] as const;
export const TASK_PRIORITIES = ["low", "medium", "high"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export type TaskPermissions = {
  canViewAll: boolean;
  canCreate: boolean;
  canEditAll: boolean;
  canDelete: boolean;
  canAssign: boolean;
  canCompleteAssigned: boolean;
};

export function noStoreHeaders(origin: string | null) {
  return {
    ...getCorsHeaders(origin),
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
}

export function jsonResponse(origin: string | null, body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...noStoreHeaders(origin),
    },
  });
}

export function safeNumber(v: unknown, fallback = 0) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const parsed = Number(safeString(v));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getSessionUserId(session: SessionPayload | null | undefined) {
  return safeString(session?.userId) || safeString((session as any)?.id);
}

export function getSessionUserName(session: SessionPayload | null | undefined) {
  const firstName = safeString((session as any)?.firstName);
  const lastName = safeString((session as any)?.lastName);
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  return (
    fullName ||
    safeString((session as any)?.name) ||
    safeString((session as any)?.email) ||
    ""
  );
}

export function getSessionUserEmail(session: SessionPayload | null | undefined) {
  return safeString((session as any)?.email);
}

function collectRoles(session: SessionPayload | null | undefined) {
  const direct = [
    (session as any)?.activeRole,
    (session as any)?.role,
    (session as any)?.activeCompanyRole,
    (session as any)?.membershipRole,
    (session as any)?.companyRole,
    (session as any)?.primaryRole,
  ]
    .map((value) => safeString(value).toLowerCase())
    .filter(Boolean);

  const roles = Array.isArray((session as any)?.roles)
    ? (session as any).roles
        .map((value: unknown) => safeString(value).toLowerCase())
        .filter(Boolean)
    : [];

  return Array.from(new Set([...direct, ...roles]));
}

export function isAdminLikeRole(session: SessionPayload | null | undefined) {
  if ((session as any)?.isPlatformSuperAdmin === true) return true;

  const roles = collectRoles(session);
  return roles.some((role) =>
    [
      "inhaber",
      "owner",
      "admin",
      "company_admin",
      "manager",
    ].includes(role)
  );
}

export function getTaskPermissions(
  session: SessionPayload | null | undefined
): TaskPermissions {
  const isAdminLike = isAdminLikeRole(session);

  return {
    canViewAll: isAdminLike,
    canCreate: isAdminLike,
    canEditAll: isAdminLike,
    canDelete: isAdminLike,
    canAssign: isAdminLike,
    canCompleteAssigned: true,
  };
}

export function normalizeTaskStatus(value: unknown): TaskStatus | null {
  const normalized = safeString(value).toLowerCase() as TaskStatus;
  return TASK_STATUSES.includes(normalized) ? normalized : null;
}

export function normalizeTaskPriority(value: unknown): TaskPriority | null {
  const normalized = safeString(value).toLowerCase() as TaskPriority;
  return TASK_PRIORITIES.includes(normalized) ? normalized : null;
}

export function normalizeTask(doc: any) {
  return {
    id: mongoIdToString(doc?._id),
    companyId: safeString(doc?.companyId),
    ...(safeString(doc?.planningId) ? { planningId: safeString(doc?.planningId) } : {}),
    ...(safeString(doc?.customerId) ? { customerId: safeString(doc?.customerId) } : {}),
    title: safeString(doc?.title),
    description: safeString(doc?.description),
    status: (normalizeTaskStatus(doc?.status) ?? "open") as TaskStatus,
    priority: (normalizeTaskPriority(doc?.priority) ?? "medium") as TaskPriority,
    ...(safeString(doc?.assignedToUserId)
      ? { assignedToUserId: safeString(doc?.assignedToUserId) }
      : {}),
    ...(safeString(doc?.assignedToName)
      ? { assignedToName: safeString(doc?.assignedToName) }
      : {}),
    ...(safeString(doc?.assignedToEmail)
      ? { assignedToEmail: safeString(doc?.assignedToEmail) }
      : {}),
    ...(safeString(doc?.createdByUserId)
      ? { createdByUserId: safeString(doc?.createdByUserId) }
      : {}),
    ...(safeString(doc?.createdByName)
      ? { createdByName: safeString(doc?.createdByName) }
      : {}),
    ...(safeString(doc?.createdByEmail)
      ? { createdByEmail: safeString(doc?.createdByEmail) }
      : {}),
    ...(safeString(doc?.dueDate) ? { dueDate: safeString(doc?.dueDate) } : {}),
    completedAt: safeString(doc?.completedAt) || null,
    completedByUserId: safeString(doc?.completedByUserId) || null,
    completedByName: safeString(doc?.completedByName) || null,
    createdAt: safeString(doc?.createdAt),
    updatedAt: safeString(doc?.updatedAt),
  };
}

export async function ensureTaskIndexes(db: Db) {
  const tasks = db.collection("tasks");
  await Promise.all([
    tasks.createIndex({ companyId: 1, assignedToUserId: 1, status: 1 }),
    tasks.createIndex({ companyId: 1, planningId: 1 }),
    tasks.createIndex({ companyId: 1, customerId: 1 }),
    tasks.createIndex({ companyId: 1, dueDate: 1 }),
    tasks.createIndex({ companyId: 1, createdAt: -1 }),
  ]);
}

export function isActiveCompanyMember(user: any, activeCompanyId: string) {
  if (!user) return false;
  if (safeString(user?.status).toLowerCase() !== "active") return false;

  const memberships = Array.isArray(user?.memberships) ? user.memberships : [];
  return memberships.some((membership: any) => {
    const companyId = mongoIdToString(membership?.companyId);
    return (
      companyId === activeCompanyId &&
      safeString(membership?.status).toLowerCase() === "active"
    );
  });
}

export function getCompanyMembershipRole(user: any, activeCompanyId: string) {
  const memberships = Array.isArray(user?.memberships) ? user.memberships : [];
  const membership = memberships.find(
    (value: any) =>
      mongoIdToString(value?.companyId) === activeCompanyId &&
      safeString(value?.status).toLowerCase() === "active"
  );

  return safeString(membership?.role);
}

export async function getCompanyMemberById(
  db: Db,
  activeCompanyId: string,
  userId: string
) {
  const objectId = toObjectIdOrNull(userId);
  if (!objectId) return null;

  const users = db.collection("users");
  const user = await users.findOne({ _id: objectId });
  if (!isActiveCompanyMember(user, activeCompanyId)) return null;
  return user;
}

export function normalizeCompanyMember(user: any, activeCompanyId: string) {
  const firstName = safeString(user?.firstName);
  const lastName = safeString(user?.lastName);
  const name =
    [firstName, lastName].filter(Boolean).join(" ") ||
    safeString(user?.name) ||
    safeString(user?.email);

  return {
    id: mongoIdToString(user?._id),
    ...(firstName ? { firstName } : {}),
    ...(lastName ? { lastName } : {}),
    name,
    ...(safeString(user?.email) ? { email: safeString(user?.email) } : {}),
    ...(getCompanyMembershipRole(user, activeCompanyId)
      ? { role: getCompanyMembershipRole(user, activeCompanyId) }
      : {}),
  };
}

export function sortTasks(items: ReturnType<typeof normalizeTask>[]) {
  const priorityWeight: Record<TaskPriority, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };

  return [...items].sort((a, b) => {
    const aDone = a.status === "done" ? 1 : 0;
    const bDone = b.status === "done" ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;

    const aDueMissing = a.dueDate ? 0 : 1;
    const bDueMissing = b.dueDate ? 0 : 1;
    if (aDueMissing !== bDueMissing) return aDueMissing - bDueMissing;

    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) {
      return a.dueDate.localeCompare(b.dueDate);
    }

    if (a.priority !== b.priority) {
      return priorityWeight[a.priority] - priorityWeight[b.priority];
    }

    return b.createdAt.localeCompare(a.createdAt);
  });
}

