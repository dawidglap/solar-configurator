import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { readSession, safeString, toObjectIdOrNull } from "@/lib/api-session";
import { enforceActiveSubscription } from "@/lib/subscription";
import { canManageOrderSignatures, loadPlanningCustomer, resolveCustomerEmail } from "@/lib/orderSignatures";
import {
  buildAndStoreOfferSnapshot,
  buildOfferAuditEntry,
  buildOfferSignatureLink,
  ensureOfferSignatureIndexes,
  newOfferSignatureToken,
  parseOfferSignatureRequest,
} from "@/lib/offerSignatures";
import { getSessionUserMeta } from "@/lib/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
const response = (origin: string | null, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...getCorsHeaders(origin) } });
export async function OPTIONS(req: Request) { return new Response(null, { status: 204, headers: getCorsHeaders(req.headers.get("origin")) }); }

export async function POST(req: Request, { params }: { params: Promise<{ planningId: string }> }) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) return response(origin, { ok: false, message: "SESSION_SECRET fehlt." }, 500);
  const session = readSession(req, secret);
  if (!session?.activeCompanyId) return response(origin, { ok: false, message: "Nicht eingeloggt." }, 401);
  if (!canManageOrderSignatures(session)) return response(origin, { ok: false, message: "Keine Berechtigung." }, 403);
  const { planningId } = await params;
  const id = toObjectIdOrNull(planningId);
  if (!id) return response(origin, { ok: false, message: "Ungültige Planning-ID." }, 400);
  try {
    const input = parseOfferSignatureRequest(await req.json().catch(() => ({})));
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;
    await ensureOfferSignatureIndexes(db);
    const planning = await db.collection<any>("plannings").findOne({ _id: id, companyId: String(session.activeCompanyId) });
    if (!planning) return response(origin, { ok: false, message: "Planung nicht gefunden." }, 404);
    if (safeString(planning?.orderStatus) === "generated") {
      return response(origin, { ok: false, message: "Für diese Planung wurde bereits ein Auftrag generiert." }, 409);
    }
    if (safeString(planning?.offerSignatureStatus) === "signed") {
      return response(origin, { ok: false, message: "Die Offerte wurde bereits unterschrieben." }, 409);
    }
    const customer = await loadPlanningCustomer(db, planning);
    const email = input.email || resolveCustomerEmail(planning, customer);
    if (input.sendEmail && !email) return response(origin, { ok: false, message: "Keine Kunden-E-Mail-Adresse vorhanden." }, 400);
    const companyId = toObjectIdOrNull(session.activeCompanyId);
    const company = companyId
      ? await db.collection("companies").findOne({ _id: companyId })
      : null;
    if (!company) return response(origin, { ok: false, message: "Firma nicht gefunden." }, 404);
    const snapshot = await buildAndStoreOfferSnapshot({ db, planning, company, session });
    const { token, hash } = newOfferSignatureToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + input.expiresInDays * 86_400_000);
    const requester = getSessionUserMeta(session);
    await db.collection<any>("plannings").updateOne(
      { _id: id, companyId: String(session.activeCompanyId) },
      {
        $set: {
          offerSignatureStatus: "sent",
          offerSignatureTokenHash: hash,
          offerSignatureTokenExpiresAt: expiresAt,
          offerSignatureRequestedAt: now,
          offerSignatureRequestedByUserId: toObjectIdOrNull(requester.id) || requester.id || null,
          offerSignatureRequestedByName: requester.name || "Unbekannt",
          offerSignatureSentToEmail: email || null,
          offerSignatureViewedAt: null,
          offerSignedAt: null,
          offerSignerName: null,
          offerSignerEmail: null,
          offerSignerIp: null,
          offerSignerUserAgent: null,
          offerSignaturePlace: input.place,
          offerSignaturePlaceName: null,
          offerSignatureImage: null,
          offerSignatureDeclinedReason: null,
          offerSignedPdfFileId: null,
          offerSignedPdfSha256: null,
          offerConfirmationPdfFileId: null,
          withdrawalRightApplies: false,
          withdrawalUntil: null,
          offerSnapshotFileId: snapshot.file._id,
          offerSignatureProcessingId: null,
          offerSignatureProcessingAt: null,
          offerVollmachtTokenExpiresAt: null,
          offerVollmachtPdfFileId: null,
          vollmachtSubmittedAt: null,
          updatedAt: now,
        },
        $push: {
          offerSignatureAudit: buildOfferAuditEntry({
            event: "requested",
            req,
            tokenHash: hash,
            at: now,
            meta: { email: email || null, message: input.message || null, sendEmail: input.sendEmail, place: input.place, snapshotSha256: snapshot.hash },
          }) as never,
        },
      },
    );
    return response(origin, { ok: true, token, link: buildOfferSignatureLink(token), expiresAt: expiresAt.toISOString() });
  } catch (error: any) {
    const message = safeString(error?.message) || "Signaturanfrage konnte nicht erstellt werden.";
    const status = /E-Mail|expiresInDays|Abschlussort/.test(message) ? 400 : /PDF|Snapshot/.test(message) ? 409 : 500;
    if (status === 500) console.error("CREATE OFFER SIGNATURE REQUEST ERROR:", error);
    return response(origin, { ok: false, message }, status);
  }
}
