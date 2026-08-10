import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { safeString } from "@/lib/api-session";
import { buildOfferAuditEntry, enforceOfferPublicRateLimit, ensureActiveOfferToken, ensureOfferSignatureIndexes, findOfferByToken } from "@/lib/offerSignatures";

export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;
const response = (origin: string | null, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...getCorsHeaders(origin) } });
export async function OPTIONS(req: Request) { return new Response(null, { status: 204, headers: getCorsHeaders(req.headers.get("origin")) }); }
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const origin = req.headers.get("origin"); const token = safeString((await params).token);
  try {
    const db = await getDb(); await ensureOfferSignatureIndexes(db); if (!(await enforceOfferPublicRateLimit(db, req))) return response(origin, { ok: false, message: "Zu viele Anfragen." }, 429);
    let planning = await findOfferByToken(db, token); if (!planning) return response(origin, { ok: false, message: "Link ungültig." }, 404); planning = await ensureActiveOfferToken(db, planning); if (!planning || !["sent", "viewed"].includes(planning.offerSignatureStatus)) return response(origin, { ok: false, message: "Offerte kann nicht abgelehnt werden." }, 409);
    const reason = safeString((await req.json().catch(() => ({})))?.reason); if (!reason) return response(origin, { ok: false, message: "Ein Ablehnungsgrund ist erforderlich." }, 400); if (reason.length > 1000) return response(origin, { ok: false, message: "Der Ablehnungsgrund darf maximal 1000 Zeichen lang sein." }, 400);
    const now = new Date(); const result = await db.collection<any>("plannings").updateOne({ _id: planning._id, offerSignatureTokenHash: planning.offerSignatureTokenHash, offerSignatureStatus: { $in: ["sent", "viewed"] } }, { $set: { offerSignatureStatus: "declined", offerSignatureTokenHash: null, offerSignatureDeclinedReason: reason, offerSignatureProcessingId: null, offerSignatureProcessingAt: null, updatedAt: now }, $push: { offerSignatureAudit: buildOfferAuditEntry({ event: "declined", req, tokenHash: planning.offerSignatureTokenHash, at: now, meta: { reason } }) as never } });
    if (!result.matchedCount) return response(origin, { ok: false, message: "Offerte wurde bereits bearbeitet." }, 409);
    return response(origin, { ok: true, planningId: String(planning._id), status: "declined" });
  } catch (error) { console.error("DECLINE PUBLIC OFFER ERROR:", error); return response(origin, { ok: false, message: "Ablehnung konnte nicht gespeichert werden." }, 500); }
}
