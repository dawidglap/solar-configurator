import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import sanitizeHtml from "sanitize-html";
import { mongoIdToString, safeString, toObjectIdOrNull, type SessionPayload } from "@/lib/api-session";
import { getCompanyMembersByIds, getSessionUserMeta } from "@/lib/tasks";

type CalendarEventAssignee = {
  id: string;
  fullName: string;
  email: string;
};

let ensureCalendarEventIndexesPromise: Promise<void> | null = null;

const CALENDAR_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CALENDAR_TIME_RE = /^\d{2}:\d{2}$/;
const CALENDAR_DESCRIPTION_MAX_BYTES = 20 * 1024;
const CALENDAR_NOTES_MAX_LENGTH = 500;
const CALENDAR_ALLOWED_HTML_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "u",
  "s",
  "code",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "ul",
  "ol",
  "li",
  "a",
  "span",
  "mark",
] as const;

export function getCalendarEventsCollection(db: Db) {
  return db.collection("calendar_events");
}

export async function ensureCalendarEventIndexes(db: Db) {
  if (ensureCalendarEventIndexesPromise) return ensureCalendarEventIndexesPromise;

  ensureCalendarEventIndexesPromise = Promise.all([
    getCalendarEventsCollection(db).createIndex({ companyId: 1, startDate: 1, endDate: 1, createdAt: -1 }),
    getCalendarEventsCollection(db).createIndex({ companyId: 1, assigneeUserIds: 1, startDate: 1 }),
    getCalendarEventsCollection(db).createIndex({ companyId: 1, linkedTaskId: 1, startDate: 1 }),
    getCalendarEventsCollection(db).createIndex({ companyId: 1, linkedPlanningId: 1, startDate: 1 }),
    getCalendarEventsCollection(db).createIndex({ companyId: 1, linkedProjectId: 1, startDate: 1 }),
  ])
    .then(() => undefined)
    .catch((error) => {
      ensureCalendarEventIndexesPromise = null;
      throw error;
    });

  return ensureCalendarEventIndexesPromise;
}

