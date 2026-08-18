import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { safeString, toObjectIdOrNull } from "@/lib/api-session";
import { fetchPlanningFileBuffer, getPlanningFilesCollection } from "@/lib/planningFiles";
import {
  buildContentDispositionInline,
  enforcePublicSignatureIpRateLimit,
  ensureOrderSignatureIndexes,
  expireSignatureIfNeeded,
  findPlanningByPublicSignatureToken,
  normalizeSignatureStatus,
} from "@/lib/orderSignatures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function errorResponse(origin: string | null, message: string, status: number) {
  return new Response(JSON.stringify({ ok: false, message }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...getCorsHeaders(origin) },
  });
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: getCorsHeaders(req.headers.get("origin")) });
}

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const origin = req.headers.get("origin");
  const { token } = await params;
  try {
    const db = await getDb();
    await ensureOrderSignatureIndexes(db);
    if (!(await enforcePublicSignatureIpRateLimit(db, req))) {
      return errorResponse(origin, "Zu viele Anfragen. Bitte später erneut versuchen.", 429);
    }
    let planning: any = await findPlanningByPublicSignatureToken(db, safeString(token));
    if (!planning) return errorResponse(origin, "Link ungültig.", 404);
    planning = await expireSignatureIfNeeded(db, planning, token);
    if (!planning) return errorResponse(origin, "Link ungültig.", 404);
    const status = normalizeSignatureStatus(planning?.signatureStatus);
    if (status === "expired") return errorResponse(origin, "Der Signaturlink ist abgelaufen.", 409);
    if (!["sent", "viewed", "signed"].includes(status)) {
      return errorResponse(origin, "Der Signaturlink ist nicht mehr gültig.", 409);
    }
    const fileId = toObjectIdOrNull(status === "signed" ? planning?.signedPdfFileId : planning?.orderSnapshotFileId);
    if (!fileId) return errorResponse(origin, "Auftrags-PDF nicht gefunden.", 404);
    const file = await getPlanningFilesCollection(db).findOne({
      _id: fileId,
      companyId: safeString(planning?.companyId),
      planningId: planning._id.toString(),
      isDeleted: { $ne: true },
    });
    if (!file) return errorResponse(origin, "Auftrags-PDF nicht gefunden.", 404);
    const buffer = await fetchPlanningFileBuffer(file);
    if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
      return errorResponse(origin, "Auftrags-PDF ist ungültig.", 502);
    }
    const fileName =
      safeString(file?.originalFileName) ||
      `${status === "signed" ? "auftragsbestaetigung-unterschrieben" : "auftragsbestaetigung"}-${safeString(planning?.orderId)}.pdf`;
    return new Response(buffer, {
      status: 200,
      headers: {
        ...getCorsHeaders(origin),
        "Content-Type": "application/pdf",
        "Content-Disposition": buildContentDispositionInline(fileName),
        "Content-Length": String(buffer.byteLength),
        "Content-Security-Policy": "frame-ancestors https://app.helionic.ch https://*.lovableproject.com",
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("GET PUBLIC SIGNATURE PDF ERROR:", error);
    return errorResponse(origin, "Auftrags-PDF konnte nicht geladen werden.", 500);
  }
}
