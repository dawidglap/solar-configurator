import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { safeString } from "@/lib/api-session";
import {
  buildSignatureAuditEntry,
  enforcePublicSignatureIpRateLimit,
  ensureOrderSignatureIndexes,
  expireSignatureIfNeeded,
  findPlanningByPublicSignatureToken,
  notifySignatureParticipants,
} from "@/lib/orderSignatures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function response(origin: string | null, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...getCorsHeaders(origin) } });
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: getCorsHeaders(req.headers.get("origin")) });
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const origin = req.headers.get("origin");
  const { token } = await params;
  try {
    const db = await getDb();
    await ensureOrderSignatureIndexes(db);
    if (!(await enforcePublicSignatureIpRateLimit(db, req))) {
      return response(origin, { ok: false, message: "Zu viele Anfragen. Bitte später erneut versuchen." }, 429);
    }
    let planning: any = await findPlanningByPublicSignatureToken(db, safeString(token));
    if (!planning) return response(origin, { ok: false, message: "Link ungültig." }, 404);
    planning = await expireSignatureIfNeeded(db, planning, token);
    if (!planning) return response(origin, { ok: false, message: "Link ungültig." }, 404);
    if (!["sent", "viewed"].includes(safeString(planning?.signatureStatus)) || safeString(planning?.signatureToken) !== token) {
      return response(origin, { ok: false, message: "Der Auftrag kann mit diesem Link nicht abgelehnt werden." }, 409);
    }
    const body = await req.json().catch(() => ({}));
    const reason = safeString(body?.reason);
    if (!reason) return response(origin, { ok: false, message: "Ein Ablehnungsgrund ist erforderlich." }, 400);
    if (reason.length > 1000) {
      return response(origin, { ok: false, message: "Der Ablehnungsgrund darf maximal 1000 Zeichen lang sein." }, 400);
    }
    const now = new Date();
    const update = await db.collection<any>("plannings").updateOne(
      { _id: planning._id, signatureToken: token, signatureStatus: { $in: ["sent", "viewed"] } },
      {
        $set: {
          signatureStatus: "declined",
          signatureDeclinedAt: now,
          signatureDeclinedReason: reason,
          signatureToken: null,
          signatureTokenHash: null,
          updatedAt: now,
        },
        $push: {
          signatureAudit: buildSignatureAuditEntry({
            event: "declined",
            req,
            at: now,
            meta: { reason },
          }) as never,
        },
      },
    );
    if (update.matchedCount === 0) return response(origin, { ok: false, message: "Der Auftrag wurde bereits bearbeitet." }, 409);
    await notifySignatureParticipants({ db, planning, type: "signature_declined", reason }).catch((error) =>
      console.error("SIGNATURE DECLINE NOTIFICATION ERROR:", error),
    );
    return response(origin, { ok: true, orderId: safeString(planning?.orderId), status: "declined" }, 200);
  } catch (error) {
    console.error("DECLINE PUBLIC SIGNATURE ERROR:", error);
    return response(origin, { ok: false, message: "Ablehnung konnte nicht gespeichert werden." }, 500);
  }
}