function isValidDateOnly(value: string) {
  if (!CALENDAR_DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isValidTimeOnly(value: string) {
  if (!CALENDAR_TIME_RE.test(value)) return false;
  const [hours, minutes] = value.split(":").map((item) => Number(item));
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

export function normalizeCalendarDate(value: unknown) {
  const normalized = safeString(value);
  if (!normalized) return null;
  return isValidDateOnly(normalized) ? normalized : undefined;
}

export function normalizeCalendarTime(value: unknown) {
  const normalized = safeString(value);
  if (!normalized) return null;
  return isValidTimeOnly(normalized) ? normalized : undefined;
}

function buildAssigneeFullName(user: any) {
  const firstName = safeString(user?.firstName);
  const lastName = safeString(user?.lastName);
  return [firstName, lastName].filter(Boolean).join(" ") || safeString(user?.name) || safeString(user?.email);
}

function sanitizeCalendarEventDescription(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return null;
  if (Buffer.byteLength(normalized, "utf8") > CALENDAR_DESCRIPTION_MAX_BYTES) {
    throw new Error("Beschreibung ist zu lang.");
  }

  const sanitized = sanitizeHtml(normalized, {
    allowedTags: [...CALENDAR_ALLOWED_HTML_TAGS],
    allowedAttributes: {
      a: ["href"],
      span: ["style"],
      mark: ["style"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedStyles: {
      span: {
        color: [/^#[0-9a-fA-F]{3,8}$/, /^rgb(a)?\([^)]*\)$/, /^[a-zA-Z]+$/],
      },
      mark: {
        color: [/^#[0-9a-fA-F]{3,8}$/, /^rgb(a)?\([^)]*\)$/, /^[a-zA-Z]+$/],
        "background-color": [/^#[0-9a-fA-F]{3,8}$/, /^rgb(a)?\([^)]*\)$/, /^[a-zA-Z]+$/],
      },
    },
  }).trim();

  return sanitized || null;
}

function sanitizeCalendarEventNotes(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return null;

  const sanitized = sanitizeHtml(normalized, {
    allowedTags: [],
    allowedAttributes: {},
  })
    .replace(/\s+/g, " ")
    .trim();

  if (!sanitized) return null;
  return sanitized.slice(0, CALENDAR_NOTES_MAX_LENGTH);
}

function getPlanningProjectId(planning: any) {
  return (
    mongoIdToString(planning?.projectId) ||
    safeString(planning?.projectId) ||
    safeString(planning?.data?.projectId) ||
    mongoIdToString(planning?._id)
  );
}

async function resolveLinkedProjectAndCustomer(args: {
  db: Db;
  companyId: string;
  linkedProjectId: string | null;
  linkedCustomerId: string | null;
}) {
  let resolvedLinkedProjectId = args.linkedProjectId;
  let resolvedLinkedCustomerId = args.linkedCustomerId;

  if (resolvedLinkedProjectId) {
    const planningObjectId = toObjectIdOrNull(resolvedLinkedProjectId);
    const planning = await args.db.collection("plannings").findOne({
      companyId: args.companyId,
      $or: [
        ...(planningObjectId ? [{ _id: planningObjectId }] : []),
        { projectId: resolvedLinkedProjectId },
        { "data.projectId": resolvedLinkedProjectId },
      ],
    });

    if (!planning) {
      throw new Error("Verknüpftes Projekt wurde im aktuellen Mandanten nicht gefunden.");
    }

    resolvedLinkedProjectId = getPlanningProjectId(planning);
    const projectCustomerId =
      mongoIdToString(planning?.customerId) || safeString(planning?.customerId) || null;

    if (!resolvedLinkedCustomerId && projectCustomerId) {
      resolvedLinkedCustomerId = projectCustomerId;
    }
  }

  if (resolvedLinkedCustomerId) {
    const customerObjectId = toObjectIdOrNull(resolvedLinkedCustomerId);
    if (!customerObjectId) {
      throw new Error("Verknüpfter Kunde ist ungültig.");
    }

    const customer = await args.db.collection("customers").findOne({
      _id: customerObjectId,
      companyId: args.companyId,
    });
    if (!customer) {
      throw new Error("Verknüpfter Kunde wurde im aktuellen Mandanten nicht gefunden.");
    }

    resolvedLinkedCustomerId = mongoIdToString(customer?._id) || resolvedLinkedCustomerId;
  }

  return {
    linkedProjectId: resolvedLinkedProjectId,
    linkedCustomerId: resolvedLinkedCustomerId,
  };
}

export async function resolveCalendarEventAssignees(
  db: Db,
  companyId: string,
  input: unknown,
) {
  const assigneeUserIds = Array.isArray(input)
    ? Array.from(
        new Set(
          input
            .map((value) => safeString(value))
            .filter(Boolean),
        ),
      )
    : [];

  if (!assigneeUserIds.length) {
    return {
      assigneeUserIds: [] as string[],
      assignees: [] as CalendarEventAssignee[],
    };
  }

  const users = await getCompanyMembersByIds(db, companyId, assigneeUserIds);
  if (users.length !== assigneeUserIds.length) {
    throw new Error("Ungültige Mitarbeiterzuweisung.");
  }

  const userById = new Map(
    users.map((user: any) => [mongoIdToString(user?._id), user]),
  );

  return {
    assigneeUserIds,
    assignees: assigneeUserIds.map((userId) => {
      const user = userById.get(userId);
      return {
        id: userId,
        fullName: buildAssigneeFullName(user),
        email: safeString(user?.email),
      };
    }),
  };
}

export function normalizeCalendarEvent(doc: any) {
  const createdAt = doc?.createdAt instanceof Date ? doc.createdAt : new Date(doc?.createdAt ?? Date.now());
  const updatedAt = doc?.updatedAt instanceof Date ? doc.updatedAt : new Date(doc?.updatedAt ?? Date.now());

  return {
    id: mongoIdToString(doc?._id),
    companyId: safeString(doc?.companyId),
    title: safeString(doc?.title),
    description: safeString(doc?.description) || null,
    subtitle: safeString(doc?.notes) || null,
    startDate: safeString(doc?.startDate),
    endDate: safeString(doc?.endDate),
    startTime: safeString(doc?.startTime) || null,
    endTime: safeString(doc?.endTime) || null,
    allDay: doc?.allDay !== false,
    notes: safeString(doc?.notes) || null,
    notesPreviewHtml: safeString(doc?.description) || null,
    assigneeUserIds: Array.isArray(doc?.assigneeUserIds)
      ? doc.assigneeUserIds.map((value: any) => safeString(value)).filter(Boolean)
      : [],
    assignees: Array.isArray(doc?.assignees)
      ? doc.assignees
          .map((assignee: any) => ({
            id: safeString(assignee?.id),
            fullName: safeString(assignee?.fullName),
            email: safeString(assignee?.email),
          }))
          .filter((assignee: CalendarEventAssignee) => !!assignee.id)
      : [],
    linkedTaskId: safeString(doc?.linkedTaskId) || null,
    linkedPlanningId: safeString(doc?.linkedPlanningId) || null,
    linkedProjectId: safeString(doc?.linkedProjectId) || null,
    linkedCustomerId: safeString(doc?.linkedCustomerId) || null,
    createdAt: createdAt.toISOString(),
    createdByUserId: safeString(doc?.createdByUserId),
    createdByName: safeString(doc?.createdByName),
    updatedAt: updatedAt.toISOString(),
  };
}

type CalendarEventInput = {
  title: string;
  description: string | null;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  notes: string | null;
  assigneeUserIds: string[];
  assignees: CalendarEventAssignee[];
  linkedTaskId: string | null;
  linkedPlanningId: string | null;
  linkedProjectId: string | null;
  linkedCustomerId: string | null;
};

type BuildCalendarEventInputArgs = {
  db: Db;
  companyId: string;
  body: any;
  existing?: any;
};

export async function buildCalendarEventInput(args: BuildCalendarEventInputArgs) {
  const allowedFields = new Set([
    "companyId",
    "title",
    "description",
    "startDate",
    "endDate",
    "startTime",
    "endTime",
    "allDay",
    "notes",
    "assigneeUserIds",
    "linkedTaskId",
    "linkedPlanningId",
    "linkedProjectId",
    "linkedCustomerId",
  ]);

  const incomingKeys = Object.keys(args.body ?? {});
  const invalidField = incomingKeys.find((key) => !allowedFields.has(key));
  if (invalidField) {
    throw new Error(`Feld ${invalidField} ist ungültig.`);
  }

  const existingNormalized = args.existing ? normalizeCalendarEvent(args.existing) : null;
  const allDay =
    "allDay" in (args.body ?? {})
      ? Boolean(args.body?.allDay)
      : existingNormalized?.allDay ?? true;

  const startDate =
    "startDate" in (args.body ?? {})
      ? normalizeCalendarDate(args.body?.startDate)
      : existingNormalized?.startDate ?? null;
  const endDate =
    "endDate" in (args.body ?? {})
      ? normalizeCalendarDate(args.body?.endDate)
      : existingNormalized?.endDate ?? null;

  if (!startDate) {
    throw new Error("Startdatum ist erforderlich.");
  }
  if (startDate === undefined) {
    throw new Error("Startdatum ist ungültig.");
  }
  if (!endDate) {
    throw new Error("Enddatum ist erforderlich.");
  }
  if (endDate === undefined) {
    throw new Error("Enddatum ist ungültig.");
  }
  if (endDate < startDate) {
    throw new Error("Enddatum darf nicht vor dem Startdatum liegen.");
  }

  let startTime =
    "startTime" in (args.body ?? {})
      ? normalizeCalendarTime(args.body?.startTime)
      : existingNormalized?.startTime ?? null;
  let endTime =
    "endTime" in (args.body ?? {})
      ? normalizeCalendarTime(args.body?.endTime)
      : existingNormalized?.endTime ?? null;

  if (startTime === undefined) {
    throw new Error("Startzeit ist ungültig.");
  }
  if (endTime === undefined) {
    throw new Error("Endzeit ist ungültig.");
  }

  if (allDay) {
    startTime = null;
    endTime = null;
  } else if (startTime && endTime && startTime > endTime) {
    throw new Error("Startzeit darf nicht nach der Endzeit liegen.");
  }

  const title =
    "title" in (args.body ?? {})
      ? safeString(args.body?.title)
      : existingNormalized?.title ?? "";
  if (!title) {
    throw new Error("Titel ist erforderlich.");
  }
  const description =
    "description" in (args.body ?? {})
      ? sanitizeCalendarEventDescription(args.body?.description)
      : existingNormalized?.description ?? null;

  const { assigneeUserIds, assignees } =
    "assigneeUserIds" in (args.body ?? {})
      ? await resolveCalendarEventAssignees(args.db, args.companyId, args.body?.assigneeUserIds)
      : args.existing
        ? {
            assigneeUserIds: existingNormalized?.assigneeUserIds ?? [],
            assignees: existingNormalized?.assignees ?? [],
          }
        : { assigneeUserIds: [] as string[], assignees: [] as CalendarEventAssignee[] };

  const normalizeLinkedField = (field: keyof Pick<CalendarEventInput, "linkedTaskId" | "linkedPlanningId" | "linkedProjectId" | "linkedCustomerId">) =>
    field in (args.body ?? {})
      ? safeString(args.body?.[field]) || null
      : (existingNormalized?.[field] ?? null);

  const linkedReferences = await resolveLinkedProjectAndCustomer({
    db: args.db,
    companyId: args.companyId,
    linkedProjectId: normalizeLinkedField("linkedProjectId"),
    linkedCustomerId: normalizeLinkedField("linkedCustomerId"),
  });

  return {
    title,
    description,
    startDate,
    endDate,
    startTime,
    endTime,
    allDay,
    notes:
      "notes" in (args.body ?? {})
        ? sanitizeCalendarEventNotes(args.body?.notes)
        : existingNormalized?.notes ?? null,
    assigneeUserIds,
    assignees,
    linkedTaskId: normalizeLinkedField("linkedTaskId"),
    linkedPlanningId: normalizeLinkedField("linkedPlanningId"),
    linkedProjectId: linkedReferences.linkedProjectId,
    linkedCustomerId: linkedReferences.linkedCustomerId,
  } satisfies CalendarEventInput;
}

export function buildCalendarEventCreatedBy(session: SessionPayload) {
  const meta = getSessionUserMeta(session);
  const createdByUserId = safeString(meta?.id) || safeString(session?.userId);
  return {
    createdByUserId,
    createdByName: meta?.name || "Unbekannt",
  };
}

export function buildCalendarEventObjectId(value: string) {
  const objectId = toObjectIdOrNull(value);
  return objectId instanceof ObjectId ? objectId : null;
}

export function buildCalendarEventNotificationBody(event: {
  startDate: string;
  endDate: string;
  startTime?: string | null;
  endTime?: string | null;
  allDay?: boolean;
}) {
  const start = event.allDay
    ? event.startDate
    : [event.startDate, safeString(event.startTime)].filter(Boolean).join(" ");
  const end = event.allDay
    ? event.endDate
    : [event.endDate, safeString(event.endTime)].filter(Boolean).join(" ");
  return `${start} – ${end}`;
}
