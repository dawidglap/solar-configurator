import { getDb } from "@/lib/db";
import { readSession, safeString, toObjectIdOrNull } from "@/lib/api-session";
import { enforceActiveSubscription } from "@/lib/subscription";
import { buildIdVariants, jsonResponse, noStoreHeaders } from "@/lib/tasks";
import {
  ensureTeamIndexes,
  findActiveTeamMemberConflicts,
  getTeamsCollection,
  hydrateTeams,
  normalizeTeamMembers,
  normalizeTeamStatus,
  normalizeTeamTracks,
  TeamRequestError,
  validateTeamMembers,
} from "@/lib/teams";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function OPTIONS(req: Request) {
  return new Response(null, {
    status: 204,
    headers: noStoreHeaders(req.headers.get("origin")),
  });
}

function teamErrorResponse(origin: string | null, error: unknown, fallback: string) {
  if (error instanceof TeamRequestError) {
    return jsonResponse(
      origin,
      {
        ok: false,
        error: error.message,
        code: error.code,
        ...(error.conflictUserIds.length
          ? { conflictUserIds: error.conflictUserIds }
          : {}),
      },
      error.status,
    );
  }
  const mongoError = error as any;
  if (mongoError?.code === 11000) {
    return jsonResponse(
      origin,
      {
        ok: false,
        error: "Mindestens ein Mitarbeiter gehört bereits zu einem aktiven Team.",
        code: "USER_ALREADY_IN_TEAM",
      },
      409,
    );
  }
  console.error(fallback, error);
  return jsonResponse(origin, { ok: false, error: mongoError?.message || "Unknown error" }, 500);
}

export async function GET(req: Request) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) return jsonResponse(origin, { ok: false, error: "Missing SESSION_SECRET" }, 500);

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }

  const url = new URL(req.url);
  const trackParam = url.searchParams.get("track");
  const tracks = trackParam ? normalizeTeamTracks([trackParam]) : [];
  const statusParam = url.searchParams.get("status");
  const status = statusParam ? normalizeTeamStatus(statusParam) : null;
  if (trackParam && !tracks.length) {
    return jsonResponse(origin, { ok: false, error: "Invalid track" }, 400);
  }
  if (statusParam && !status) {
    return jsonResponse(origin, { ok: false, error: "Invalid status" }, 400);
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;
    await ensureTeamIndexes(db);

    const companyId = String(session.activeCompanyId);
    const docs = await getTeamsCollection(db)
      .find({
        companyId: { $in: buildIdVariants(companyId) },
        ...(tracks[0] ? { tracks: tracks[0] } : {}),
        ...(status ? { status } : {}),
      })
      .sort({ status: 1, name: 1, createdAt: 1 })
      .toArray();
    return jsonResponse(origin, { ok: true, items: await hydrateTeams(db, docs) }, 200);
  } catch (error) {
    return teamErrorResponse(origin, error, "GET TEAMS ERROR:");
  }
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) return jsonResponse(origin, { ok: false, error: "Missing SESSION_SECRET" }, 500);

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }
  const body = await req.json().catch(() => ({} as any));
  const name = safeString(body?.name).slice(0, 120);
  const color = safeString(body?.color).slice(0, 120) || "hsl(210 80% 58%)";
  const tracks = normalizeTeamTracks(body?.tracks);
  let members: ReturnType<typeof normalizeTeamMembers>;
  try {
    members = normalizeTeamMembers(body?.members);
  } catch (error) {
    return teamErrorResponse(origin, error, "CREATE TEAM VALIDATION ERROR:");
  }
  if (!name) {
    return jsonResponse(origin, { ok: false, error: "name is required", code: "TEAM_NAME_REQUIRED" }, 400);
  }
  if (!tracks.length) {
    return jsonResponse(origin, { ok: false, error: "tracks is required", code: "TEAM_TRACKS_REQUIRED" }, 400);
  }
  if (!members.length) {
    return jsonResponse(origin, { ok: false, error: "members is required", code: "TEAM_MEMBERS_REQUIRED" }, 400);
  }

  const companyId = String(session.activeCompanyId);
  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;
    await ensureTeamIndexes(db);
    await validateTeamMembers(db, companyId, members);

    const now = new Date();
    const doc = {
      companyId: toObjectIdOrNull(companyId) || companyId,
      name,
      color,
      tracks,
      members,
      status: "active" as const,
      createdAt: now,
      updatedAt: now,
    };
    const result = await getTeamsCollection(db).insertOne(doc);
    const [item] = await hydrateTeams(db, [{ ...doc, _id: result.insertedId }]);
    return jsonResponse(origin, { ok: true, item }, 201);
  } catch (error) {
    if ((error as any)?.code === 11000) {
      const conflictUserIds = await findActiveTeamMemberConflicts(
        await getDb(),
        companyId,
        members.map((member) => member.userId.toString()),
      );
      return jsonResponse(
        origin,
        {
          ok: false,
          error: "Mindestens ein Mitarbeiter gehört bereits zu einem aktiven Team.",
          code: "USER_ALREADY_IN_TEAM",
          conflictUserIds,
        },
        409,
      );
    }
    return teamErrorResponse(origin, error, "CREATE TEAM ERROR:");
  }
}
