import { getDb } from "@/lib/db";
import { getCorsHeaders } from "@/lib/cors";
import { readSession, safeString } from "@/lib/api-session";
import { enforceActiveSubscription } from "@/lib/subscription";
import {
  canWriteInvoices,
  ensureInvoiceIndexes,
  getInvoiceByIdForCompany,
  getInvoicesCollection,
  INVOICE_PAYMENT_STATUSES,
  normalizeEditableInvoiceDunningLevel,
  normalizeEditableInvoiceStatus,
  normalizeInvoice,
  resolveInvoicePaymentAndDunningState,
} from "@/lib/invoices";
import { safeNumber } from "@/lib/tasks";

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

function parseDate(value: unknown) {
  const normalized = safeString(value);
  if (!normalized) return null;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseOptionalDate(value: unknown) {
  if (value == null || safeString(value) === "") return null;
  return parseDate(value);
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
    const invoice = await getInvoiceByIdForCompany(db, invoiceId, String(session.activeCompanyId));
    if (!invoice) {
      return jsonResponse(origin, { ok: false, message: "Rechnung nicht gefunden." }, 404);
    }

    return jsonResponse(origin, { ok: true, invoice: normalizeInvoice(invoice) }, 200);
  } catch (error: any) {
    console.error("GET INVOICE ERROR:", error);
    return jsonResponse(origin, { ok: false, message: "Rechnung konnte nicht geladen werden." }, 500);
  }
}

