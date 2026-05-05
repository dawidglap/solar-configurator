import { ObjectId } from "mongodb";
import {
  assertCompanyScopedPlanning,
  buildPlanningFileFilter,
  createPlanningFileJsonResponse,
  createPlanningFileNoStoreHeaders,
  ensurePlanningFileIndexes,
  extractPlanningFileCustomerId,
  getPlanningFilePermissions,
  getPlanningFilesCollection,
  getPlanningFileDbAndSession,
  normalizePlanningFile,
  normalizePlanningFileCategory,
  parseAndUploadPlanningFile,
} from "@/lib/planningFiles";
import { safeString } from "@/lib/api-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = { params: Promise<{ planningId: string }> };

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

  const { origin, db, session, companyId } = context;
  const { planningId } = await params;
  const permissions = getPlanningFilePermissions(session);

  if (!ObjectId.isValid(planningId)) {
    return createPlanningFileJsonResponse(origin, { ok: false, error: "Invalid planningId" }, 400);
  }

  try {
    const planning = await assertCompanyScopedPlanning(db, planningId, companyId);
    if (!planning) {
      return createPlanningFileJsonResponse(origin, { ok: false, error: "Planning not found" }, 404);
    }

    await ensurePlanningFileIndexes(db);

    const { searchParams } = new URL(req.url);
    const categoryParam = safeString(searchParams.get("category"));
    const category =
      categoryParam && categoryParam !== "all"
        ? normalizePlanningFileCategory(categoryParam)
        : null;

    if (categoryParam && categoryParam !== "all" && !category) {
      return createPlanningFileJsonResponse(origin, { ok: false, error: "Invalid category" }, 400);
    }

    const filter: Record<string, any> = buildPlanningFileFilter(companyId, planningId);
    if (category) {
      filter.category = category;
    }

    const docs = await getPlanningFilesCollection(db)
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .toArray();

    return createPlanningFileJsonResponse(
      origin,
      {
        ok: true,
        items: docs.map((doc) => normalizePlanningFile(doc)),
        permissions,
      },
      200,
    );
  } catch (e: any) {
    console.error("GET PLANNING FILES ERROR:", e);
    return createPlanningFileJsonResponse(
      origin,
      { ok: false, error: e?.message || "Unknown error" },
      500,
    );
  }
}

export async function POST(req: Request, { params }: Params) {
  const context = await getPlanningFileDbAndSession(req);
  if (!context.ok) return context.response;

  const { origin, db, session, companyId } = context;
  const { planningId } = await params;
  const permissions = getPlanningFilePermissions(session);

  if (!permissions.canUpload) {
    return createPlanningFileJsonResponse(origin, { ok: false, error: "Forbidden" }, 403);
  }

  if (!ObjectId.isValid(planningId)) {
    return createPlanningFileJsonResponse(origin, { ok: false, error: "Invalid planningId" }, 400);
  }

  try {
    const planning = await assertCompanyScopedPlanning(db, planningId, companyId);
    if (!planning) {
      return createPlanningFileJsonResponse(origin, { ok: false, error: "Planning not found" }, 404);
    }

    const formData = await req.formData();
    const category = normalizePlanningFileCategory(formData.get("category"));
    const title = safeString(formData.get("title"));
    const file = formData.get("file");

    if (!category) {
      return createPlanningFileJsonResponse(origin, { ok: false, error: "Invalid category" }, 400);
    }

    if (!(file instanceof File)) {
      return createPlanningFileJsonResponse(origin, { ok: false, error: "File is required" }, 400);
    }

    const doc = await parseAndUploadPlanningFile({
      companyId,
      planningId,
      category,
      file,
      title,
      customerId: extractPlanningFileCustomerId(planning),
      session,
    });

    await ensurePlanningFileIndexes(db);
    const result = await getPlanningFilesCollection(db).insertOne(doc);

    return createPlanningFileJsonResponse(
      origin,
      { ok: true, file: normalizePlanningFile({ ...doc, _id: result.insertedId }) },
      200,
    );
  } catch (e: any) {
    console.error("UPLOAD PLANNING FILE ERROR:", e);
    const message = safeString(e?.message);
    const status =
      message === "Missing Cloudinary environment variables"
        ? 500
        : message === "Unsupported file type" || message === "File exceeds 10 MB limit"
          ? 400
          : 500;

    return createPlanningFileJsonResponse(
      origin,
      { ok: false, error: message || "Upload failed" },
      status,
    );
  }
}
