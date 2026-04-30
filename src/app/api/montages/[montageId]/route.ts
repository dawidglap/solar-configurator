import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import {
  jsonResponse,
  mongoIdToString,
  readSession,
  safeString,
  toObjectIdOrNull,
} from "@/lib/api-session";
import {
  assertCompanyScopedPlanning,
  ensureMontageIndexes,
  getCustomersCollection,
  getMontagesCollection,
  getPlanningsCollection,
  getUsersCollection,
  normalizeMontage,
  normalizeMontageAddress,
  normalizeMontageChecklist,
  normalizeMontageStatus,
  normalizeDateOrNull,
  normalizeTimeOrNull,
  validateInstallerIds,
} from "@/lib/montages";

export const runtime = "nodejs";

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

async function hydrateSingleMontage(db: Awaited<ReturnType<typeof getDb>>, doc: any) {
  const customerId = mongoIdToString(doc?.customerId);
  const planningId = mongoIdToString(doc?.planningId);
  const installerIds = Array.isArray(doc?.assignedInstallerIds)
    ? doc.assignedInstallerIds
        .map((value: any) => mongoIdToString(value))
        .filter(Boolean)
    : [];

  const [customer, planning, installers] = await Promise.all([
    customerId && toObjectIdOrNull(customerId)
      ? getCustomersCollection(db).findOne({
          _id: toObjectIdOrNull(customerId)!,
        })
      : Promise.resolve(null),
    planningId && toObjectIdOrNull(planningId)
      ? getPlanningsCollection(db).findOne({
          _id: toObjectIdOrNull(planningId)!,
        })
      : Promise.resolve(null),
    installerIds.length
      ? getUsersCollection(db)
          .find({
            _id: {
              $in: installerIds
                .map((id: string) => toObjectIdOrNull(id))
                .filter((id: ObjectId | null): id is ObjectId => !!id),
            },
          })
          .toArray()
      : Promise.resolve([]),
  ]);

  return normalizeMontage(doc, {
    customerById: customer
      ? new Map([[mongoIdToString(customer?._id), customer]])
      : new Map(),
    planningById: planning
      ? new Map([[mongoIdToString(planning?._id), planning]])
      : new Map(),
    installersById: new Map(
      installers.map((installer: any) => [mongoIdToString(installer?._id), installer])
    ),
  });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ montageId: string }> }
) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    return jsonResponse(origin, { ok: false, error: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }

  const { montageId } = await params;
  const activeCompanyId = String(session.activeCompanyId);
  const companyObjectId = toObjectIdOrNull(activeCompanyId);
  const montageObjectId = toObjectIdOrNull(montageId);

  if (!companyObjectId) {
    return jsonResponse(origin, { ok: false, error: "Invalid activeCompanyId" }, 400);
  }
  if (!montageObjectId) {
    return jsonResponse(origin, { ok: false, error: "Invalid montageId" }, 400);
  }

  try {
    const db = await getDb();
    await ensureMontageIndexes(db);

    const doc = await getMontagesCollection(db).findOne({
      _id: montageObjectId,
      companyId: companyObjectId,
    });

    if (!doc) {
      return jsonResponse(origin, { ok: false, error: "Montage not found" }, 404);
    }

    const item = await hydrateSingleMontage(db, doc);
    return jsonResponse(origin, { ok: true, item }, 200);
  } catch (e: any) {
    console.error("GET MONTAGE ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message || "Unknown error" },
      500
    );
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ montageId: string }> }
) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    return jsonResponse(origin, { ok: false, error: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }

  const { montageId } = await params;
  const activeCompanyId = String(session.activeCompanyId);
  const companyObjectId = toObjectIdOrNull(activeCompanyId);
  const montageObjectId = toObjectIdOrNull(montageId);

  if (!companyObjectId) {
    return jsonResponse(origin, { ok: false, error: "Invalid activeCompanyId" }, 400);
  }
  if (!montageObjectId) {
    return jsonResponse(origin, { ok: false, error: "Invalid montageId" }, 400);
  }

  const body = await req.json().catch(() => ({} as any));

  try {
    const db = await getDb();
    await ensureMontageIndexes(db);

    const existing = await getMontagesCollection(db).findOne({
      _id: montageObjectId,
      companyId: companyObjectId,
    });

    if (!existing) {
      return jsonResponse(origin, { ok: false, error: "Montage not found" }, 404);
    }

    const setObj: Record<string, any> = {
      updatedAt: new Date(),
    };

    if ("title" in body) {
      setObj.title = safeString(body?.title);
    }

    if ("status" in body) {
      const status = normalizeMontageStatus(body?.status);
      if (!status) {
        return jsonResponse(origin, { ok: false, error: "Invalid status" }, 400);
      }
      setObj.status = status;
    }

    if ("startDate" in body) {
      const startDate = normalizeDateOrNull(body?.startDate);
      if (startDate === undefined) {
        return jsonResponse(origin, { ok: false, error: "Invalid startDate" }, 400);
      }
      setObj.startDate = startDate;
    }

    if ("endDate" in body) {
      const endDate = normalizeDateOrNull(body?.endDate);
      if (endDate === undefined) {
        return jsonResponse(origin, { ok: false, error: "Invalid endDate" }, 400);
      }
      setObj.endDate = endDate;
    }

    if ("startTime" in body) {
      const startTime = normalizeTimeOrNull(body?.startTime);
      if (startTime === undefined) {
        return jsonResponse(origin, { ok: false, error: "Invalid startTime" }, 400);
      }
      setObj.startTime = startTime;
    }

    if ("endTime" in body) {
      const endTime = normalizeTimeOrNull(body?.endTime);
      if (endTime === undefined) {
        return jsonResponse(origin, { ok: false, error: "Invalid endTime" }, 400);
      }
      setObj.endTime = endTime;
    }

    let installerDocs: any[] = [];
    if ("assignedInstallerIds" in body) {
      const { installerIds, installerDocs: docs } = await validateInstallerIds(
        db,
        body?.assignedInstallerIds ?? [],
        activeCompanyId,
        companyObjectId
      );
      setObj.assignedInstallerIds = installerIds;
      installerDocs = docs;
    }

    if ("address" in body) {
      setObj.address = normalizeMontageAddress({
        ...(existing?.address ?? {}),
        ...(body?.address ?? {}),
      });
    }

    if ("notes" in body) {
      setObj.notes = safeString(body?.notes);
    }

    if ("checklist" in body) {
      setObj.checklist = normalizeMontageChecklist({
        ...(existing?.checklist ?? {}),
        ...(body?.checklist ?? {}),
      });
    }

    await getMontagesCollection(db).updateOne(
      {
        _id: montageObjectId,
        companyId: companyObjectId,
      },
      { $set: setObj }
    );

    if (typeof setObj.status === "string") {
      const planningId = mongoIdToString(existing?.planningId);
      const planning = planningId
        ? await assertCompanyScopedPlanning(db, planningId, activeCompanyId)
        : null;

      if (planning) {
        await getPlanningsCollection(db).updateOne(
          {
            _id: planning._id,
            companyId: activeCompanyId,
          },
          {
            $set: {
              "data.montageStatus": setObj.status,
              updatedAt: new Date(),
            },
          }
        );
      }
    }

    const updated = await getMontagesCollection(db).findOne({
      _id: montageObjectId,
      companyId: companyObjectId,
    });

    if (!updated) {
      return jsonResponse(origin, { ok: false, error: "Montage not found" }, 404);
    }

    const item = await hydrateSingleMontage(db, {
      ...updated,
      assignedInstallerIds:
        "assignedInstallerIds" in body
          ? setObj.assignedInstallerIds
          : updated.assignedInstallerIds,
    });

    void installerDocs;
    return jsonResponse(origin, { ok: true, item }, 200);
  } catch (e: any) {
    console.error("PATCH MONTAGE ERROR:", e);
    const status =
      /Invalid|assignedInstallerIds/i.test(String(e?.message || "")) ? 400 : 500;
    return jsonResponse(
      origin,
      { ok: false, error: e?.message || "Unknown error" },
      status
    );
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ montageId: string }> }
) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    return jsonResponse(origin, { ok: false, error: "Missing SESSION_SECRET" }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, error: "Not logged in" }, 401);
  }

  const { montageId } = await params;
  const companyObjectId = toObjectIdOrNull(session.activeCompanyId);
  const montageObjectId = toObjectIdOrNull(montageId);

  if (!companyObjectId) {
    return jsonResponse(origin, { ok: false, error: "Invalid activeCompanyId" }, 400);
  }
  if (!montageObjectId) {
    return jsonResponse(origin, { ok: false, error: "Invalid montageId" }, 400);
  }

  try {
    const db = await getDb();
    await ensureMontageIndexes(db);

    const result = await getMontagesCollection(db).deleteOne({
      _id: montageObjectId,
      companyId: companyObjectId,
    });

    if (!result.deletedCount) {
      return jsonResponse(origin, { ok: false, error: "Montage not found" }, 404);
    }

    return jsonResponse(origin, { ok: true }, 200);
  } catch (e: any) {
    console.error("DELETE MONTAGE ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message || "Unknown error" },
      500
    );
  }
}
