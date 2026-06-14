import { getCorsHeaders } from "@/lib/cors";
import { getDb } from "@/lib/db";

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
    const invoices = db.collection("invoices");
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const overdue = await invoices.updateMany(
      {
        invoiceType: "rechnung",
        dueDate: { $lt: startOfToday },
        paymentStatus: "offen",
        status: { $ne: "storniert" },
      },
      {
        $set: {
          dunningEligible: true,
          updatedAt: new Date(),
        },
      },
    );

    const reset = await invoices.updateMany(
      {
        $or: [
          { paymentStatus: { $ne: "offen" } },
          { dueDate: { $gte: startOfToday } },
          { status: "storniert" },
          { invoiceType: { $ne: "rechnung" } },
        ],
      },
      {
        $set: {
          dunningEligible: false,
          updatedAt: new Date(),
        },
      },
    );

    return jsonResponse(
      origin,
      {
        ok: true,
        overdueUpdated: overdue.modifiedCount,
        resetUpdated: reset.modifiedCount,
      },
      200,
    );
  } catch (error: any) {
    console.error("CRON INVOICES DUNNING ERROR:", error);
    return jsonResponse(origin, { ok: false, message: error?.message || "Unknown error" }, 500);
  }
}

