import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import {
  jsonResponse,
  readSession,
  safeString,
  toObjectIdOrNull,
  mongoIdToString,
} from "@/lib/api-session";
import {
  assertCompanyScopedPlanning,
  buildMontageTitleFromPlanning,
  ensureMontageIndexes,
  extractAddressFromPlanning,
  getCustomersCollection,
  getMontagesCollection,
  getPlanningsCollection,
  getUsersCollection,
  normalizeDateOrNull,
  normalizeMontage,
  normalizeMontageAddress,
  normalizeMontageChecklist,
  normalizeMontagePaymentStatus,
  normalizeMontageStatus,
  normalizeTimeOrNull,
  validateInstallerIds,
  defaultMontageChecklist,
} from "@/lib/montages";

export const runtime = "nodejs";

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

async function hydrateMontageItems(
  db: Awaited<ReturnType<typeof getDb>>,
  docs: any[]
) {
  const customerIds = Array.from(
    new Set(docs.map((doc) => mongoIdToString(doc?.customerId)).filter(Boolean))
  );
  const planningIds = Array.from(
    new Set(docs.map((doc) => mongoIdToString(doc?.planningId)).filter(Boolean))
  );
  const installerIds = Array.from(
    new Set(
      docs.flatMap((doc) =>
        Array.isArray(doc?.assignedInstallerIds)
          ? doc.assignedInstallerIds.map((id: any) => mongoIdToString(id)).filter(Boolean)
          : []
      )
    )
  );

  const [customers, plannings, installers] = await Promise.all([
    customerIds.length
      ? getCustomersCollection(db)
          .find({
            _id: {
              $in: customerIds
                .map((id) => toObjectIdOrNull(id))
                .filter((id): id is ObjectId => !!id),
            },
          })
          .toArray()
      : Promise.resolve([]),
    planningIds.length
      ? getPlanningsCollection(db)
          .find({
            _id: {
              $in: planningIds
                .map((id) => toObjectIdOrNull(id))
                .filter((id): id is ObjectId => !!id),
            },
          })
          .toArray()
      : Promise.resolve([]),
    installerIds.length
      ? getUsersCollection(db)
          .find({
            _id: {
              $in: installerIds
                .map((id) => toObjectIdOrNull(id))
                .filter((id): id is ObjectId => !!id),
            },
          })
          .toArray()
      : Promise.resolve([]),
  ]);

  const customerById = new Map(customers.map((doc: any) => [mongoIdToString(doc?._id), doc]));
  const planningById = new Map(plannings.map((doc: any) => [mongoIdToString(doc?._id), doc]));
  const installersById = new Map(installers.map((doc: any) => [mongoIdToString(doc?._id), doc]));

  return docs.map((doc) =>
    normalizeMontage(doc, {
      customerById,
      planningById,
      installersById,
    })
  );
}