export async function PATCH(
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
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return jsonResponse(origin, { ok: false, message: "Ungültiger JSON-Body." }, 400);
  }

  try {
    const db = await getDb();
    const subscriptionError = await enforceActiveSubscription(db, origin, session);
    if (subscriptionError) return subscriptionError;

    await ensureInvoiceIndexes(db);
    const invoices = getInvoicesCollection(db);
    const existing = await getInvoiceByIdForCompany(db, invoiceId, String(session.activeCompanyId));
    if (!existing) {
      return jsonResponse(origin, { ok: false, message: "Rechnung nicht gefunden." }, 404);
    }

    const invoiceStatus = safeString(existing?.status).toLowerCase();
    const incomingKeys = Object.keys(body as Record<string, unknown>);
    const draftEditableFields = new Set([
      "anrede",
      "bodyText",
      "internalNote",
      "rateLabel",
      "pct",
      "amount",
      "issueDate",
      "dueDate",
      "discountPct",
      "discountChf",
      "skontoPct",
      "skontoChf",
      "skontoDays",
      "mwstIncluded",
      "positionMenge",
      "positionEinheit",
      "positionPreis",
      "status",
      "paymentStatus",
      "paidAmount",
      "paidAt",
      "dunningLevel",
    ]);
    const lockedEditableFields = new Set([
      "internalNote",
      "dueDate",
      "status",
      "paymentStatus",
      "paidAmount",
      "paidAt",
      "dunningLevel",
    ]);

    const hasLockedFieldUpdate =
      invoiceStatus !== "entwurf" &&
      incomingKeys.some((key) => !lockedEditableFields.has(key));
    if (hasLockedFieldUpdate) {
      return jsonResponse(
        origin,
        {
          ok: false,
          code: "INVOICE_LOCKED",
          message: "La fattura è già stata inviata e non può più essere modificata.",
        },
        409,
      );
    }

    const invalidDraftField = incomingKeys.find((key) => !draftEditableFields.has(key));
    if (invalidDraftField) {
      return jsonResponse(origin, { ok: false, message: `Feld ${invalidDraftField} ist ungültig.` }, 400);
    }

    const nextStatus =
      "status" in body
        ? normalizeEditableInvoiceStatus((body as any)?.status)
        : normalizeEditableInvoiceStatus(existing?.status) ?? "entwurf";
    if ("status" in body && !nextStatus) {
      return jsonResponse(origin, { ok: false, message: "Status ist ungültig." }, 400);
    }

    const updateDoc: Record<string, any> = {
      updatedAt: new Date(),
    };
    if ("anrede" in body) updateDoc.anrede = safeString((body as any)?.anrede);
    if ("bodyText" in body) updateDoc.bodyText = safeString((body as any)?.bodyText);
    if ("internalNote" in body) updateDoc.internalNote = safeString((body as any)?.internalNote);
    if ("rateLabel" in body) {
      const rateLabel = safeString((body as any)?.rateLabel);
      updateDoc.rateLabel = rateLabel;
      updateDoc.label = rateLabel;
    }
    if ("pct" in body) {
      const pct = safeNumber((body as any)?.pct, Number.NaN);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        return jsonResponse(origin, { ok: false, message: "Prozentsatz ist ungültig." }, 400);
      }
      updateDoc.pct = pct;
      updateDoc.percentage = pct;
    }
    if ("amount" in body) {
      const amount = safeNumber((body as any)?.amount, Number.NaN);
      if (!Number.isFinite(amount) || amount <= 0) {
        return jsonResponse(origin, { ok: false, message: "Betrag muss grösser als 0 sein." }, 400);
      }
      const normalizedAmount = safeString(existing?.invoiceType) === "gutschrift" ? -Math.abs(amount) : Math.abs(amount);
      updateDoc.amount = normalizedAmount;
      updateDoc.amountChf = normalizedAmount;
      if (!("positionPreis" in body)) {
        updateDoc.positionPreis = normalizedAmount;
      }
    }
    if ("issueDate" in body) {
      const issueDate = parseOptionalDate((body as any)?.issueDate);
      if ((body as any)?.issueDate != null && safeString((body as any)?.issueDate) !== "" && !issueDate) {
        return jsonResponse(origin, { ok: false, message: "Rechnungsdatum ist ungültig." }, 400);
      }
      updateDoc.issueDate = issueDate;
    }
    if ("dueDate" in body) {
      const dueDate = parseOptionalDate((body as any)?.dueDate);
      if ((body as any)?.dueDate != null && safeString((body as any)?.dueDate) !== "" && !dueDate) {
        return jsonResponse(origin, { ok: false, message: "Fälligkeitsdatum ist ungültig." }, 400);
      }
      updateDoc.dueDate = dueDate;
    }

    const numericFields = [
      ["discountPct", "Rabatt-Prozentsatz"],
      ["discountChf", "Rabattbetrag"],
      ["skontoPct", "Skonto-Prozentsatz"],
      ["skontoChf", "Skontobetrag"],
      ["positionMenge", "Positionsmenge"],
      ["positionPreis", "Positionspreis"],
      ["paidAmount", "Bezahlter Betrag"],
    ] as const;
    for (const [field, label] of numericFields) {
      if (!(field in body)) continue;
      const value = safeNumber((body as any)?.[field], Number.NaN);
      if (!Number.isFinite(value) || value < 0) {
        return jsonResponse(origin, { ok: false, message: `${label} ist ungültig.` }, 400);
      }
      updateDoc[field] = value;
    }

    if ("skontoDays" in body) {
      const value = Math.trunc(safeNumber((body as any)?.skontoDays, Number.NaN));
      if (!Number.isFinite(value) || value < 0) {
        return jsonResponse(origin, { ok: false, message: "Skonto-Tage sind ungültig." }, 400);
      }
      updateDoc.skontoDays = value;
    }
    if ("mwstIncluded" in body) {
      if (typeof (body as any)?.mwstIncluded !== "boolean") {
        return jsonResponse(origin, { ok: false, message: "mwstIncluded ist ungültig." }, 400);
      }
      updateDoc.mwstIncluded = !!(body as any)?.mwstIncluded;
    }
    if ("positionEinheit" in body) {
      updateDoc.positionEinheit = safeString((body as any)?.positionEinheit);
    }
    if ("status" in body) {
      updateDoc.status = nextStatus;
    }
    if ("paidAt" in body) {
      const paidAt = parseOptionalDate((body as any)?.paidAt);
      if ((body as any)?.paidAt != null && safeString((body as any)?.paidAt) !== "" && !paidAt) {
        return jsonResponse(origin, { ok: false, message: "Zahlungsdatum ist ungültig." }, 400);
      }
      updateDoc.paidAt = paidAt;
    }
    if ("dunningLevel" in body) {
      const dunningLevel = normalizeEditableInvoiceDunningLevel((body as any)?.dunningLevel);
      if (dunningLevel == null) {
        return jsonResponse(origin, { ok: false, message: "Mahnstufe ist ungültig." }, 400);
      }
      updateDoc.dunningLevel = dunningLevel;
    }
    if ("paymentStatus" in body) {
      const paymentStatus = safeString((body as any)?.paymentStatus).toLowerCase();
      if (!INVOICE_PAYMENT_STATUSES.includes(paymentStatus as any)) {
        return jsonResponse(origin, { ok: false, message: "Zahlungsstatus ist ungültig." }, 400);
      }
      updateDoc.paymentStatus = paymentStatus;
      if (!("paidAmount" in body) && paymentStatus === "offen") {
        updateDoc.paidAmount = 0;
      }
      if (!("paidAmount" in body) && paymentStatus === "bezahlt") {
        updateDoc.paidAmount = Math.abs(safeNumber("amount" in updateDoc ? updateDoc.amount : existing?.amount, 0));
      }
    }

    const resolvedState = resolveInvoicePaymentAndDunningState({
      amount: "amount" in updateDoc ? updateDoc.amount : safeNumber(existing?.amount, 0),
      status: "status" in updateDoc ? updateDoc.status : existing?.status,
      paidAmount: "paidAmount" in updateDoc ? updateDoc.paidAmount : existing?.paidAmount,
      paymentStatus: "paymentStatus" in updateDoc ? updateDoc.paymentStatus : existing?.paymentStatus,
      paidAt: "paidAt" in updateDoc ? updateDoc.paidAt : existing?.paidAt,
      dunningLevel: "dunningLevel" in updateDoc ? updateDoc.dunningLevel : existing?.dunningLevel,
    });
    updateDoc.status = resolvedState.status;
    updateDoc.paymentStatus = resolvedState.paymentStatus;
    updateDoc.paidAmount = resolvedState.paidAmount;
    updateDoc.paidAt = resolvedState.paidAt;
    updateDoc.dunningLevel = resolvedState.dunningLevel;
    updateDoc.dunningEligible = resolvedState.paymentStatus !== "bezahlt";

    await invoices.updateOne(
      { _id: existing._id },
      {
        $set: updateDoc,
      },
    );

    const invoice = await invoices.findOne({ _id: existing._id });
    return jsonResponse(origin, { ok: true, invoice: normalizeInvoice(invoice) }, 200);
  } catch (error: any) {
    console.error("PATCH INVOICE ERROR:", error);
    return jsonResponse(origin, { ok: false, message: "Rechnung konnte nicht gespeichert werden." }, 500);
  }
}
