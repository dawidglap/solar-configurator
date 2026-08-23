import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import {
  mongoIdToString,
  readSession,
  safeString,
  toObjectIdOrNull,
} from "@/lib/api-session";
import { enforceActiveSubscription } from "@/lib/subscription";
import { canManageOrderSignatures } from "@/lib/orderSignatures";
import {
  buildManualVollmachtLink,
  decryptVollmachtRequestToken,
  encryptVollmachtRequestToken,
  ensureOfferSignatureIndexes,
  newOfferSignatureToken,
  parseVollmachtRequest,
  resolveVollmachtTokenContext,
} from "@/lib/offerSignatures";
import { getSessionUserMeta } from "@/lib/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = { params: Promise<{ planningId: string }> };

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

export async function OPTIONS(req: Request) {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(req.headers.get("origin")),
  });
}

export async function POST(req: Request, { params }: Params) {
  const origin = req.headers.get("origin");
  const secret = safeString(process.env.SESSION_SECRET);
  if (!secret) return response(origin, { ok: false, message: "SESSION_SECRET fehlt." }, 500);

  const session = readSession(req, secret);
  if (!session?.activeCompanyId || !session?.userId) {
    return response(origin, { ok: false, message: "Nicht eingeloggt." }, 401);
  }
  if (!canManageOrderSignatures(session)) {
    return response(origin, { ok: false, message: "Keine Berechtigung." }, 403);
  }

  const planningId = safeString((await params).planningId);
  const planningObjectId = toObjectIdOrNull(planningId);
  if (!planningObjectId) {
    return response(origin, { ok: false, message: "Ungültige Planning-ID." }, 400);
  }

  let input: ReturnType<typeof parseVollmachtRequest>;
  try {
    input = parseVollmachtRequest(await req.json());
  } catch (error) {
    return response(
      origin,
      {
        ok: false,
        message: safeString((error as Error)?.message) || "Ungültige Eingabe.",
      },
      400,
    );
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;
    await ensureOfferSignatureIndexes(db);

    const planning = await db.collection("plannings").findOne({ _id: planningObjectId });
    if (!planning) {
      return response(origin, { ok: false, message: "Planung nicht gefunden." }, 404);
    }

    const activeCompanyId = safeString(session.activeCompanyId);
    const planningCompanyId = mongoIdToString(planning.companyId) || safeString(planning.companyId);
    if (!planningCompanyId || planningCompanyId !== activeCompanyId) {
      return response(origin, { ok: false, message: "Kein Zugriff auf diesen Mandanten." }, 403);
    }

    const companyObjectId = toObjectIdOrNull(activeCompanyId);
    const company = companyObjectId
      ? await db.collection("companies").findOne({ _id: companyObjectId })
      : null;
    if (!company) {
      return response(origin, { ok: false, message: "Firma nicht gefunden." }, 404);
    }

    const now = new Date();
    const reusableToken = decryptVollmachtRequestToken(
      planning.vollmachtRequestTokenCiphertext,
      secret,
    );
    const reusableContext = reusableToken
      ? resolveVollmachtTokenContext(planning, reusableToken, now)
      : null;

    if (reusableToken && reusableContext?.kind === "manual") {
      if (planning.vollmachtSignatureRequired !== input.signatureRequired) {
        await db.collection("plannings").updateOne(
          {
            _id: planningObjectId,
            companyId: planning.companyId,
            vollmachtRequestTokenHash: reusableContext.tokenHash,
          },
          {
            $set: {
              vollmachtSignatureRequired: input.signatureRequired,
              updatedAt: now,
            },
          },
        );
      }
      return response(origin, {
        token: reusableToken,
        vollmachtLink: buildManualVollmachtLink(reusableToken),
        expiresAt: reusableContext.expiresAt.toISOString(),
      });
    }

    const { token, hash } = newOfferSignatureToken();
    const expiresAt = new Date(now.getTime() + input.expiresInDays * 86_400_000);
    const requester = getSessionUserMeta(session);
    const encryptedToken = encryptVollmachtRequestToken(token, secret);
    const update = await db.collection("plannings").updateOne(
      { _id: planningObjectId, companyId: planning.companyId },
      {
        $set: {
          vollmachtRequestTokenHash: hash,
          vollmachtRequestTokenExpiresAt: expiresAt,
          vollmachtRequestTokenCiphertext: encryptedToken,
          vollmachtManuallyActivated: true,
          vollmachtSignatureRequired: input.signatureRequired,
          vollmachtRequestedAt: now,
          vollmachtRequestedByUserId: toObjectIdOrNull(requester.id) || requester.id || null,
          vollmachtRequestedByName: requester.name || "Unbekannt",
          updatedAt: now,
        },
        $push: {
          vollmachtRequestAudit: {
            at: now,
            event: "requested",
            tokenId: hash,
            expiresAt,
            signatureRequired: input.signatureRequired,
            requestedByUserId: requester.id || null,
            requestedByName: requester.name || "Unbekannt",
          } as never,
        },
      },
    );
    if (!update.matchedCount) {
      return response(origin, { ok: false, message: "Kein Zugriff auf diesen Mandanten." }, 403);
    }

    return response(origin, {
      token,
      vollmachtLink: buildManualVollmachtLink(token),
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    console.error("CREATE VOLLMACHT REQUEST ERROR:", error);
    return response(
      origin,
      { ok: false, message: "Vollmachtsanfrage konnte nicht erstellt werden." },
      500,
    );
  }
}
