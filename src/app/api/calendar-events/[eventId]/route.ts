import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { readSession, safeString } from "@/lib/api-session";
import { enforceActiveSubscription } from "@/lib/subscription";
import {
  buildCalendarEventNotificationBody,
  buildCalendarEventInput,
  buildCalendarEventObjectId,
  ensureCalendarEventIndexes,
  getCalendarEventsCollection,
  normalizeCalendarEvent,
} from "@/lib/calendarEvents";
import { ensureNotificationIndexes, getNotificationsCollection } from "@/lib/notifications";
import { getSessionUserMeta } from "@/lib/tasks";

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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
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

  const { eventId } = await params;
  const eventObjectId = buildCalendarEventObjectId(eventId);
  if (!eventObjectId) {
    return jsonResponse(origin, { ok: false, message: "Kalendereintrag nicht gefunden." }, 404);
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;
    await ensureCalendarEventIndexes(db);

    const collection = getCalendarEventsCollection(db);
    const existing = await collection.findOne({
      _id: eventObjectId,
      companyId: String(session.activeCompanyId),
    });

    if (!existing) {
      return jsonResponse(origin, { ok: false, message: "Kalendereintrag nicht gefunden." }, 404);
    }

    const input = await buildCalendarEventInput({
      db,
      companyId: String(session.activeCompanyId),
      body,
      existing,
    });
    const existingNormalized = normalizeCalendarEvent(existing);

    await collection.updateOne(
      { _id: existing._id },
      {
        $set: {
          ...input,
          updatedAt: new Date(),
        },
      },
    );

    const stored = await collection.findOne({ _id: existing._id });
    const normalized = normalizeCalendarEvent(stored);
    const previousAssignees = new Set(existingNormalized.assigneeUserIds);
    const addedAssigneeUserIds = normalized.assigneeUserIds.filter(
      (userId: string) => !previousAssignees.has(userId),
    );
    const actorUserId = String(getSessionUserMeta(session)?.id || session?.userId || "");

    if (addedAssigneeUserIds.some((userId: string) => userId !== actorUserId)) {
      const now = new Date();
      await ensureNotificationIndexes(db);
      await getNotificationsCollection(db).insertMany(
        addedAssigneeUserIds
          .filter((userId: string) => userId !== actorUserId)
          .map((assigneeUserId: string) => ({
            companyId: String(session.activeCompanyId),
            userId: assigneeUserId,
            type: "calendar_event_assigned",
            title: `Neuer Termin: ${normalized.title}`,
            body: buildCalendarEventNotificationBody(normalized),
            link: `/kalender/${normalized.id}`,
            meta: {
              eventId: normalized.id,
              assignedByUserId: actorUserId || null,
              startDate: normalized.startDate,
              startTime: normalized.startTime,
              allDay: normalized.allDay,
            },
            readAt: null,
            createdAt: now,
            updatedAt: now,
          })),
      );
    }

    return jsonResponse(origin, { ok: true, item: normalized }, 200);
  } catch (error: any) {
    const message = safeString(error?.message) || "Kalendereintrag konnte nicht aktualisiert werden.";
    const status =
      message.includes("erforderlich") ||
      message.includes("ungültig") ||
      message.includes("darf nicht")
        ? 400
        : 500;
    if (status === 500) {
      console.error("PATCH CALENDAR EVENT ERROR:", error);
    }
    return jsonResponse(origin, { ok: false, message }, status);
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    return jsonResponse(origin, { ok: false, message: "SESSION_SECRET fehlt." }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, message: "Nicht eingeloggt." }, 401);
  }

  const { eventId } = await params;
  const eventObjectId = buildCalendarEventObjectId(eventId);
  if (!eventObjectId) {
    return jsonResponse(origin, { ok: false, message: "Kalendereintrag nicht gefunden." }, 404);
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;
    await ensureCalendarEventIndexes(db);

    const result = await getCalendarEventsCollection(db).deleteOne({
      _id: eventObjectId,
      companyId: String(session.activeCompanyId),
    });

    if (!result.deletedCount) {
      return jsonResponse(origin, { ok: false, message: "Kalendereintrag nicht gefunden." }, 404);
    }

    return jsonResponse(origin, { ok: true }, 200);
  } catch (error: any) {
    console.error("DELETE CALENDAR EVENT ERROR:", error);
    return jsonResponse(origin, { ok: false, message: "Kalendereintrag konnte nicht gelöscht werden." }, 500);
  }
}
