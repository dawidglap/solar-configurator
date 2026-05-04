import { getDb } from "@/lib/db";
import { readSession, safeString } from "@/lib/api-session";
import {
  TRASH_TYPES,
  deletedDocumentFilter,
  getCollectionForType,
  getTrashPermissions,
  jsonResponse,
  normalizeTrashItem,
  normalizeTrashType,
  noStoreHeaders,
  type TrashType,
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

async function fetchDeletedItems(
  db: Awaited<ReturnType<typeof getDb>>,
  companyId: string,
  type: TrashType,
) {
  const docs = await getCollectionForType(db, type)
    .find({
      companyId,
      ...deletedDocumentFilter(),
    })
    .sort({ deletedAt: -1 })
    .limit(500)
    .toArray();

  return docs.map((doc) => normalizeTrashItem(type, doc));
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

  const permissions = getTrashPermissions(session);
  if (!permissions.canViewTrash) {
    return jsonResponse(origin, { ok: true, items: [], permissions }, 200);
  }

  const { searchParams } = new URL(req.url);
  const rawType = searchParams.get("type");
  const typeParam = normalizeTrashType(rawType);
  const q = safeString(searchParams.get("q")).toLowerCase();

  if (rawType && !typeParam) {
    return jsonResponse(origin, { ok: false, error: "Invalid trash type" }, 400);
  }

  const requestedTypes = typeParam ? [typeParam] : [...TRASH_TYPES];

  try {
    const db = await getDb();
    const companyId = String(session.activeCompanyId);

    const groups = await Promise.all(
      requestedTypes.map((type) => fetchDeletedItems(db, companyId, type)),
    );

    let items = groups.flat();

    if (q) {
      items = items.filter((item) => {
        const haystack = [
          item.title,
          item.subtitle,
          item.deletedByName,
          item.deletedByEmail,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return haystack.includes(q);
      });
    }

    items.sort((a, b) => {
      const aTime = new Date(a.deletedAt).getTime() || 0;
      const bTime = new Date(b.deletedAt).getTime() || 0;
      return bTime - aTime;
    });

    return jsonResponse(origin, { ok: true, items, permissions }, 200);
  } catch (e: any) {
    console.error("GET TRASH ERROR:", e);
    return jsonResponse(
      origin,
      { ok: false, error: e?.message || "Unknown error" },
      500,
    );
  }
}
