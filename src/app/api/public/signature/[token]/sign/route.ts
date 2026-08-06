import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { safeString } from "@/lib/api-session";
import { computePlanningCommercialSummary } from "@/lib/planningDocuments";
import {
  advanceSignedOrderPipeline,
  buildSignatureAuditEntry,
  createSignedOrderPdf,
  enforcePublicSignatureIpRateLimit,
  enforceSignatureRateLimit,
  ensureOrderSignatureIndexes,
  expireSignatureIfNeeded,
  extractRequestIp,
  findPlanningByPublicSignatureToken,
  getPublicApiBaseUrl,
  getSignatureSourcePdf,
  loadPlanningCustomer,
  notifySignatureParticipants,
  resolveCustomerName,
  sha256,
  storeGeneratedSignatureFile,
  validateSignatureImage,
} from "@/lib/orderSignatures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function response(origin: string | null, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...getCorsHeaders(origin) },
  });
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
    if (!(await enforceSignatureRateLimit({ db, scope: "sign-token", subject: token, limit: 10, windowMs: 3_600_000 }))) {
      return response(origin, { ok: false, message: "Zu viele Signaturversuche. Bitte später erneut versuchen." }, 429);
    }
    let planning: any = await findPlanningByPublicSignatureToken(db, safeString(token));
    if (!planning) return response(origin, { ok: false, message: "Link ungültig." }, 404);
    planning = await expireSignatureIfNeeded(db, planning, token);
    if (!planning) return response(origin, { ok: false, message: "Link ungültig." }, 404);
    if (!["sent", "viewed"].includes(safeString(planning?.signatureStatus)) || safeString(planning?.signatureToken) !== token) {
      return response(origin, { ok: false, message: "Der Auftrag kann mit diesem Link nicht unterschrieben werden." }, 409);
    }
    const body = await req.json().catch(() => ({}));
    if (body?.acceptedTerms !== true) {
      return response(origin, { ok: false, message: "Die Bedingungen müssen akzeptiert werden." }, 400);
    }
    const signerName = safeString(body?.signerName).slice(0, 200);
    const signerEmail = safeString(body?.signerEmail).toLowerCase().slice(0, 320);
    const place = safeString(body?.place).slice(0, 200);
    if (!signerName) return response(origin, { ok: false, message: "Name ist erforderlich." }, 400);
    if (!EMAIL_PATTERN.test(signerEmail)) return response(origin, { ok: false, message: "Ungültige E-Mail-Adresse." }, 400);
    const signaturePng = validateSignatureImage(body?.signatureImage);
    const source = await getSignatureSourcePdf(db, planning);
    const storedSourceHash = safeString(planning?.sourcePdfSha256);
    if (storedSourceHash && storedSourceHash !== source.hash) {
      return response(origin, { ok: false, message: "Das Auftrags-PDF wurde seit der Anfrage geändert." }, 409);
    }
    const [customer, commercial] = await Promise.all([
      loadPlanningCustomer(db, planning),
      computePlanningCommercialSummary(db, planning),
    ]);
    const signedAt = new Date();
    const signerIp = extractRequestIp(req);
    const signerUserAgent = safeString(req.headers.get("user-agent")).slice(0, 1000);
    const signedPdf = await createSignedOrderPdf({
      sourcePdf: source.buffer,
      signaturePng,
      orderId: safeString(planning?.orderId),
      customerName: resolveCustomerName(planning, customer),
      projectTitle: safeString(planning?.title) || safeString(planning?.planningNumber),
      totalInklMwst: Number(commercial?.grossPriceChf ?? 0),
      signerName,
      signerEmail,
      place,
      signedAt,
      signerIp,
      signerUserAgent,
      sourcePdfSha256: source.hash,
    });
    const orderId = safeString(planning?.orderId);
    const [signatureFile, signedPdfFile] = await Promise.all([
      storeGeneratedSignatureFile({
        db,
        planning,
        category: "signature",
        title: `Unterschrift ${signerName}`,
        fileName: `unterschrift-${orderId}.png`,
        mimeType: "image/png",
        buffer: signaturePng,
        actorName: signerName,
      }),
      storeGeneratedSignatureFile({
        db,
        planning,
        category: "auftrag_signiert",
        title: `${safeString(planning?.title) || "Auftrag"} — ${orderId} (unterschrieben)`,
        fileName: `auftrag-${orderId}-unterschrieben.pdf`,
        mimeType: "application/pdf",
        buffer: signedPdf,
        actorName: signerName,
      }),
    ]);
    const update = await db.collection<any>("plannings").updateOne(
      {
        _id: planning._id,
        signatureToken: token,
        signatureStatus: { $in: ["sent", "viewed"] },
        signatureTokenExpiresAt: { $gt: signedAt },
      },
      {
        $set: {
          signatureStatus: "signed",
          signedAt,
          signerName,
          signerEmail,
          signerIp,
          signerUserAgent,
          signatureImageFileId: signatureFile._id,
          signedPdfFileId: signedPdfFile._id,
          signedPdfSha256: sha256(signedPdf),
          sourcePdfSha256: source.hash,
          signatureToken: null,
          signatureTokenHash: sha256(token),
          updatedAt: signedAt,
        },
        $push: {
          signatureAudit: buildSignatureAuditEntry({
            event: "signed",
            req,
            at: signedAt,
            meta: { signerName, signerEmail, place: place || null, signedPdfSha256: sha256(signedPdf) },
          }) as never,
        },
      },
    );
    if (update.matchedCount === 0) {
      return response(origin, { ok: false, message: "Der Auftrag wurde bereits bearbeitet oder der Link ist abgelaufen." }, 409);
    }
    const signedPlanning = { ...planning, signatureRequestedByUserId: planning.signatureRequestedByUserId };
    await Promise.all([
      advanceSignedOrderPipeline(db, planning, signerName).catch((error) =>
        console.error("SIGNATURE PIPELINE ADVANCE ERROR:", error),
      ),
      notifySignatureParticipants({ db, planning: signedPlanning, type: "signature_signed", signerName }).catch((error) =>
        console.error("SIGNATURE NOTIFICATION ERROR:", error),
      ),
    ]);
    return response(
      origin,
      {
        ok: true,
        orderId,
        signedPdfUrl: `${getPublicApiBaseUrl(req)}/api/public/signature/${encodeURIComponent(token)}/pdf`,
      },
      200,
    );
  } catch (error: any) {
    const message = safeString(error?.message) || "Auftrag konnte nicht unterschrieben werden.";
    const status =
      message.includes("PNG") || message.includes("2 MB") || message.includes("Unterschrift")
        ? 400
        : message.includes("PDF")
          ? 409
          : 500;
    if (status === 500) console.error("PUBLIC SIGNATURE ERROR:", error);
    return response(origin, { ok: false, message }, status);
  }
}
