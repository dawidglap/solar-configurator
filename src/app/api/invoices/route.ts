import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { mongoIdToString, readSession, safeString } from "@/lib/api-session";
import { enforceActiveSubscription } from "@/lib/subscription";
import { activeDocumentFilter } from "@/lib/trash";
import {
  canWriteInvoices,
  ensureInvoiceIndexes,
  INVOICE_TYPES,
  normalizeInvoice,
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

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseLimit(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 50;
  return Math.min(Math.trunc(parsed), 200);
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function parseCursor(value: string) {
  if (!value) return null;

  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const createdAt = new Date(String(decoded?.createdAt || ""));
    const id = new ObjectId(String(decoded?.id || ""));
    if (Number.isNaN(createdAt.getTime())) {
      return null;
    }
    return { createdAt, id };
  } catch {
    return null;
  }
}

function encodeCursor(doc: any) {
  const createdAt = doc?.createdAt instanceof Date ? doc.createdAt : new Date(doc?.createdAt);
  const id = mongoIdToString(doc?._id);
  if (!id || Number.isNaN(createdAt.getTime())) return null;

  return Buffer.from(
    JSON.stringify({
      createdAt: createdAt.toISOString(),
      id,
    }),
  ).toString("base64url");
}

function buildPlanningLookupStage() {
  return {
    $lookup: {
      from: "plannings",
      let: {
        invoiceOrderId: "$orderId",
        invoiceCompanyId: "$companyId",
      },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ["$orderId", "$$invoiceOrderId"] },
                { $eq: ["$companyId", "$$invoiceCompanyId"] },
              ],
            },
            ...activeDocumentFilter(),
          },
        },
        {
          $project: {
            orderId: 1,
            customerId: 1,
            title: 1,
            planningNumber: 1,
            cancelledAt: 1,
            summary: 1,
            data: 1,
          },
        },
      ],
      as: "planning",
    },
  };
}

function buildOrderEnrichmentStages() {
  return [
    {
      $addFields: {
        planning: {
          $arrayElemAt: ["$planning", 0],
        },
      },
    },
    {
      $addFields: {
        customerName: {
          $let: {
            vars: {
              profile: "$planning.data.profile",
              summaryName: "$planning.summary.customerName",
            },
            in: {
              $ifNull: [
                "$$summaryName",
                {
                  $ifNull: [
                    "$$profile.companyName",
                    {
                      $trim: {
                        input: {
                          $concat: [
                            { $ifNull: ["$$profile.firstName", "$$profile.contactFirstName"] },
                            " ",
                            { $ifNull: ["$$profile.lastName", "$$profile.contactLastName"] },
                          ],
                        },
                      },
                    },
                  ],
                },
              ],
            },
          },
        },
        projectTitle: {
          $ifNull: ["$planning.title", "$planning.planningNumber"],
        },
        cancelledAt: "$planning.cancelledAt",
        effectiveAmount: {
          $ifNull: ["$amountChf", "$amount"],
        },
      },
    },
  ];
}

