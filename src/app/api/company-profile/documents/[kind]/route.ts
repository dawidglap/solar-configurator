import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { readSession, safeString } from "@/lib/api-session";
import { enforceActiveSubscription } from "@/lib/subscription";
import {
  canManageCompanyDocuments,
  deleteCompanyDocument,
  ensureCompanyDocumentIndexes,
  normalizeCompanyDocumentKind,
  getPublicCompanyDocumentUrl,
  uploadCompanyDocument,
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

export async function POST(
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

  if (!canManageCompanyDocuments(session)) {
    return jsonResponse(origin, { ok: false, message: "Keine Berechtigung." }, 403);
  }

  const { kind: rawKind } = await params;
  const kind = normalizeCompanyDocumentKind(rawKind);
  if (!kind) {
    return jsonResponse(origin, {
      ok: false,
      message: "Nur AGB-Dokumente werden unterstützt.",
      code: "UNSUPPORTED_DOCUMENT_KIND",
    }, 400);
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return jsonResponse(origin, { ok: false, message: "PDF-Datei fehlt." }, 400);
    }

    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session as any);
    if (subscriptionError) return subscriptionError;
    await ensureCompanyDocumentIndexes(db);

    const storedDocument = await uploadCompanyDocument({
      db,
      companyId: String(session.activeCompanyId),
      kind,
      file,
      session: session as any,
    });
    const publicUrl = storedDocument
      ? getPublicCompanyDocumentUrl({
          baseUrl: new URL(req.url).origin,
          companyId: String(session.activeCompanyId),
          document: storedDocument,
          secret,
        })
      : null;
    const document = storedDocument ? { ...storedDocument, url: publicUrl } : storedDocument;

    return jsonResponse(origin, { ok: true, document }, 200);
  } catch (error: any) {
    const message = safeString(error?.message) || "Dokument konnte nicht hochgeladen werden.";
    const status =
      message === "Nur PDF-Dateien sind erlaubt." ||
      message === "Nur gültige PDF-Dateien sind erlaubt." ||
      message === "Datei überschreitet 10 MB."
        ? 400
        : 500;
    console.error("UPLOAD COMPANY DOCUMENT ERROR:", error);
    return jsonResponse(origin, { ok: false, message }, status);
  }
}

export async function DELETE(
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

  if (!canManageCompanyDocuments(session)) {
    return jsonResponse(origin, { ok: false, message: "Keine Berechtigung." }, 403);
  }

  const { kind: rawKind } = await params;
  const kind = normalizeCompanyDocumentKind(rawKind);
  if (!kind) {
    return jsonResponse(origin, {
      ok: false,
      message: "Nur AGB-Dokumente werden unterstützt.",
      code: "UNSUPPORTED_DOCUMENT_KIND",
    }, 400);
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session as any);
    if (subscriptionError) return subscriptionError;
    await ensureCompanyDocumentIndexes(db);

    await deleteCompanyDocument(db, String(session.activeCompanyId), kind);
    return jsonResponse(origin, { ok: true }, 200);
  } catch (error: any) {
    console.error("DELETE COMPANY DOCUMENT ERROR:", error);
    return jsonResponse(origin, { ok: false, message: "Dokument konnte nicht gelöscht werden." }, 500);
  }
}
