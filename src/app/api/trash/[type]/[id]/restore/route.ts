import { getDb } from "@/lib/db";
import { readSession } from "@/lib/api-session";
import {
  buildRestoreUnsetFields,
  getCollectionForType,
  getScopedTrashFilter,
  getTrashPermissions,
  jsonResponse,
  noStoreHeaders,
  normalizeTrashType,
} from "@/lib/trash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: noStoreHeaders(origin),
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ type: string; id: string }> },
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

  const permissions = getTrashPermissions(session);
  if (!permissions.canRestore) {
    return jsonResponse(origin, { ok: false, error: "Forbidden" }, 403);
  }

  const { type: rawType, id } = await params;
  const type = normalizeTrashType(rawType);

  if (!type) {
    return jsonResponse(origin, { ok: false, error: "Invalid trash type" }, 400);
  }

  const filter = getScopedTrashFilter(type, id, String(session.activeCompanyId));
  if (!filter) {
    return jsonResponse(origin, { ok: false, error: "Invalid id" }, 400);
  }

  try {
    const db = await getDb();
    const collection = getCollectionForType(db, type);

    const result = await collection.updateOne(filter, {
      $unset: buildRestoreUnsetFields(),
      $set: { updatedAt: new Date() },
    });

    if (!result.matchedCount) {
      return jsonResponse(origin, { ok: false, error: "Trash item not found" }, 404);
    }

    if (type === "customer") {
      await db.collection("plannings").updateMany(
        {
          companyId: String(session.activeCompanyId),
          deletedCascadeParentType: "customer",
          deletedCascadeParentId: id,
        },
        {
          $unset: buildRestoreUnsetFields(),
          $set: { updatedAt: new Date() },
        },
      );
    }

    return jsonResponse(origin, { ok: true }, 200);
  } catch (e: any) {
    if (e?.code === 11000) {
      return jsonResponse(
        origin,
        {
          ok: false,
          error: "restore_conflict",
          message:
            "Dieses Element kann nicht wiederhergestellt werden, weil bereits ein aktives Element mit denselben Identitätsdaten existiert.",
        },
        409,
      );
    }

    console.error("RESTORE TRASH ITEM ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message || "Unknown error" },
      500,
    );
  }
}
