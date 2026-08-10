import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { safeString } from "@/lib/api-session";
import { buildContentDispositionInline, enforceOfferPublicRateLimit, ensureActiveOfferToken, ensureOfferSignatureIndexes, findOfferByToken, getOfferPublicFile } from "@/lib/offerSignatures";

export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;
const errorResponse = (origin: string | null, message: string, status: number) => new Response(JSON.stringify({ ok: false, message }), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...getCorsHeaders(origin) } });
export async function OPTIONS(req: Request) { return new Response(null, { status: 204, headers: getCorsHeaders(req.headers.get("origin")) }); }
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const origin = req.headers.get("origin"); const token = safeString((await params).token);
  try {
    const db = await getDb(); await ensureOfferSignatureIndexes(db);
    if (!(await enforceOfferPublicRateLimit(db, req))) return errorResponse(origin, "Zu viele Anfragen.", 429);
    let planning = await findOfferByToken(db, token); if (!planning) return errorResponse(origin, "Link ungültig.", 404);
    planning = await ensureActiveOfferToken(db, planning); if (!planning) return errorResponse(origin, "Link ungültig.", 404);
    const kind = safeString(new URL(req.url).searchParams.get("type")) || "snapshot";
    if (!["snapshot", "signed", "confirmation"].includes(kind)) return errorResponse(origin, "Ungültiger PDF-Typ.", 400);
    if (kind !== "snapshot" && planning.offerSignatureStatus !== "signed") return errorResponse(origin, "Dokument noch nicht verfügbar.", 404);
    const payload = await getOfferPublicFile(db, planning, kind); if (!payload) return errorResponse(origin, "PDF nicht gefunden.", 404);
    if (payload.buffer.subarray(0, 5).toString("ascii") !== "%PDF-") return errorResponse(origin, "PDF ist ungültig.", 502);
    return new Response(payload.buffer, { status: 200, headers: { ...getCorsHeaders(origin), "Content-Type": "application/pdf", "Content-Disposition": buildContentDispositionInline(safeString(payload.file?.originalFileName) || "offerte.pdf"), "Content-Length": String(payload.buffer.byteLength), "Content-Security-Policy": "frame-ancestors https://app.helionic.ch https://*.lovableproject.com", "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) { console.error("GET PUBLIC OFFER PDF ERROR:", error); return errorResponse(origin, "PDF konnte nicht geladen werden.", 500); }
}

