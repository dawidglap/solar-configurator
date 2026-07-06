import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { readSession } from "@/lib/api-session";
import { enforceActiveSubscription } from "@/lib/subscription";
import {
  createCompanyDocumentDownloadResponse,
  ensureCompanyDocumentIndexes,
  normalizeCompanyDocumentKind,
} from "@/lib/companyDocuments";

export const runtime = "nodejs";

function jsonResponse(origin: string | null, body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...getCorsHeaders(origin),
    },
  });
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    return jsonResponse(origin, { ok: false, message: "SESSION_SECRET fehlt." }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, message: "Nicht eingeloggt." }, 401);
  }

  const { kind: rawKind } = await params;
  const kind = normalizeCompanyDocumentKind(rawKind);
  if (!kind) {
    return jsonResponse(origin, { ok: false, message: "Dokumenttyp ist ungültig." }, 400);
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session as any);
    if (subscriptionError) return subscriptionError;
    await ensureCompanyDocumentIndexes(db);

    const response = await createCompanyDocumentDownloadResponse({
      db,
      companyId: String(session.activeCompanyId),
      kind,
    });

    if (!response) {
      return jsonResponse(origin, { ok: false, message: "Dokument nicht gefunden." }, 404);
    }

    for (const [key, value] of Object.entries(getCorsHeaders(origin))) {
      response.headers.set(key, value);
    }

    return response;
  } catch (error: any) {
    console.error("DOWNLOAD COMPANY DOCUMENT ERROR:", error);
    return jsonResponse(origin, { ok: false, message: "Dokument konnte nicht geladen werden." }, 500);
  }
}