function buildPaymentFilterMatch(paymentFilter: string, today: Date) {
  if (paymentFilter === "offen") {
    return {
      paymentStatus: "offen",
      $or: [{ dueDate: null }, { dueDate: { $gte: today } }],
    };
  }

  if (paymentFilter === "bezahlt") {
    return {
      paymentStatus: "bezahlt",
    };
  }

  if (paymentFilter === "ueberfaellig") {
    return {
      paymentStatus: { $ne: "bezahlt" },
      dueDate: { $ne: null, $lt: today },
    };
  }

  return null;
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

export async function GET(req: Request) {
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

  const url = new URL(req.url);
  const type = safeString(url.searchParams.get("type")).toLowerCase();
  const paymentFilter = safeString(url.searchParams.get("paymentFilter")).toLowerCase();
  const q = safeString(url.searchParams.get("q"));
  const includeCancelled = safeString(url.searchParams.get("includeCancelled")).toLowerCase() === "true";
  const limit = parseLimit(safeString(url.searchParams.get("limit")));
  const cursor = parseCursor(safeString(url.searchParams.get("cursor")));

  if (safeString(url.searchParams.get("cursor")) && !cursor) {
    return jsonResponse(origin, { ok: false, message: "Cursor ist ungültig." }, 400);
  }

  if (type && !INVOICE_TYPES.includes(type as (typeof INVOICE_TYPES)[number])) {
    return jsonResponse(origin, { ok: false, message: "Rechnungstyp ist ungültig." }, 400);
  }

  if (paymentFilter && !["offen", "bezahlt", "ueberfaellig"].includes(paymentFilter)) {
    return jsonResponse(origin, { ok: false, message: "Filter ist ungültig." }, 400);
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;

    await ensureInvoiceIndexes(db);

    const companyId = String(session.activeCompanyId);
    const today = startOfToday();
    const baseMatch: Record<string, any> = {
      companyId,
    };

    if (type) {
      baseMatch.invoiceType = type;
    }

    const cursorMatch =
      cursor
        ? {
            $or: [
              { createdAt: { $lt: cursor.createdAt } },
              {
                createdAt: cursor.createdAt,
                _id: { $lt: cursor.id },
              },
            ],
          }
        : null;

    const searchMatch = q
      ? {
          $or: [
            { invoiceNumber: { $regex: escapeRegex(q), $options: "i" } },
            { orderId: { $regex: escapeRegex(q), $options: "i" } },
            { customerName: { $regex: escapeRegex(q), $options: "i" } },
          ],
        }
      : null;

    const basePipeline: Record<string, any>[] = [
      { $match: baseMatch },
      buildPlanningLookupStage(),
      ...buildOrderEnrichmentStages(),
      ...(!includeCancelled ? [{ $match: { cancelledAt: null } }] : []),
      ...(searchMatch ? [{ $match: searchMatch }] : []),
    ];

    const itemsPipeline: Record<string, any>[] = [
      ...basePipeline,
      ...(cursorMatch ? [{ $match: cursorMatch }] : []),
    ];

    const paymentMatch = buildPaymentFilterMatch(paymentFilter, today);
    if (paymentMatch) {
      itemsPipeline.push({ $match: paymentMatch });
    }

    itemsPipeline.push({ $sort: { createdAt: -1, _id: -1 } });
    itemsPipeline.push({ $limit: limit + 1 });

    const summaryPipeline: Record<string, any>[] = [
      ...basePipeline,
      {
        $group: {
          _id: null,
          offenCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$paymentStatus", "offen"] },
                    {
                      $or: [
                        { $eq: ["$dueDate", null] },
                        { $gte: ["$dueDate", today] },
                      ],
                    },
                  ],
                },
                1,
                0,
              ],
            },
          },
          offenAmount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$paymentStatus", "offen"] },
                    {
                      $or: [
                        { $eq: ["$dueDate", null] },
                        { $gte: ["$dueDate", today] },
                      ],
                    },
                  ],
                },
                "$effectiveAmount",
                0,
              ],
            },
          },
          bezahltCount: {
            $sum: {
              $cond: [{ $eq: ["$paymentStatus", "bezahlt"] }, 1, 0],
            },
          },
          bezahltAmount: {
            $sum: {
              $cond: [{ $eq: ["$paymentStatus", "bezahlt"] }, "$effectiveAmount", 0],
            },
          },
          ueberfaelligCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$paymentStatus", "bezahlt"] },
                    { $ne: ["$dueDate", null] },
                    { $lt: ["$dueDate", today] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          ueberfaelligAmount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$paymentStatus", "bezahlt"] },
                    { $ne: ["$dueDate", null] },
                    { $lt: ["$dueDate", today] },
                  ],
                },
                "$effectiveAmount",
                0,
              ],
            },
          },
        },
      },
    ];

    const [docs, summaryDocs] = await Promise.all([
      db.collection("invoices").aggregate(itemsPipeline).toArray(),
      db.collection("invoices").aggregate(summaryPipeline).toArray(),
    ]);

    const hasMore = docs.length > limit;
    const pageDocs = hasMore ? docs.slice(0, limit) : docs;
    const nextCursor = hasMore ? encodeCursor(pageDocs[pageDocs.length - 1]) : null;

    const items = pageDocs.map((doc: any) => ({
      ...normalizeInvoice(doc),
      order: {
        orderId: safeString(doc?.orderId) || null,
        customerId: mongoIdToString(doc?.planning?.customerId) || safeString(doc?.planning?.customerId) || null,
        customerName: safeString(doc?.customerName) || null,
        projectTitle: safeString(doc?.projectTitle) || null,
        cancelledAt:
          doc?.cancelledAt instanceof Date
            ? doc.cancelledAt.toISOString()
            : safeString(doc?.cancelledAt) || null,
      },
    }));

    const summaryDoc = summaryDocs[0] ?? {};

    return jsonResponse(
      origin,
      {
        ok: true,
        items,
        summary: {
          offen: {
            count: Number(summaryDoc?.offenCount ?? 0),
            totalAmount: Number(summaryDoc?.offenAmount ?? 0),
          },
          bezahlt: {
            count: Number(summaryDoc?.bezahltCount ?? 0),
            totalAmount: Number(summaryDoc?.bezahltAmount ?? 0),
          },
          ueberfaellig: {
            count: Number(summaryDoc?.ueberfaelligCount ?? 0),
            totalAmount: Number(summaryDoc?.ueberfaelligAmount ?? 0),
          },
        },
        nextCursor,
      },
      200,
    );
  } catch (error: any) {
    console.error("GET INVOICES ERROR:", error);
    return jsonResponse(origin, { ok: false, message: "Rechnungen konnten nicht geladen werden." }, 500);
  }
}
