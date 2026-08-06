import { getCorsHeaders } from "@/lib/cors";
import { getDb } from "@/lib/db";
import { safeString } from "@/lib/api-session";
import {
  buildSignatureAuditEntry,
  ensureOrderSignatureIndexes,
  sha256,
} from "@/lib/orderSignatures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function response(origin: string | null, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...getCorsHeaders(origin),
    },
  });
}

async function run(req: Request) {
  const origin = req.headers.get("origin");
  const cronSecret = process.env.CRON_SECRET;
  const provided =
    req.headers.get("x-cron-secret") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (!cronSecret) {
    return response(origin, { ok: false, message: "CRON_SECRET fehlt." }, 500);
  }
  if (!provided || provided !== cronSecret) {
    return response(origin, { ok: false, message: "Nicht autorisiert." }, 403);
  }

  try {
    const db = await getDb();
    await ensureOrderSignatureIndexes(db);
    const now = new Date();
    const plannings = db.collection<any>("plannings");
    const expired = await plannings
      .find(
        {
          signatureStatus: { $in: ["sent", "viewed"] },
          signatureTokenExpiresAt: { $lt: now },
        },
        { projection: { _id: 1, signatureToken: 1, signatureTokenHash: 1 } },
      )
      .toArray();
    if (!expired.length) return response(origin, { ok: true, expired: 0 });

    const result = await plannings.bulkWrite(
      expired.map((planning) => ({
        updateOne: {
          filter: {
            _id: planning._id,
            signatureStatus: { $in: ["sent", "viewed"] },
            signatureTokenExpiresAt: { $lt: now },
          },
          update: {
            $set: {
              signatureStatus: "expired",
              signatureToken: null,
              signatureTokenHash:
                safeString(planning?.signatureTokenHash) ||
                (safeString(planning?.signatureToken)
                  ? sha256(safeString(planning.signatureToken))
                  : null),
              updatedAt: now,
            },
            $push: {
              signatureAudit: buildSignatureAuditEntry({ event: "expired", at: now }) as never,
            },
          },
        },
      })),
      { ordered: false },
    );
    return response(origin, { ok: true, expired: result.modifiedCount });
  } catch (error: any) {
    console.error("SIGNATURE EXPIRY CRON ERROR:", error);
    return response(
      origin,
      { ok: false, message: "Abgelaufene Signaturanfragen konnten nicht aktualisiert werden." },
      500,
    );
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
