import crypto from "node:crypto";
import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { readSession, safeString } from "@/lib/api-session";
import { enforceActiveSubscription } from "@/lib/subscription";
import {
  buildSignatureAuditEntry,
  buildSignatureLink,
  buildSignatureRequester,
  buildSignatureResponse,
  canManageOrderSignatures,
  ensureOrderSignatureIndexes,
  getSignatureSourcePdf,
  loadPlanningCustomer,
  normalizeSignatureFields,
  parseSignatureRequestInput,
  resolveCustomerEmail,
  sha256,
} from "@/lib/orderSignatures";

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

export async function POST(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) return response(origin, { ok: false, message: "SESSION_SECRET fehlt." }, 500);
  const session = readSession(req, secret);
  if (!session?.activeCompanyId) return response(origin, { ok: false, message: "Nicht eingeloggt." }, 401);
  if (!canManageOrderSignatures(session)) return response(origin, { ok: false, message: "Keine Berechtigung." }, 403);
  const { orderId } = await params;
  const normalizedOrderId = safeString(orderId);
  if (!normalizedOrderId) return response(origin, { ok: false, message: "Ungültige Auftragsnummer." }, 400);
  const body = await req.json().catch(() => ({}));

  try {
    const input = parseSignatureRequestInput(body);
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;
    await ensureOrderSignatureIndexes(db);
    const planning = await db.collection<any>("plannings").findOne({
      companyId: String(session.activeCompanyId),
      orderId: normalizedOrderId,
    });
    if (!planning) return response(origin, { ok: false, message: "Auftrag nicht gefunden." }, 404);
    if (safeString(planning?.orderStatus) !== "generated") {
      return response(origin, { ok: false, message: "Auftrag wurde noch nicht generiert." }, 400);
    }
    if (planning?.cancelledAt) {
      return response(origin, { ok: false, message: "Stornierte Aufträge können nicht unterschrieben werden." }, 409);
    }
    if (safeString(planning?.signatureStatus) === "signed") {
      return response(
        origin,
        { ok: false, message: "Auftrag wurde bereits unterschrieben.", signature: buildSignatureResponse(planning) },
        409,
      );
    }

    const customer = await loadPlanningCustomer(db, planning);
    const email = input.email || resolveCustomerEmail(planning, customer);
    if (input.sendEmail && !email) {
      return response(origin, { ok: false, message: "Keine Kunden-E-Mail-Adresse vorhanden." }, 400);
    }
    const source = await getSignatureSourcePdf(db, planning);
    const token = crypto.randomBytes(32).toString("base64url");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + input.expiresInDays * 86_400_000);
    const requester = buildSignatureRequester(session);
    const audit = buildSignatureAuditEntry({
      event: "requested",
      req,
      at: now,
      meta: {
        email: email || null,
        message: input.message || null,
        sendEmail: input.sendEmail,
        expiresInDays: input.expiresInDays,
      },
    });
    await db.collection<any>("plannings").updateOne(
      { _id: planning._id, companyId: String(session.activeCompanyId) },
      {
        $set: {
          signatureStatus: "sent",
          signatureToken: token,
          signatureTokenHash: sha256(token),
          signatureTokenExpiresAt: expiresAt,
          signatureRequestedAt: now,
          signatureRequestedByUserId: requester.id,
          signatureRequestedByName: requester.name,
          signatureSentToEmail: email || null,
          signatureViewedAt: null,
          signedAt: null,
          signerName: null,
          signerEmail: null,
          signerIp: null,
          signerUserAgent: null,
          signatureImageFileId: null,
          signedPdfFileId: null,
          signedPdfSha256: null,
          sourcePdfSha256: source.hash,
          signatureDeclinedAt: null,
          signatureDeclinedReason: null,
          updatedAt: now,
        },
        $push: { signatureAudit: audit as never },
      },
    );
    const updated = await db.collection<any>("plannings").findOne({ _id: planning._id });
    return response(
      origin,
      {
        ok: true,
        token,
        link: buildSignatureLink(token),
        order: {
          orderId: normalizedOrderId,
          planningId: planning._id.toString(),
          ...normalizeSignatureFields(updated),
        },
      },
      200,
    );
  } catch (error: any) {
    const message = safeString(error?.message) || "Signaturanfrage konnte nicht erstellt werden.";
    const status = message.includes("E-Mail") || message.includes("expiresInDays") ? 400 : message.includes("PDF") ? 409 : 500;
    if (status === 500) console.error("CREATE SIGNATURE REQUEST ERROR:", error);
    return response(origin, { ok: false, message }, status);
  }
}
