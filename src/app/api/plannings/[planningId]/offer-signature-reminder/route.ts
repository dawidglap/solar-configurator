import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { readSession, safeString, toObjectIdOrNull } from "@/lib/api-session";
import { canManageOrderSignatures } from "@/lib/orderSignatures";
import { enforceActiveSubscription } from "@/lib/subscription";
import { buildOfferAuditEntry, buildOfferSignatureLink, ensureOfferSignatureIndexes, newOfferSignatureToken } from "@/lib/offerSignatures";

export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;
const response = (origin: string | null, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...getCorsHeaders(origin) } });
export async function OPTIONS(req: Request) { return new Response(null, { status: 204, headers: getCorsHeaders(req.headers.get("origin")) }); }
export async function POST(req: Request, { params }: { params: Promise<{ planningId: string }> }) {
  const origin = req.headers.get("origin"); const secret = process.env.SESSION_SECRET;
  if (!secret) return response(origin, { ok: false, message: "SESSION_SECRET fehlt." }, 500);
  const session = readSession(req, secret);
  if (!session?.activeCompanyId) return response(origin, { ok: false, message: "Nicht eingeloggt." }, 401);
  if (!canManageOrderSignatures(session)) return response(origin, { ok: false, message: "Keine Berechtigung." }, 403);
  const id = toObjectIdOrNull((await params).planningId);
  if (!id) return response(origin, { ok: false, message: "Ungültige Planning-ID." }, 400);
  try {
    const body = await req.json().catch(() => ({}));
    const days = Number(body?.expiresInDays ?? 30);
    if (!Number.isInteger(days) || days < 1 || days > 90) return response(origin, { ok: false, message: "expiresInDays muss eine ganze Zahl zwischen 1 und 90 sein." }, 400);
    const db = await getDb(); const subscriptionError = await enforceActiveSubscription(db, origin, session); if (subscriptionError) return subscriptionError;
    await ensureOfferSignatureIndexes(db);
    const planning = await db.collection<any>("plannings").findOne({ _id: id, companyId: String(session.activeCompanyId) });
    if (!planning) return response(origin, { ok: false, message: "Planung nicht gefunden." }, 404);
    if (!["sent", "viewed"].includes(safeString(planning?.offerSignatureStatus))) return response(origin, { ok: false, message: "Keine aktive Offerten-Signaturanfrage vorhanden." }, 409);
    const { token, hash } = newOfferSignatureToken(); const now = new Date(); const expiresAt = new Date(now.getTime() + days * 86_400_000);
    await db.collection<any>("plannings").updateOne({ _id: id, offerSignatureStatus: { $in: ["sent", "viewed"] } }, { $set: { offerSignatureStatus: "sent", offerSignatureTokenHash: hash, offerSignatureTokenExpiresAt: expiresAt, offerSignatureViewedAt: null, updatedAt: now }, $push: { offerSignatureAudit: buildOfferAuditEntry({ event: "reminded", req, tokenHash: hash, at: now }) as never } });
    return response(origin, { ok: true, token, link: buildOfferSignatureLink(token), expiresAt: expiresAt.toISOString() });
  } catch (error) { console.error("OFFER SIGNATURE REMINDER ERROR:", error); return response(origin, { ok: false, message: "Erinnerung konnte nicht erstellt werden." }, 500); }
}

