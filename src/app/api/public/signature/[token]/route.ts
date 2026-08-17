import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { safeString } from "@/lib/api-session";
import {
  buildPublicSignatureOrder,
  buildSignatureAuditEntry,
  enforcePublicSignatureIpRateLimit,
  ensureOrderSignatureIndexes,
  expireSignatureIfNeeded,
  findPlanningByPublicSignatureToken,
} from "@/lib/orderSignatures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function response(origin: string | null, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...getCorsHeaders(origin) },
  });
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: getCorsHeaders(req.headers.get("origin")) });
}

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
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
    if (safeString(planning?.signatureStatus) === "sent") {
      const now = new Date();
      const viewed = await db.collection<any>("plannings").findOneAndUpdate(
        { _id: planning._id, signatureToken: token, signatureStatus: "sent" },
        {
          $set: { signatureStatus: "viewed", signatureViewedAt: now, updatedAt: now },
          $push: {
            signatureAudit: buildSignatureAuditEntry({ event: "viewed", req, at: now }) as never,
          },
        },
        { returnDocument: "after", includeResultMetadata: false },
      );
      planning = viewed ?? (await findPlanningByPublicSignatureToken(db, token));
      if (!planning) return response(origin, { ok: false, message: "Link ungültig." }, 404);
    }
    const order = await buildPublicSignatureOrder({ db, planning, token, req });
    return response(origin, { ok: true, order, ...order }, 200);
  } catch (error) {
    console.error("GET PUBLIC SIGNATURE ERROR:", error);
    return response(origin, { ok: false, message: "Signaturansicht konnte nicht geladen werden." }, 500);
  }
}
