import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { readSession, safeString } from "@/lib/api-session";
import { enforceActiveSubscription } from "@/lib/subscription";
import {
  buildSignatureAuditEntry,
  buildSignatureLink,
  canManageOrderSignatures,
  ensureOrderSignatureIndexes,
  expireSignatureIfNeeded,
} from "@/lib/orderSignatures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function response(origin: string | null, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...getCorsHeaders(origin) } });
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: getCorsHeaders(req.headers.get("origin")) });
}

export async function POST(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) return response(origin, { ok: false, message: "SESSION_SECRET fehlt." }, 500);
  const session = readSession(req, secret);
  if (!session?.activeCompanyId) return response(origin, { ok: false, message: "Nicht eingeloggt." }, 401);
  if (!canManageOrderSignatures(session)) return response(origin, { ok: false, message: "Keine Berechtigung." }, 403);
  const { orderId } = await params;
  const normalizedOrderId = safeString(orderId);
  const body = await req.json().catch(() => ({}));
  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;
    await ensureOrderSignatureIndexes(db);
    let planning: any = await db.collection<any>("plannings").findOne({ companyId: String(session.activeCompanyId), orderId: normalizedOrderId });
    if (!planning) return response(origin, { ok: false, message: "Auftrag nicht gefunden." }, 404);
    planning = await expireSignatureIfNeeded(db, planning, safeString(planning?.signatureToken));
    if (!planning) {
      return response(origin, { ok: false, message: "Die Signaturanfrage ist nicht mehr gültig." }, 409);
    }
    if (!["sent", "viewed"].includes(safeString(planning?.signatureStatus)) || !safeString(planning?.signatureToken)) {
      return response(origin, { ok: false, message: "Für diesen Auftrag ist keine aktive Signaturanfrage vorhanden." }, 409);
    }
    const lastReminder = [...(Array.isArray(planning?.signatureAudit) ? planning.signatureAudit : [])]
      .reverse()
      .find((entry: any) => safeString(entry?.event) === "reminded");
    const lastAt = lastReminder?.at ? new Date(lastReminder.at) : null;
    if (lastAt && !Number.isNaN(lastAt.getTime()) && Date.now() - lastAt.getTime() < 3_600_000) {
      return response(origin, { ok: false, message: "Eine Erinnerung ist nur einmal pro Stunde möglich." }, 429);
    }
    const requestedDays = body?.expiresInDays == null ? null : Number(body.expiresInDays);
    if (
      requestedDays != null &&
      (!Number.isFinite(requestedDays) ||
        !Number.isInteger(requestedDays) ||
        requestedDays < 1 ||
        requestedDays > 90)
    ) {
      return response(
        origin,
        { ok: false, message: "expiresInDays muss eine ganze Zahl zwischen 1 und 90 sein." },
        400,
      );
    }
    const now = new Date();
    const expiresAt = requestedDays == null
      ? planning.signatureTokenExpiresAt
      : new Date(now.getTime() + requestedDays * 86_400_000);
    await db.collection<any>("plannings").updateOne(
      { _id: planning._id, signatureStatus: { $in: ["sent", "viewed"] } },
      {
        $set: { signatureTokenExpiresAt: expiresAt, updatedAt: now },
        $push: {
          signatureAudit: buildSignatureAuditEntry({
            event: "reminded",
            req,
            at: now,
            meta: { expiresInDays: requestedDays },
          }) as never,
        },
      },
    );
    const token = safeString(planning.signatureToken);
    return response(origin, { ok: true, token, link: buildSignatureLink(token), expiresAt: new Date(expiresAt).toISOString() }, 200);
  } catch (error) {
    console.error("SIGNATURE REMINDER ERROR:", error);
    return response(origin, { ok: false, message: "Erinnerung konnte nicht erstellt werden." }, 500);
  }
}
