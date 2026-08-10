import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { readSession, safeString, toObjectIdOrNull } from "@/lib/api-session";
import { canManageOrderSignatures } from "@/lib/orderSignatures";
import { enforceActiveSubscription } from "@/lib/subscription";
import { buildOfferAuditEntry, buildOfferSignatureResponse, ensureOfferSignatureIndexes } from "@/lib/offerSignatures";

export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;
const response = (origin: string | null, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...getCorsHeaders(origin) } });
export async function OPTIONS(req: Request) { return new Response(null, { status: 204, headers: getCorsHeaders(req.headers.get("origin")) }); }
export async function POST(req: Request, { params }: { params: Promise<{ planningId: string }> }) {
  const origin = req.headers.get("origin"); const secret = process.env.SESSION_SECRET;
  if (!secret) return response(origin, { ok: false, message: "SESSION_SECRET fehlt." }, 500);
  const session = readSession(req, secret); if (!session?.activeCompanyId) return response(origin, { ok: false, message: "Nicht eingeloggt." }, 401);
  if (!canManageOrderSignatures(session)) return response(origin, { ok: false, message: "Keine Berechtigung." }, 403);
  const id = toObjectIdOrNull((await params).planningId); if (!id) return response(origin, { ok: false, message: "Ungültige Planning-ID." }, 400);
  try {
    const db = await getDb(); const subscriptionError = await enforceActiveSubscription(db, origin, session); if (subscriptionError) return subscriptionError; await ensureOfferSignatureIndexes(db);
    const planning = await db.collection<any>("plannings").findOne({ _id: id, companyId: String(session.activeCompanyId) });
    if (!planning) return response(origin, { ok: false, message: "Planung nicht gefunden." }, 404);
    if (safeString(planning?.offerSignatureStatus) === "signed") return response(origin, { ok: false, message: "Eine unterschriebene Offerte kann nicht widerrufen werden." }, 409);
    const now = new Date();
    await db.collection<any>("plannings").updateOne({ _id: id }, { $set: { offerSignatureStatus: "none", offerSignatureTokenHash: null, offerSignatureProcessingId: null, offerSignatureProcessingAt: null, updatedAt: now }, $push: { offerSignatureAudit: buildOfferAuditEntry({ event: "revoked", req, at: now }) as never } });
    const updated = await db.collection("plannings").findOne({ _id: id });
    return response(origin, { ok: true, signature: buildOfferSignatureResponse(updated) });
  } catch (error) { console.error("OFFER SIGNATURE CANCEL ERROR:", error); return response(origin, { ok: false, message: "Signaturanfrage konnte nicht widerrufen werden." }, 500); }
}
