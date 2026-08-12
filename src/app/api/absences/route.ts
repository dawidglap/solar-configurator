import { getDb } from "@/lib/db";
import { readSession, toObjectIdOrNull } from "@/lib/api-session";
import { enforceActiveSubscription } from "@/lib/subscription";
import { buildIdVariants, getCompanyMembersByIds, jsonResponse, noStoreHeaders } from "@/lib/tasks";
import {
  AbsenceRequestError,
  buildAbsenceOverlapFilter,
  ensureAbsenceIndexes,
  getAbsencesCollection,
  normalizeAbsenceInput,
  parseAbsenceDate,
  serializeAbsence,
} from "@/lib/absences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function OPTIONS(req: Request) {
  return new Response(null, {
    status: 204,
    headers: noStoreHeaders(req.headers.get("origin")),
  });
}

function absenceErrorResponse(origin: string | null, error: unknown) {
  if (error instanceof AbsenceRequestError) {
    return jsonResponse(
      origin,
      { ok: false, error: error.message, message: error.message, code: error.code },
      error.status,
    );
  }
  const value = error as any;
  console.error("ABSENCES API ERROR:", value);
  return jsonResponse(origin, { ok: false, error: value?.message || "Unknown error" }, 500);
}

function requireSession(req: Request, origin: string | null) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return { response: jsonResponse(origin, { ok: false, error: "Missing SESSION_SECRET" }, 500) };
  }
  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return { response: jsonResponse(origin, { ok: false, error: "Not logged in" }, 401) };
  }
  return { session };
}

export async function GET(req: Request) {
  const origin = req.headers.get("origin");
  const auth = requireSession(req, origin);
  if ("response" in auth) return auth.response;

  const url = new URL(req.url);
  const rawUserId = url.searchParams.get("userId");
  const userId = rawUserId ? toObjectIdOrNull(rawUserId) : null;
  if (rawUserId && !userId) {
    return jsonResponse(origin, { ok: false, error: "Invalid userId", code: "INVALID_USER_ID" }, 400);
  }
  const rawFrom = url.searchParams.get("from");
  const rawTo = url.searchParams.get("to");
  const from = rawFrom == null ? null : parseAbsenceDate(rawFrom);
  const to = rawTo == null ? null : parseAbsenceDate(rawTo);
  if (rawFrom != null && !from) {
    return jsonResponse(origin, { ok: false, error: "Invalid from date", code: "INVALID_FROM_DATE" }, 400);
  }
  if (rawTo != null && !to) {
    return jsonResponse(origin, { ok: false, error: "Invalid to date", code: "INVALID_TO_DATE" }, 400);
  }
  if (from && to && to < from) {
    return jsonResponse(origin, { ok: false, error: "to must not be before from", code: "INVALID_DATE_RANGE" }, 400);
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, auth.session);
    if (subscriptionError) return subscriptionError;
    await ensureAbsenceIndexes(db);

    const companyId = String(auth.session.activeCompanyId);
    const filter: Record<string, any> = {
      companyId: { $in: buildIdVariants(companyId) },
      ...(userId ? { userId } : {}),
    };
    if (from && to) Object.assign(filter, buildAbsenceOverlapFilter(from, to));
    else if (from) filter.endDate = { $gte: from };
    else if (to) filter.startDate = { $lte: to };

    const docs = await getAbsencesCollection(db)
      .find(filter)
      .sort({ startDate: 1, startTime: 1, userId: 1, _id: 1 })
      .toArray();
    return jsonResponse(origin, { ok: true, items: docs.map(serializeAbsence) }, 200);
  } catch (error) {
    return absenceErrorResponse(origin, error);
  }
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const auth = requireSession(req, origin);
  if ("response" in auth) return auth.response;
  const body = await req.json().catch(() => ({}));

  let normalized: ReturnType<typeof normalizeAbsenceInput>;
  try {
    normalized = normalizeAbsenceInput(body);
  } catch (error) {
    return absenceErrorResponse(origin, error);
  }

  const companyId = String(auth.session.activeCompanyId);
  const companyObjectId = toObjectIdOrNull(companyId);
  const actorUserId = toObjectIdOrNull(auth.session.userId);
  if (!companyObjectId || !actorUserId) {
    return jsonResponse(origin, { ok: false, error: "Invalid session", code: "INVALID_SESSION" }, 401);
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, auth.session);
    if (subscriptionError) return subscriptionError;
    await ensureAbsenceIndexes(db);

    const members = await getCompanyMembersByIds(db, companyId, [normalized.userId.toString()]);
    if (members.length !== 1) {
      throw new AbsenceRequestError(
        "Der Mitarbeiter ist kein aktives Mitglied des Mandanten.",
        "USER_NOT_IN_COMPANY",
      );
    }

    const now = new Date();
    const doc = {
      companyId: companyObjectId,
      ...normalized,
      createdAt: now,
      createdByUserId: actorUserId,
      updatedAt: now,
    };
    const result = await getAbsencesCollection(db).insertOne(doc);
    return jsonResponse(
      origin,
      { ok: true, absence: serializeAbsence({ ...doc, _id: result.insertedId }) },
      201,
    );
  } catch (error) {
    return absenceErrorResponse(origin, error);
  }
}
