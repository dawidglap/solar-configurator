import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { safeString } from "@/lib/api-session";
import { buildPublicOffer, buildOfferAuditEntry, enforceOfferPublicRateLimit, ensureActiveOfferToken, ensureOfferSignatureIndexes, findOfferByToken } from "@/lib/offerSignatures";
import { emitCompanyRealtimeEvent } from "@/lib/realtime";

export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;
const response = (origin: string | null, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...getCorsHeaders(origin) } });
export async function OPTIONS(req: Request) { return new Response(null, { status: 204, headers: getCorsHeaders(req.headers.get("origin")) }); }
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const origin = req.headers.get("origin"); const token = safeString((await params).token);
  try {
    const db = await getDb(); await ensureOfferSignatureIndexes(db);
    if (!(await enforceOfferPublicRateLimit(db, req))) return response(origin, { ok: false, message: "Zu viele Anfragen." }, 429);
    let planning = await findOfferByToken(db, token); if (!planning) return response(origin, { ok: false, message: "Link ungültig." }, 404);
    planning = await ensureActiveOfferToken(db, planning); if (!planning) return response(origin, { ok: false, message: "Link ungültig." }, 404);
    if (planning.offerSignatureStatus === "sent") {
      const now = new Date();
      const viewed = await db.collection<any>("plannings").findOneAndUpdate(
        { _id: planning._id, offerSignatureTokenHash: planning.offerSignatureTokenHash, offerSignatureStatus: "sent" },
        { $set: { offerSignatureStatus: "viewed", offerSignatureViewedAt: now, updatedAt: now }, $push: { offerSignatureAudit: buildOfferAuditEntry({ event: "viewed", req, tokenHash: planning.offerSignatureTokenHash, at: now }) as never } },
        { returnDocument: "after", includeResultMetadata: false },
      );
      if (viewed) {
        await emitCompanyRealtimeEvent(safeString(viewed?.companyId), "offer.viewed", {
          planningId: String(viewed._id),
          viewedAt: now.toISOString(),
        });
      }
      planning = viewed ?? (await findOfferByToken(db, token)); if (!planning) return response(origin, { ok: false, message: "Link ungültig." }, 404);
    }
    const offer = await buildPublicOffer({ db, planning, token, req });
    return response(origin, { ok: true, offer, ...offer });
  } catch (error) { console.error("GET PUBLIC OFFER SIGNATURE ERROR:", error); return response(origin, { ok: false, message: "Offerte konnte nicht geladen werden." }, 500); }
}
