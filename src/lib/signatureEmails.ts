import type { Db } from "mongodb";
import { mongoIdToString, safeString, toObjectIdOrNull } from "@/lib/api-session";
import { fetchPlanningFileBuffer, getPlanningFilesCollection } from "@/lib/planningFiles";

export type SignatureEmailKind = "offer_accepted" | "vollmacht_submitted";

type SignatureEmailAttachment = {
  fileId: unknown;
  fileName: string;
  mimeType: "application/pdf";
  buffer?: Buffer;
};

export type QueueSignatureEmailArgs = {
  db: Db;
  kind: SignatureEmailKind;
  companyId: string;
  planningId: string;
  orderId: string;
  offerNumber?: string;
  companyName: string;
  customerName: string;
  customerEmail: string;
  sellerName?: string | null;
  sellerEmail?: string | null;
  downloadUrl: string;
  attachment: SignatureEmailAttachment;
};

const COLLECTION_NAME = "signatureEmailDeliveries";
const LOCK_TIMEOUT_MS = 10 * 60_000;
const RETRY_DELAY_MS = 15 * 60_000;

export function buildSignatureEmailIdempotencyKey(args: {
  companyId: string;
  orderId: string;
  kind: SignatureEmailKind;
}) {
  return [safeString(args.companyId), safeString(args.orderId), args.kind].join(":");
}

export function resolveSignatureEmailFunctionConfig(
  env: Record<string, string | undefined> = process.env,
) {
  const explicitUrl = safeString(env.SIGNATURE_EMAIL_FUNCTION_URL);
  const supabaseUrl = safeString(env.SUPABASE_URL).replace(/\/+$/, "");
  const url = explicitUrl || (supabaseUrl ? `${supabaseUrl}/functions/v1/send-signature-email` : "");
  const token = safeString(
    env.SIGNATURE_EMAIL_FUNCTION_TOKEN ||
      env.SUPABASE_SERVICE_ROLE_KEY ||
      env.SUPABASE_ANON_KEY,
  );
  return url ? { url, token } : null;
}

function uniqueEmails(values: unknown[]) {
  return Array.from(
    new Set(values.map((value) => safeString(value).toLowerCase()).filter(Boolean)),
  );
}

export function buildSignatureEmailPayload(args: {
  delivery: any;
  attachmentBase64: string;
}) {
  const delivery = args.delivery;
  const customerEmail = safeString(delivery?.customerEmail).toLowerCase();
  const sellerEmail = safeString(delivery?.sellerEmail).toLowerCase();
  const recipients = uniqueEmails([customerEmail, sellerEmail]);
  const ccEmails = sellerEmail && sellerEmail !== customerEmail ? [sellerEmail] : [];
  const toEmails = customerEmail ? [customerEmail] : sellerEmail ? [sellerEmail] : [];
  return {
    kind: safeString(delivery?.kind),
    idempotencyKey: safeString(delivery?._id),
    orderId: safeString(delivery?.orderId),
    offerNumber: safeString(delivery?.offerNumber) || null,
    companyName: safeString(delivery?.companyName),
    customerName: safeString(delivery?.customerName),
    customerEmail: customerEmail || null,
    sellerName: safeString(delivery?.sellerName) || null,
    sellerEmail: sellerEmail || null,
    recipients,
    to: toEmails,
    toEmail: toEmails[0] || null,
    cc: ccEmails,
    ccEmails,
    ccEmail: ccEmails[0] || null,
    replyTo: sellerEmail || null,
    downloadUrl: safeString(delivery?.downloadUrl),
    pdfUrl: safeString(delivery?.downloadUrl),
    attachments: [
      {
        filename: safeString(delivery?.attachmentFileName) || "dokument.pdf",
        contentType: safeString(delivery?.attachmentMimeType) || "application/pdf",
        content: args.attachmentBase64,
      },
    ],
  };
}

async function markDeliveryFailure(db: Db, idempotencyKey: string, error: unknown) {
  const now = new Date();
  await db.collection<any>(COLLECTION_NAME).updateOne(
    { _id: idempotencyKey },
    {
      $set: {
        status: "failed",
        lastError: safeString((error as any)?.message) || String(error),
        nextAttemptAt: new Date(now.getTime() + RETRY_DELAY_MS),
        updatedAt: now,
      },
      $unset: { lockedAt: "" },
    },
  );
}

