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

async function loadInvoicePdfContext(args: {
  req: Request;
  invoiceId: string;
}) {
  const origin = args.req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    return {
      ok: false as const,
      response: jsonResponse(origin, { ok: false, message: "SESSION_SECRET fehlt." }, 500),
    };
  }

  const session = readSession(args.req, secret);
  if (!session?.activeCompanyId) {
    return {
      ok: false as const,
      response: jsonResponse(origin, { ok: false, message: "Nicht eingeloggt." }, 401),
    };
  }

  if (!canWriteInvoices(session)) {
    return {
      ok: false as const,
      response: jsonResponse(origin, { ok: false, message: "Keine Berechtigung." }, 403),
    };
  }

  const db = await getDb();
  const subscriptionError = await enforceActiveSubscription(db, origin, session);
  if (subscriptionError) {
    return {
      ok: false as const,
      response: subscriptionError,
    };
  }

  await ensureInvoiceIndexes(db);
  const context = await getInvoiceContextById({
    db,
    companyId: String(session.activeCompanyId),
    invoiceId: args.invoiceId,
  });

  if (!context) {
    return {
      ok: false as const,
      response: jsonResponse(origin, { ok: false, message: "Rechnung nicht gefunden." }, 404),
    };
  }

  return {
    ok: true as const,
    origin,
    session,
    db,
    context,
  };
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  const { invoiceId } = await params;
  const url = new URL(req.url);

  if (safeString(url.searchParams.get("preview")) !== "1") {
    return jsonResponse(req.headers.get("origin"), { ok: false, message: "Nicht gefunden." }, 404);
  }

  try {
    const loaded = await loadInvoicePdfContext({ req, invoiceId });
    if (!loaded.ok) {
      return loaded.response;
    }

    const { pdfBytes, fileName } = await buildInvoicePdf({
      invoice: loaded.context.invoice,
      planning: loaded.context.planning,
      company: loaded.context.company,
    });

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename=\"${fileName}\"`,
        "Cache-Control": "private, max-age=30",
        ...getCorsHeaders(loaded.origin),
      },
    });
  } catch (error: any) {
    console.error("GET INVOICE PDF PREVIEW ERROR:", error);
    return jsonResponse(req.headers.get("origin"), { ok: false, message: "PDF konnte nicht erstellt werden." }, 500);
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  const { invoiceId } = await params;

  try {
    const loaded = await loadInvoicePdfContext({ req, invoiceId });
    if (!loaded.ok) {
      return loaded.response;
    }

    const { pdfBytes, fileName } = await buildInvoicePdf({
      invoice: loaded.context.invoice,
      planning: loaded.context.planning,
      company: loaded.context.company,
    });

    const storedFile = await persistInvoicePdfFile({
      db: loaded.db,
      companyId: String(loaded.session.activeCompanyId),
      invoiceId,
      planningId: String(loaded.context.invoice.planningId),
      customerId: safeString(loaded.context.planning?.customerId) || null,
      invoice: loaded.context.invoice,
      buffer: pdfBytes,
      session: loaded.session,
    });

    await getInvoicesCollection(loaded.db).updateOne(
      { _id: loaded.context.invoice._id },
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
        ...getCorsHeaders(loaded.origin),
      },
    });
  } catch (error: any) {
    console.error("POST INVOICE PDF ERROR:", error);
    return jsonResponse(req.headers.get("origin"), { ok: false, message: "PDF konnte nicht erstellt werden." }, 500);
  }
}
