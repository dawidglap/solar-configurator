import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { readSession, safeString } from "@/lib/api-session";
import { enforceActiveSubscription } from "@/lib/subscription";
import { canWriteInvoices, ensureInvoiceIndexes, getInvoicesCollection } from "@/lib/invoices";
import { buildInvoicePdf, getInvoiceContextById, persistInvoicePdfFile } from "@/lib/invoicePdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonResponse(origin: string | null, body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...getCorsHeaders(origin),
    },
  });
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    return jsonResponse(origin, { ok: false, message: "SESSION_SECRET fehlt." }, 500);
  }

  const session = readSession(req, secret);
  if (!session?.activeCompanyId) {
    return jsonResponse(origin, { ok: false, message: "Nicht eingeloggt." }, 401);
  }

  if (!canWriteInvoices(session)) {
    return jsonResponse(origin, { ok: false, message: "Keine Berechtigung." }, 403);
  }

  const { invoiceId } = await params;

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;

    await ensureInvoiceIndexes(db);
    const context = await getInvoiceContextById({
      db,
      companyId: String(session.activeCompanyId),
      invoiceId,
    });

    if (!context) {
      return jsonResponse(origin, { ok: false, message: "Rechnung nicht gefunden." }, 404);
    }

    const { pdfBytes, fileName } = await buildInvoicePdf({
      invoice: context.invoice,
      planning: context.planning,
      company: context.company,
    });

    const storedFile = await persistInvoicePdfFile({
      db,
      companyId: String(session.activeCompanyId),
      invoiceId,
      planningId: String(context.invoice.planningId),
      customerId: safeString(context.planning?.customerId) || null,
      invoice: context.invoice,
      buffer: pdfBytes,
      session,
    });

    await getInvoicesCollection(db).updateOne(
      { _id: context.invoice._id },
      {
        $set: {
          pdfFileId: storedFile._id,
          status: "heruntergeladen",
          updatedAt: new Date(),
        },
      },
    );

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename=\"${fileName}\"`,
        "Cache-Control": "no-store",
        ...getCorsHeaders(origin),
      },
    });
  } catch (error: any) {
    console.error("POST INVOICE PDF ERROR:", error);
    return jsonResponse(origin, { ok: false, message: "PDF konnte nicht erstellt werden." }, 500);
  }
}
