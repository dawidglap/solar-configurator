import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import {
  jsonResponse,
  mongoIdToString,
  readSession,
  toObjectIdOrNull,
} from "@/lib/api-session";
import {
  assertCompanyScopedPlanning,
  buildMontageDoc,
  ensureMontageIndexes,
  getCustomersCollection,
  getMontagesCollection,
  getPlanningsCollection,
  isPlanningMontageReady,
  normalizeMontage,
} from "@/lib/montages";

export const runtime = "nodejs";

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ planningId: string }> }
) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    return jsonResponse(origin, { ok: false, error: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId || !session?.userId) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }

  const { planningId } = await params;
  const activeCompanyId = String(session.activeCompanyId);
  const companyObjectId = toObjectIdOrNull(activeCompanyId);
  const planningObjectId = toObjectIdOrNull(planningId);
  const userObjectId = toObjectIdOrNull(session.userId);

  if (!companyObjectId || !planningObjectId || !userObjectId) {
    return jsonResponse(origin, { ok: false, error: "Invalid request scope" }, 400);
  }

  try {
    const db = await getDb();
    await ensureMontageIndexes(db);

    const planning = await assertCompanyScopedPlanning(db, planningId, activeCompanyId);
    if (!planning) {
      return jsonResponse(origin, { ok: false, error: "Planning not found" }, 404);
    }

    const existing = await getMontagesCollection(db).findOne({
      companyId: companyObjectId,
      planningId: planningObjectId,
    });

    if (existing) {
      const item = normalizeMontage(existing);
      return jsonResponse(origin, { ok: true, existing: true, item }, 200);
    }

    if (!isPlanningMontageReady(planning)) {
      return jsonResponse(
        origin,
        { ok: false, error: "Planning is not ready for montage" },
        400
      );
    }

    const customerObjectId =
      toObjectIdOrNull(planning?.customerId) ?? null;
    const offerObjectId =
      toObjectIdOrNull(planning?.offerId) ??
      toObjectIdOrNull(planning?.data?.offerId) ??
      null;
    const projectObjectId =
      toObjectIdOrNull(planning?.projectId) ??
      toObjectIdOrNull(planning?.data?.projectId) ??
      null;

    const customer = customerObjectId
      ? await getCustomersCollection(db).findOne({ _id: customerObjectId })
      : null;

    const doc = buildMontageDoc({
      activeCompanyObjectId: companyObjectId,
      planningObjectId,
      userObjectId,
      planning,
      customer,
      projectId: projectObjectId,
      offerId: offerObjectId,
      customerId: customerObjectId,
    });

    const result = await getMontagesCollection(db).insertOne(doc);
    const inserted = {
      ...doc,
      _id: result.insertedId,
    };

    await getPlanningsCollection(db).updateOne(
      {
        _id: planningObjectId,
        companyId: activeCompanyId,
      },
      {
        $set: {
          "data.montageId": result.insertedId,
          "data.montageStatus": "draft",
          "data.montageReady": true,
          updatedAt: new Date(),
        },
      }
    );

    const item = normalizeMontage(inserted, {
      customerById: customer
        ? new Map([[mongoIdToString(customer?._id), customer]])
        : new Map(),
      planningById: new Map([[mongoIdToString(planning?._id), planning]]),
      installersById: new Map(),
    });

    return jsonResponse(
      origin,
      { ok: true, existing: false, item },
      200
    );
  } catch (e: any) {
    console.error("CREATE MONTAGE FROM PLANNING ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message || "Unknown error" },
      500
    );
  }
}

