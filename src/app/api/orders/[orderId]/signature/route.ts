import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { readSession, safeString } from "@/lib/api-session";
import { enforceActiveSubscription } from "@/lib/subscription";
import {
  buildSignatureResponse,
  ensureOrderSignatureIndexes,
  expireSignatureIfNeeded,
} from "@/lib/orderSignatures";
import { getOrderIdQuery } from "@/lib/orderIds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function response(origin: string | null, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...getCorsHeaders(origin) },
  });
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: getCorsHeaders(req.headers.get("origin")) });
}

export async function GET(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) return response(origin, { ok: false, message: "SESSION_SECRET fehlt." }, 500);
  const session = readSession(req, secret);
  if (!session?.activeCompanyId) return response(origin, { ok: false, message: "Nicht eingeloggt." }, 401);
  const { orderId } = await params;
  const normalizedOrderId = safeString(orderId);
  if (!normalizedOrderId) return response(origin, { ok: false, message: "Ungültige Auftragsnummer." }, 400);

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;
    await ensureOrderSignatureIndexes(db);
    let planning: any = await db.collection("plannings").findOne({
      companyId: String(session.activeCompanyId),
      orderId: getOrderIdQuery(normalizedOrderId),
    });
    if (!planning) return response(origin, { ok: false, message: "Auftrag nicht gefunden." }, 404);
    planning = await expireSignatureIfNeeded(db, planning);
    return response(origin, { ok: true, signature: buildSignatureResponse(planning) }, 200);
  } catch (error) {
    console.error("GET ORDER SIGNATURE ERROR:", error);
    return response(origin, { ok: false, message: "Signaturstatus konnte nicht geladen werden." }, 500);
  }
}
