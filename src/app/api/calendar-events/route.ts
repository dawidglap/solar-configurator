import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { readSession, safeString } from "@/lib/api-session";
import { enforceActiveSubscription } from "@/lib/subscription";
import {
  buildCalendarEventCreatedBy,
  buildCalendarEventInput,
  ensureCalendarEventIndexes,
  getCalendarEventsCollection,
  normalizeCalendarDate,
  normalizeCalendarEvent,
} from "@/lib/calendarEvents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonResponse(origin: string | null, body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...getCorsHeaders(origin),
    },
  });
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

export async function GET(req: Request) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    return jsonResponse(origin, { ok: false, message: "SESSION_SECRET fehlt." }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, message: "Nicht eingeloggt." }, 401);
  }

  const url = new URL(req.url);
  const from = normalizeCalendarDate(url.searchParams.get("from"));
  const to = normalizeCalendarDate(url.searchParams.get("to"));
  const taskId = safeString(url.searchParams.get("taskId"));
  const planningId = safeString(url.searchParams.get("planningId"));
  const projectId = safeString(url.searchParams.get("projectId"));
  const assigneeUserId = safeString(url.searchParams.get("assigneeUserId"));

  if (url.searchParams.get("from") && from === undefined) {
    return jsonResponse(origin, { ok: false, message: "Parameter from ist ungültig." }, 400);
  }
  if (url.searchParams.get("to") && to === undefined) {
    return jsonResponse(origin, { ok: false, message: "Parameter to ist ungültig." }, 400);
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;
    await ensureCalendarEventIndexes(db);

    const filter: Record<string, any> = {
      companyId: String(session.activeCompanyId),
    };

    if (taskId) filter.linkedTaskId = taskId;
    if (planningId) filter.linkedPlanningId = planningId;
    if (projectId) filter.linkedProjectId = projectId;
    if (assigneeUserId) filter.assigneeUserIds = assigneeUserId;
    if (from) filter.endDate = { ...(filter.endDate ?? {}), $gte: from };
    if (to) filter.startDate = { ...(filter.startDate ?? {}), $lte: to };

    const docs = await getCalendarEventsCollection(db)
      .find(filter)
      .sort({ startDate: 1, startTime: 1, endDate: 1, endTime: 1, createdAt: 1, _id: 1 })
      .toArray();

    return jsonResponse(origin, { ok: true, items: docs.map((doc) => normalizeCalendarEvent(doc)) }, 200);
  } catch (error: any) {
    console.error("GET CALENDAR EVENTS ERROR:", error);
    return jsonResponse(origin, { ok: false, message: "Kalendereinträge konnten nicht geladen werden." }, 500);
  }
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    return jsonResponse(origin, { ok: false, message: "SESSION_SECRET fehlt." }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, message: "Nicht eingeloggt." }, 401);
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return jsonResponse(origin, { ok: false, message: "Ungültiger JSON-Body." }, 400);
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;
    await ensureCalendarEventIndexes(db);

    const companyId = String(session.activeCompanyId);
    const input = await buildCalendarEventInput({
      db,
      companyId,
      body,
    });
    const now = new Date();
    const createdBy = buildCalendarEventCreatedBy(session);

    const doc = {
      companyId,
      ...input,
      createdAt: now,
      createdByUserId: createdBy.createdByUserId,
      createdByName: createdBy.createdByName,
      updatedAt: now,
    };

    const result = await getCalendarEventsCollection(db).insertOne(doc);
    const stored = await getCalendarEventsCollection(db).findOne({ _id: result.insertedId });

    return jsonResponse(origin, { ok: true, item: normalizeCalendarEvent(stored) }, 200);
  } catch (error: any) {
    const message = safeString(error?.message) || "Kalendereintrag konnte nicht erstellt werden.";
    const status =
      message.includes("erforderlich") ||
      message.includes("ungültig") ||
      message.includes("darf nicht")
        ? 400
        : 500;
    if (status === 500) {
      console.error("POST CALENDAR EVENT ERROR:", error);
    }
    return jsonResponse(origin, { ok: false, message }, status);
  }
}
