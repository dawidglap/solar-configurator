import { ObjectId } from "mongodb";
import {
  assertCompanyScopedPlanning,
  buildPlanningFileDeletePatch,
  createPlanningFileJsonResponse,
  createPlanningFileNoStoreHeaders,
  getPlanningFilePermissions,
  getPlanningFilesCollection,
  getPlanningFileDbAndSession,
} from "@/lib/planningFiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = { params: Promise<{ planningId: string; fileId: string }> };

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: createPlanningFileNoStoreHeaders(origin),
  });
}

export async function DELETE(req: Request, { params }: Params) {
  const context = await getPlanningFileDbAndSession(req);
  if (!context.ok) return context.response;

  const { origin, db, session, companyId } = context;
  const { planningId, fileId } = await params;
  const permissions = getPlanningFilePermissions(session);

  if (!permissions.canDelete) {
    return createPlanningFileJsonResponse(origin, { ok: false, error: "Forbidden" }, 403);
  }

  if (!ObjectId.isValid(planningId) || !ObjectId.isValid(fileId)) {
    return createPlanningFileJsonResponse(origin, { ok: false, error: "Invalid id" }, 400);
  }

  try {
    const planning = await assertCompanyScopedPlanning(db, planningId, companyId);
    if (!planning) {
      return createPlanningFileJsonResponse(origin, { ok: false, error: "Planning not found" }, 404);
    }

    const result = await getPlanningFilesCollection(db).updateOne(
      {
        _id: new ObjectId(fileId),
        companyId,
        planningId,
        isDeleted: { $ne: true },
      },
      {
        $set: buildPlanningFileDeletePatch(session),
      },
    );

    if (!result.matchedCount) {
      return createPlanningFileJsonResponse(origin, { ok: false, error: "File not found" }, 404);
    }

    return createPlanningFileJsonResponse(origin, { ok: true, deleted: true }, 200);
  } catch (e: any) {
    console.error("DELETE PLANNING FILE ERROR:", e);
    return createPlanningFileJsonResponse(
      origin,
      { ok: false, error: e?.message || "Unknown error" },
      500,
    );
  }
}
