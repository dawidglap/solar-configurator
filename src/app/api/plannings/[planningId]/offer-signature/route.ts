import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { readSession, toObjectIdOrNull } from "@/lib/api-session";
import { enforceActiveSubscription } from "@/lib/subscription";
import { buildOfferSignatureResponse, ensureOfferSignatureIndexes } from "@/lib/offerSignatures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
const response = (origin: string | null, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...getCorsHeaders(origin) } });
export async function OPTIONS(req: Request) { return new Response(null, { status: 204, headers: getCorsHeaders(req.headers.get("origin")) }); }

export async function GET(req: Request, { params }: { params: Promise<{ planningId: string }> }) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) return response(origin, { ok: false, message: "SESSION_SECRET fehlt." }, 500);
  const session = readSession(req, secret);
  if (!session?.activeCompanyId) return response(origin, { ok: false, message: "Nicht eingeloggt." }, 401);
  const { planningId } = await params;
  const id = toObjectIdOrNull(planningId);
  if (!id) return response(origin, { ok: false, message: "Ungültige Planning-ID." }, 400);
  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;
    await ensureOfferSignatureIndexes(db);
    const planning = await db.collection("plannings").findOne({ _id: id, companyId: String(session.activeCompanyId) });
    if (!planning) return response(origin, { ok: false, message: "Planung nicht gefunden." }, 404);
    return response(origin, { ok: true, signature: buildOfferSignatureResponse(planning) });
  } catch (error) {
    console.error("GET OFFER SIGNATURE ERROR:", error);
    return response(origin, { ok: false, message: "Offerten-Signaturstatus konnte nicht geladen werden." }, 500);
  }
}