export async function deliverQueuedSignatureEmail(args: {
  db: Db;
  idempotencyKey: string;
  attachmentBuffer?: Buffer;
}) {
  const now = new Date();
  const collection = args.db.collection<any>(COLLECTION_NAME);
  const delivery = await collection.findOneAndUpdate(
    {
      _id: args.idempotencyKey,
      sentAt: null,
      $or: [
        { status: { $in: ["pending", "failed"] } },
        { status: "sending", lockedAt: { $lt: new Date(now.getTime() - LOCK_TIMEOUT_MS) } },
      ],
    },
    {
      $set: { status: "sending", lockedAt: now, updatedAt: now },
      $inc: { attempts: 1 },
    },
    { returnDocument: "after", includeResultMetadata: false },
  );
  if (!delivery) {
    const current = await collection.findOne({ _id: args.idempotencyKey });
    return { status: current?.sentAt ? "already_sent" : "in_progress" } as const;
  }

  try {
    const config = resolveSignatureEmailFunctionConfig();
    if (!config) throw new Error("SIGNATURE_EMAIL_FUNCTION_URL oder SUPABASE_URL fehlt.");
    let attachmentBuffer = args.attachmentBuffer;
    if (!attachmentBuffer) {
      const fileId = toObjectIdOrNull(delivery.attachmentFileId);
      if (!fileId) throw new Error("E-Mail-Anhang wurde nicht gefunden.");
      const file = await getPlanningFilesCollection(args.db).findOne({
        _id: fileId,
        companyId: safeString(delivery.companyId),
        planningId: safeString(delivery.planningId),
        isDeleted: { $ne: true },
      });
      if (!file) throw new Error("E-Mail-Anhang wurde nicht gefunden.");
      attachmentBuffer = await fetchPlanningFileBuffer(file);
    }
    if (attachmentBuffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new Error("E-Mail-Anhang ist kein gültiges PDF.");
    }
    const payload = buildSignatureEmailPayload({
      delivery,
      attachmentBase64: attachmentBuffer.toString("base64"),
    });
    if (!payload.to.length) throw new Error("Keine E-Mail-Empfänger vorhanden.");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Idempotency-Key": args.idempotencyKey,
    };
    if (config.token) {
      headers.Authorization = `Bearer ${config.token}`;
      headers.apikey = config.token;
    }
    const response = await fetch(config.url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) {
      const responseText = safeString(await response.text().catch(() => "")).slice(0, 1000);
      throw new Error(`Signatur-E-Mail fehlgeschlagen (${response.status})${responseText ? `: ${responseText}` : ""}`);
    }
    const sentAt = new Date();
    await collection.updateOne(
      { _id: args.idempotencyKey, sentAt: null },
      {
        $set: { status: "sent", sentAt, updatedAt: sentAt, lastError: null, nextAttemptAt: null },
        $unset: { lockedAt: "" },
      },
    );
    return { status: "sent", sentAt: sentAt.toISOString() } as const;
  } catch (error) {
    await markDeliveryFailure(args.db, args.idempotencyKey, error);
    console.error("SIGNATURE EMAIL DELIVERY ERROR:", error);
    return { status: "failed", error: safeString((error as any)?.message) || String(error) } as const;
  }
}

export async function queueSignatureDocumentEmail(args: QueueSignatureEmailArgs) {
  const idempotencyKey = buildSignatureEmailIdempotencyKey(args);
  const now = new Date();
  await args.db.collection<any>(COLLECTION_NAME).updateOne(
    { _id: idempotencyKey },
    {
      $set: {
        companyId: safeString(args.companyId),
        planningId: safeString(args.planningId),
        orderId: safeString(args.orderId),
        offerNumber: safeString(args.offerNumber) || null,
        kind: args.kind,
        companyName: safeString(args.companyName),
        customerName: safeString(args.customerName),
        customerEmail: safeString(args.customerEmail).toLowerCase() || null,
        sellerName: safeString(args.sellerName) || null,
        sellerEmail: safeString(args.sellerEmail).toLowerCase() || null,
        downloadUrl: safeString(args.downloadUrl),
        attachmentFileId: mongoIdToString(args.attachment.fileId) || safeString(args.attachment.fileId),
        attachmentFileName: safeString(args.attachment.fileName),
        attachmentMimeType: args.attachment.mimeType,
        updatedAt: now,
      },
      $setOnInsert: {
        status: "pending",
        sentAt: null,
        attempts: 0,
        nextAttemptAt: now,
        createdAt: now,
      },
    },
    { upsert: true },
  );
  return deliverQueuedSignatureEmail({
    db: args.db,
    idempotencyKey,
    attachmentBuffer: args.attachment.buffer,
  });
}

export async function processPendingSignatureEmails(db: Db, limit = 10) {
  const now = new Date();
  const pending = await db.collection<any>(COLLECTION_NAME)
    .find({
      sentAt: null,
      $or: [
        { status: "pending" },
        { status: "failed", nextAttemptAt: { $lte: now } },
        { status: "sending", lockedAt: { $lt: new Date(now.getTime() - LOCK_TIMEOUT_MS) } },
      ],
    })
    .sort({ createdAt: 1 })
    .limit(Math.max(1, Math.min(50, Math.trunc(limit))))
    .toArray();
  const results = [];
  for (const delivery of pending) {
    results.push(await deliverQueuedSignatureEmail({
      db,
      idempotencyKey: safeString(delivery._id),
    }));
  }
  return {
    processed: results.length,
    sent: results.filter((result) => result.status === "sent").length,
    failed: results.filter((result) => result.status === "failed").length,
  };
}
