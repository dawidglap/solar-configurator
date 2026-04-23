import { getCorsHeaders } from "@/lib/cors";

export const runtime = "nodejs";

type SnapshotCacheEntry = {
  snapshotDataUrl: string;
  type: string;
  createdAt: string;
  expiresAt: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __helionicSnapshotCache:
    | Map<string, SnapshotCacheEntry>
    | undefined;
}

function getCache() {
  if (!globalThis.__helionicSnapshotCache) {
    globalThis.__helionicSnapshotCache = new Map();
  }
  return globalThis.__helionicSnapshotCache;
}

function jsonResponse(origin: string | null, body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...getCorsHeaders(origin),
    },
  });
}

function cleanupExpired() {
  const cache = getCache();
  const now = Date.now();

  for (const [key, value] of cache.entries()) {
    if (value.expiresAt < now) {
      cache.delete(key);
    }
  }
}

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
  const { planningId } = await params;

  cleanupExpired();

  const body = await req.json().catch(() => null);

  const snapshotDataUrl =
    typeof body?.snapshotDataUrl === "string" ? body.snapshotDataUrl : "";

  if (!snapshotDataUrl.startsWith("data:image/")) {
    return jsonResponse(origin, {
      ok: false,
      error: "Invalid snapshotDataUrl",
    }, 400);
  }

  const cache = getCache();

  cache.set(planningId, {
    snapshotDataUrl,
    type: typeof body?.type === "string" ? body.type : "module-layout",
    createdAt:
      typeof body?.createdAt === "string"
        ? body.createdAt
        : new Date().toISOString(),
    expiresAt: Date.now() + 1000 * 60 * 60, // 1h
  });

  return jsonResponse(origin, {
    ok: true,
    cached: true,
    planningId,
  });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ planningId: string }> }
) {
  const origin = req.headers.get("origin");
  const { planningId } = await params;

  cleanupExpired();

  const cache = getCache();
  const entry = cache.get(planningId);

  if (!entry) {
    return jsonResponse(origin, {
      ok: false,
      error: "Snapshot not found",
    }, 404);
  }

  return jsonResponse(origin, {
    ok: true,
    snapshot: {
      snapshotDataUrl: entry.snapshotDataUrl,
      type: entry.type,
      createdAt: entry.createdAt,
    },
  });
}