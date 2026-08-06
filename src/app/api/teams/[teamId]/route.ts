import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { readSession, safeString } from "@/lib/api-session";
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

type Params = { params: Promise<{ teamId: string }> };

export async function OPTIONS(req: Request) {
  return new Response(null, {
    status: 204,
    headers: noStoreHeaders(req.headers.get("origin")),
  });
}

function validationResponse(origin: string | null, error: TeamRequestError) {
  return jsonResponse(
    origin,
    {
      ok: false,
      error: error.message,
      code: error.code,
      ...(error.conflictUserIds.length ? { conflictUserIds: error.conflictUserIds } : {}),
    },
    error.status,
  );
}

export async function GET(req: Request, { params }: Params) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) return jsonResponse(origin, { ok: false, error: "Missing SESSION_SECRET" }, 500);
  const session = readSession(req, secret);
  if (!session?.activeCompanyId) return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  const { teamId } = await params;
  if (!ObjectId.isValid(teamId)) return jsonResponse(origin, { ok: false, error: "Invalid teamId" }, 400);

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;
    await ensureTeamIndexes(db);
    const doc = await getTeamsCollection(db).findOne({
      _id: new ObjectId(teamId),
      companyId: { $in: buildIdVariants(String(session.activeCompanyId)) },
    });
    if (!doc) return jsonResponse(origin, { ok: false, error: "Team not found" }, 404);
    const [item] = await hydrateTeams(db, [doc]);
    return jsonResponse(origin, { ok: true, item }, 200);
  } catch (error: any) {
    console.error("GET TEAM ERROR:", error);
    return jsonResponse(origin, { ok: false, error: error?.message || "Unknown error" }, 500);
  }
}

export async function PATCH(req: Request, { params }: Params) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) return jsonResponse(origin, { ok: false, error: "Missing SESSION_SECRET" }, 500);
  const session = readSession(req, secret);
  if (!session?.activeCompanyId) return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  const { teamId } = await params;
  if (!ObjectId.isValid(teamId)) return jsonResponse(origin, { ok: false, error: "Invalid teamId" }, 400);
  const body = await req.json().catch(() => ({} as any));
  const companyId = String(session.activeCompanyId);

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;
    await ensureTeamIndexes(db);
    const existing = await getTeamsCollection(db).findOne({
      _id: new ObjectId(teamId),
      companyId: { $in: buildIdVariants(companyId) },
    });
    if (!existing) return jsonResponse(origin, { ok: false, error: "Team not found" }, 404);

    const updateSet: Record<string, any> = { updatedAt: new Date() };
    if (body?.name !== undefined) {
      const name = safeString(body?.name).slice(0, 120);
      if (!name) return jsonResponse(origin, { ok: false, error: "name must not be empty", code: "TEAM_NAME_REQUIRED" }, 400);
      updateSet.name = name;
    }
    if (body?.color !== undefined) updateSet.color = safeString(body?.color).slice(0, 120);
    if (body?.tracks !== undefined) {
      const tracks = normalizeTeamTracks(body?.tracks);
      if (!tracks.length) return jsonResponse(origin, { ok: false, error: "tracks must not be empty", code: "TEAM_TRACKS_REQUIRED" }, 400);
      updateSet.tracks = tracks;
    }
    if (body?.status !== undefined) {
      const status = normalizeTeamStatus(body?.status);
      if (!status) return jsonResponse(origin, { ok: false, error: "Invalid status" }, 400);
      updateSet.status = status;
    }

    const nextStatus = updateSet.status || (existing as any).status || "active";
    const nextMembers =
      body?.members !== undefined
        ? normalizeTeamMembers(body?.members)
        : normalizeTeamMembers((existing as any).members);
    if (!nextMembers.length) {
      return jsonResponse(origin, { ok: false, error: "members must not be empty", code: "TEAM_MEMBERS_REQUIRED" }, 400);
    }
    if (body?.members !== undefined) updateSet.members = nextMembers;

    if (body?.members !== undefined || nextStatus === "active") {
      await validateTeamMembers(db, companyId, nextMembers, {
        excludeTeamId: teamId,
        checkConflicts: nextStatus === "active",
      });
    }

    await getTeamsCollection(db).updateOne(
      { _id: new ObjectId(teamId), companyId: { $in: buildIdVariants(companyId) } },
      { $set: updateSet },
    );
    const updated = await getTeamsCollection(db).findOne({ _id: new ObjectId(teamId) });
    const [item] = await hydrateTeams(db, [updated]);
    return jsonResponse(origin, { ok: true, item }, 200);
  } catch (error: any) {
    if (error instanceof TeamRequestError) return validationResponse(origin, error);
    if (error?.code === 11000) {
      const members = body?.members !== undefined ? normalizeTeamMembers(body.members) : [];
      const conflictUserIds = members.length
        ? await findActiveTeamMemberConflicts(
            await getDb(),
            companyId,
            members.map((member) => member.userId.toString()),
            teamId,
          )
        : [];
      return jsonResponse(
        origin,
        {
          ok: false,
          error: "Mindestens ein Mitarbeiter gehört bereits zu einem aktiven Team.",
          code: "USER_ALREADY_IN_TEAM",
          ...(conflictUserIds.length ? { conflictUserIds } : {}),
        },
        409,
      );
    }
    console.error("PATCH TEAM ERROR:", error);
    return jsonResponse(origin, { ok: false, error: error?.message || "Unknown error" }, 500);
  }
}