export async function GET(req: Request) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    return jsonResponse(origin, { ok: false, error: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }

  const activeCompanyId = String(session.activeCompanyId);
  const companyObjectId = toObjectIdOrNull(activeCompanyId);
  if (!companyObjectId) {
    return jsonResponse(origin, { ok: false, error: "Invalid activeCompanyId" }, 400);
  }

  const url = new URL(req.url);
  const projectId = safeString(url.searchParams.get("projectId"));
  const planningId = safeString(url.searchParams.get("planningId"));
  const status = safeString(url.searchParams.get("status"));
  const from = safeString(url.searchParams.get("from"));
  const to = safeString(url.searchParams.get("to"));
  const installerId = safeString(url.searchParams.get("installerId"));

  const filter: Record<string, any> = {
    companyId: companyObjectId,
  };

  if (projectId) {
    const projectObjectId = toObjectIdOrNull(projectId);
    if (!projectObjectId) {
      return jsonResponse(origin, { ok: false, error: "Invalid projectId" }, 400);
    }
    filter.projectId = projectObjectId;
  }

  if (planningId) {
    const planningObjectId = toObjectIdOrNull(planningId);
    if (!planningObjectId) {
      return jsonResponse(origin, { ok: false, error: "Invalid planningId" }, 400);
    }
    filter.planningId = planningObjectId;
  }

  if (status) {
    const normalizedStatus = normalizeMontageStatus(status);
    if (!normalizedStatus) {
      return jsonResponse(origin, { ok: false, error: "Invalid status" }, 400);
    }
    filter.status = normalizedStatus;
  }

  if (installerId) {
    const installerObjectId = toObjectIdOrNull(installerId);
    if (!installerObjectId) {
      return jsonResponse(origin, { ok: false, error: "Invalid installerId" }, 400);
    }
    filter.assignedInstallerIds = installerObjectId;
  }

  if (from || to) {
    const normalizedFrom = from ? normalizeDateOrNull(from) : null;
    const normalizedTo = to ? normalizeDateOrNull(to) : null;

    if (from && normalizedFrom === undefined) {
      return jsonResponse(origin, { ok: false, error: "Invalid from date" }, 400);
    }
    if (to && normalizedTo === undefined) {
      return jsonResponse(origin, { ok: false, error: "Invalid to date" }, 400);
    }

    if (normalizedTo) {
      filter.startDate = { ...(filter.startDate ?? {}), $lte: normalizedTo };
    }
    if (normalizedFrom) {
      filter.endDate = { ...(filter.endDate ?? {}), $gte: normalizedFrom };
    }
  }

  try {
    const db = await getDb();
    await ensureMontageIndexes(db);

    const docs = await getMontagesCollection(db)
      .find(filter)
      .sort({ startDate: 1, createdAt: -1 })
      .toArray();

    const items = await hydrateMontageItems(db, docs);
    return jsonResponse(origin, { ok: true, items }, 200);
  } catch (e: any) {
    console.error("GET MONTAGES ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message || "Unknown error" },
      500
    );
  }
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    return jsonResponse(origin, { ok: false, error: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId || !session?.userId) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }

  const activeCompanyId = String(session.activeCompanyId);
  const companyObjectId = toObjectIdOrNull(activeCompanyId);
  const userObjectId = toObjectIdOrNull(session.userId);

  if (!companyObjectId || !userObjectId) {
    return jsonResponse(origin, { ok: false, error: "Invalid session scope" }, 400);
  }

  const body = await req.json().catch(() => ({} as any));
  const planningId = safeString(body?.planningId);
  if (!planningId) {
    return jsonResponse(origin, { ok: false, error: "planningId is required" }, 400);
  }

  const planningObjectId = toObjectIdOrNull(planningId);
  if (!planningObjectId) {
    return jsonResponse(origin, { ok: false, error: "Invalid planningId" }, 400);
  }

  const normalizedStatus =
    normalizeMontageStatus(body?.status) ?? ("draft" as const);
  const normalizedPaymentStatus =
    normalizeMontagePaymentStatus(body?.paymentStatus) ?? ("unpaid" as const);
  const startDate = normalizeDateOrNull(body?.startDate);
  const endDate = normalizeDateOrNull(body?.endDate);
  const startTime = normalizeTimeOrNull(body?.startTime);
  const endTime = normalizeTimeOrNull(body?.endTime);

  if (body?.status && !normalizeMontageStatus(body?.status)) {
    return jsonResponse(origin, { ok: false, error: "Invalid status" }, 400);
  }
  if (body?.paymentStatus && !normalizeMontagePaymentStatus(body?.paymentStatus)) {
    return jsonResponse(origin, { ok: false, error: "Invalid paymentStatus" }, 400);
  }
  if (body?.startDate != null && startDate === undefined) {
    return jsonResponse(origin, { ok: false, error: "Invalid startDate" }, 400);
  }
  if (body?.endDate != null && endDate === undefined) {
    return jsonResponse(origin, { ok: false, error: "Invalid endDate" }, 400);
  }
  if (body?.startTime != null && startTime === undefined) {
    return jsonResponse(origin, { ok: false, error: "Invalid startTime" }, 400);
  }
  if (body?.endTime != null && endTime === undefined) {
    return jsonResponse(origin, { ok: false, error: "Invalid endTime" }, 400);
  }

  try {
    const db = await getDb();
    await ensureMontageIndexes(db);

    const planning = await assertCompanyScopedPlanning(db, planningId, activeCompanyId);
    if (!planning) {
      return jsonResponse(origin, { ok: false, error: "Planning not found" }, 404);
    }

    const customerObjectId =
      toObjectIdOrNull(body?.customerId) ??
      toObjectIdOrNull(planning?.customerId);
    const customer = customerObjectId
      ? await getCustomersCollection(db).findOne({ _id: customerObjectId })
      : null;

    const { installerIds, installerDocs } = await validateInstallerIds(
      db,
      body?.assignedInstallerIds ?? [],
      activeCompanyId,
      companyObjectId
    );

    const projectId =
      toObjectIdOrNull(body?.projectId) ??
      toObjectIdOrNull(planning?.projectId) ??
      toObjectIdOrNull(planning?.data?.projectId);
    const offerId =
      toObjectIdOrNull(body?.offerId) ??
      toObjectIdOrNull(planning?.offerId) ??
      toObjectIdOrNull(planning?.data?.offerId);

    const extractedAddress = extractAddressFromPlanning(planning, customer);
    const address = normalizeMontageAddress({
      ...extractedAddress,
      ...(body?.address ?? {}),
    });

    const now = new Date();
    const doc = {
      companyId: companyObjectId,
      projectId: projectId ?? null,
      planningId: planningObjectId,
      offerId: offerId ?? null,
      customerId: customerObjectId ?? null,
      title:
        safeString(body?.title) || buildMontageTitleFromPlanning(planning, customer),
      status: normalizedStatus,
      paymentStatus: normalizedPaymentStatus,
      montageReady: body?.montageReady === true,
      startDate: startDate ?? null,
      endDate: endDate ?? null,
      startTime: startTime ?? null,
      endTime: endTime ?? null,
      assignedInstallerIds: installerIds,
      address,
      notes: safeString(body?.notes),
      checklist: body?.checklist
        ? normalizeMontageChecklist({
            ...defaultMontageChecklist(),
            ...body.checklist,
          })
        : defaultMontageChecklist(),
      createdAt: now,
      updatedAt: now,
      createdBy: userObjectId,
    };

    const result = await getMontagesCollection(db).insertOne(doc);
    const inserted = {
      ...doc,
      _id: result.insertedId,
    };

    const item = normalizeMontage(inserted, {
      installersById: new Map(installerDocs.map((user: any) => [mongoIdToString(user?._id), user])),
      customerById: customer ? new Map([[mongoIdToString(customer?._id), customer]]) : new Map(),
      planningById: new Map([[mongoIdToString(planning?._id), planning]]),
    });

    return jsonResponse(origin, { ok: true, item }, 200);
  } catch (e: any) {
    console.error("CREATE MONTAGE ERROR:", e);
    const status = String(e?.message || "").includes("assignedInstallerIds") ? 400 : 500;
    return jsonResponse(
      origin,
      { ok: false, error: e?.message || "Unknown error" },
      status
    );
  }
}
