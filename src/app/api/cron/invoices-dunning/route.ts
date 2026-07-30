import { getCorsHeaders } from "@/lib/cors";
import { getDb } from "@/lib/db";
import {
  computeInvoiceDaysOverdue,
  ensureInvoiceIndexes,
  getInvoiceEventsCollection,
  getInvoicesCollection,
} from "@/lib/invoices";

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

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const cronSecret = process.env.CRON_SECRET;
  const provided =
    req.headers.get("x-cron-secret") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (!cronSecret) {
    return jsonResponse(origin, { ok: false, message: "Missing CRON_SECRET" }, 500);
  }
  if (!provided || provided !== cronSecret) {
    return jsonResponse(origin, { ok: false, message: "Forbidden" }, 403);
  }

  try {
    const db = await getDb();
    await ensureInvoiceIndexes(db);
    const invoices = getInvoicesCollection(db);
    const invoiceEvents = getInvoiceEventsCollection(db);

    const candidates = await invoices.find(
      {
        invoiceType: "rechnung",
        status: { $in: ["versendet", "mahnung"] },
        paymentStatus: { $ne: "bezahlt" },
        dueDate: { $ne: null },
      },
    ).toArray();

    let updated = 0;
    let events = 0;
    for (const invoice of candidates) {
      const daysOverdue = computeInvoiceDaysOverdue({
        dueDate: invoice?.dueDate,
        paymentStatus: invoice?.paymentStatus,
        status: invoice?.status,
      });
      const currentStatus = String(invoice?.status ?? "").toLowerCase();
      if (daysOverdue <= 0 || currentStatus === "mahnung") {
        continue;
      }

      const now = new Date();
      await invoices.updateOne(
        { _id: invoice._id },
        {
          $set: {
            status: "mahnung",
            dunningSentAt: now,
            dunningLevel: 1,
            updatedAt: now,
            dunningEligible: false,
          },
        },
      );
      await invoiceEvents.insertOne({
        companyId: invoice.companyId,
        invoiceId: invoice._id,
        type: "dunning_sent",
        at: now,
      });
      updated += 1;
      events += 1;
    }

    return jsonResponse(
      origin,
      {
        ok: true,
        updated,
        events,
      },
      200,
    );
  } catch (error: any) {
    console.error("CRON INVOICES DUNNING ERROR:", error);
    return jsonResponse(origin, { ok: false, message: error?.message || "Unknown error" }, 500);
  }
}
