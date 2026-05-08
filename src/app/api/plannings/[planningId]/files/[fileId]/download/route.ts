import { ObjectId } from "mongodb";
import {
  assertCompanyScopedPlanning,
  buildPlanningFileDownloadUrl,
  createPlanningFileJsonResponse,
  createPlanningFileNoStoreHeaders,
  getPlanningFileDbAndSession,
  getPlanningFilesCollection,
} from "@/lib/planningFiles";
import { safeString } from "@/lib/api-session";

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

export async function GET(req: Request, { params }: Params) {
  const context = await getPlanningFileDbAndSession(req);
  if (!context.ok) return context.response;

  const { origin, db, companyId } = context;
  const { planningId, fileId } = await params;

  if (!ObjectId.isValid(planningId) || !ObjectId.isValid(fileId)) {
    return createPlanningFileJsonResponse(origin, { ok: false, error: "Invalid id" }, 400);
  }

  try {
    const planning = await assertCompanyScopedPlanning(db, planningId, companyId);
    if (!planning) {
      return createPlanningFileJsonResponse(origin, { ok: false, error: "Planning not found" }, 404);
    }

    const fileDoc = await getPlanningFilesCollection(db).findOne({
      _id: new ObjectId(fileId),
      companyId,
      planningId,
      isDeleted: { $ne: true },
    });

    if (!fileDoc) {
      return createPlanningFileJsonResponse(origin, { ok: false, error: "File not found" }, 404);
    }

    const disposition =
      safeString(new URL(req.url).searchParams.get("disposition")).toLowerCase() === "inline"
        ? "inline"
        : "attachment";

    const signedUrl = buildPlanningFileDownloadUrl(fileDoc, disposition);
    return Response.redirect(signedUrl, 302);
  } catch (e: any) {
    console.error("DOWNLOAD PLANNING FILE ERROR:", e);
    return createPlanningFileJsonResponse(
      origin,
      { ok: false, error: e?.message || "Unknown error" },
      500,
    );
  }
}
