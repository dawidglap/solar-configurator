import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { safeString } from "@/lib/api-session";
import { downloadCompanyDocumentBuffer } from "@/lib/companyDocuments";
import { enforceOfferPublicRateLimit, ensureActiveOfferToken, ensureOfferSignatureIndexes, findOfferByToken } from "@/lib/offerSignatures";

export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;
const errorResponse = (origin: string | null, message: string, status: number) => new Response(JSON.stringify({ ok: false, message }), { status, headers: { "Content-Type": "application/json", ...getCorsHeaders(origin) } });
export async function OPTIONS(req: Request) { return new Response(null, { status: 204, headers: getCorsHeaders(req.headers.get("origin")) }); }
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const origin = req.headers.get("origin"); const token = safeString((await params).token);
  try {
    const db = await getDb(); await ensureOfferSignatureIndexes(db); if (!(await enforceOfferPublicRateLimit(db, req))) return errorResponse(origin, "Zu viele Anfragen.", 429);
    let planning = await findOfferByToken(db, token); if (!planning) return errorResponse(origin, "Link ungültig.", 404); planning = await ensureActiveOfferToken(db, planning); if (!planning) return errorResponse(origin, "Link ungültig.", 404);
    const terms = await downloadCompanyDocumentBuffer(db, safeString(planning.companyId), "agb"); if (!terms) return errorResponse(origin, "AGB nicht gefunden.", 404);
    return new Response(terms.buffer, { status: 200, headers: { ...getCorsHeaders(origin), "Content-Type": "application/pdf", "Content-Disposition": "inline; filename=agb.pdf", "Cache-Control": "private, no-store", "Content-Security-Policy": "frame-ancestors https://app.helionic.ch https://*.lovableproject.com" } });
  } catch (error) { console.error("GET PUBLIC OFFER TERMS ERROR:", error); return errorResponse(origin, "AGB konnten nicht geladen werden.", 500); }
}

