import type { Db } from "mongodb";
import PDFKitDocument from "pdfkit";
import { SwissQRBill } from "swissqrbill/pdf";
import type { Data, Language } from "swissqrbill/types";
import { safeString } from "@/lib/api-session";
import { safeNumber } from "@/lib/tasks";

export const QR_REFERENCE_TYPES = ["QRR", "SCOR", "NON"] as const;
export type QrReferenceType = (typeof QR_REFERENCE_TYPES)[number];

const MODULO_10_TABLE = [0, 9, 4, 6, 8, 2, 7, 1, 3, 5] as const;
const MAX_QR_MESSAGE_LENGTH = 140;

function logQrBill(level: "info" | "warn" | "error", event: string, details: Record<string, unknown>) {
  const logger = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
  logger(`[QR-BILL] ${event}`, details);
}

function normalizeCompact(value: unknown) {
  return safeString(value).replace(/\s+/g, "").toUpperCase();
}

function mod97(value: string) {
  let remainder = 0;
  for (const character of value) {
    const numeric = /[0-9]/.test(character)
      ? character
      : String(character.charCodeAt(0) - 55);
    for (const digit of numeric) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder;
}

export function calculateQrReferenceCheckDigit(payload: string) {
  if (!/^\d+$/.test(payload)) {
    throw new Error("QR-Referenz-Nutzdaten müssen numerisch sein.");
  }

  let carry = 0;
  for (const character of payload) {
    carry = MODULO_10_TABLE[(carry + Number(character)) % 10];
  }
  return String((10 - carry) % 10);
}

export function generateQrReference(payload: string) {
  const digits = payload.replace(/\D/g, "");
  if (!digits) {
    throw new Error("QR-Referenz-Nutzdaten fehlen.");
  }
  const normalized = digits.slice(-26).padStart(26, "0");
  return `${normalized}${calculateQrReferenceCheckDigit(normalized)}`;
}

export function isValidQrReference(reference: unknown) {
  const normalized = normalizeCompact(reference);
  return (
    /^\d{27}$/.test(normalized) &&
    calculateQrReferenceCheckDigit(normalized.slice(0, 26)) === normalized.slice(-1)
  );
}

export function generateScorReference(referenceValue: string) {
  const payload = safeString(referenceValue)
    .replace(/[^0-9A-Za-z]/g, "")
    .toUpperCase()
    .slice(0, 21);
  if (!payload) {
    throw new Error("Rechnungsnummer für die Creditor Reference fehlt.");
  }

  const checkDigits = String(98 - mod97(`${payload}RF00`)).padStart(2, "0");
  return `RF${checkDigits}${payload}`;
}

export function isValidScorReference(reference: unknown) {
  const normalized = normalizeCompact(reference);
  if (!/^RF\d{2}[0-9A-Z]{1,21}$/.test(normalized)) return false;
  return mod97(`${normalized.slice(4)}${normalized.slice(0, 4)}`) === 1;
}

export function isValidIban(iban: unknown) {
  const normalized = normalizeCompact(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(normalized)) return false;
  return mod97(`${normalized.slice(4)}${normalized.slice(0, 4)}`) === 1;
}

export function isQrIban(iban: unknown) {
  const normalized = normalizeCompact(iban);
  if (!isValidIban(normalized) || !/^(CH|LI)[0-9A-Z]{19}$/.test(normalized)) {
    return false;
  }
  const iid = Number(normalized.slice(4, 9));
  return Number.isInteger(iid) && iid >= 30_000 && iid <= 31_999;
}

export function getQrEligibility(invoice: any, qrBill: any = {}) {
  const openAmount = round2(
    safeNumber(invoice?.amount, 0) - safeNumber(invoice?.paidAmount, 0),
  );
  const invoiceType = safeString(invoice?.invoiceType).toLowerCase();
  const status = safeString(invoice?.status).toLowerCase();
  const paymentStatus = safeString(invoice?.paymentStatus).toLowerCase();

  if (qrBill?.enabled === false) {
    return {
      eligible: false,
      openAmount,
      reason: "disabled" as const,
      warning: "Der QR-Zahlteil ist in den Firmeneinstellungen deaktiviert.",
    };
  }
  if (!["rechnung", "mahnung"].includes(invoiceType)) {
    return {
      eligible: false,
      openAmount,
      reason: "invoice_type" as const,
      warning: "Für diesen Dokumenttyp wird bewusst kein QR-Zahlteil gedruckt.",
    };
  }
  if (status === "storniert") {
    return {
      eligible: false,
      openAmount,
      reason: "cancelled" as const,
      warning: "Für eine stornierte Rechnung wird kein QR-Zahlteil gedruckt.",
    };
  }
  if (paymentStatus === "bezahlt") {
    return {
      eligible: false,
      openAmount,
      reason: "paid" as const,
      warning: "Für eine bezahlte Rechnung wird kein QR-Zahlteil gedruckt.",
    };
  }
  if (openAmount <= 0) {
    return {
      eligible: false,
      openAmount,
      reason: "no_open_amount" as const,
      warning: "Der offene Rechnungsbetrag ist nicht positiv; deshalb wird kein QR-Zahlteil gedruckt.",
    };
  }

  return { eligible: true, openAmount, reason: null, warning: null };
}

export function round2(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function resolveQrReferenceType(value: unknown): QrReferenceType {
  const normalized = safeString(value).toUpperCase() as QrReferenceType;
  return QR_REFERENCE_TYPES.includes(normalized) ? normalized : "NON";
}

function getInvoiceReferenceSeed(invoice: any) {
  const invoiceDigits = safeString(invoice?.invoiceNumber).replace(/\D/g, "");
  if (invoiceDigits) return invoiceDigits;

  const objectId = safeString(invoice?._id?.toString?.() ?? invoice?._id);
  if (/^[0-9a-f]{24}$/i.test(objectId)) {
    return BigInt(`0x${objectId.slice(-12)}`).toString(10);
  }
  return objectId.replace(/\D/g, "") || "0";
}

export async function ensureInvoiceQrReference(args: {
  db: Db;
  companyId: string;
  invoice: any;
  company: any;
}) {
  const eligibility = getQrEligibility(args.invoice, args.company?.qrBill);
  if (!eligibility.eligible) {
    logQrBill("warn", "reference_skipped", {
      invoiceNumber: safeString(args.invoice?.invoiceNumber),
      invoiceType: safeString(args.invoice?.invoiceType),
      reason: eligibility.reason,
      openAmount: eligibility.openAmount,
    });
    return args.invoice;
  }

  const persistedType = safeString(args.invoice?.qrReferenceType).toUpperCase();
  if (QR_REFERENCE_TYPES.includes(persistedType as QrReferenceType)) {
    logQrBill("info", "reference_reused", {
      invoiceNumber: safeString(args.invoice?.invoiceNumber),
      referenceType: persistedType,
      hasReference: Boolean(safeString(args.invoice?.qrReference)) || persistedType === "NON",
    });
    return args.invoice;
  }

  try {
    const referenceType = resolveQrReferenceType(args.company?.qrBill?.referenceType);
    const qrReference =
      referenceType === "QRR"
        ? generateQrReference(getInvoiceReferenceSeed(args.invoice))
        : referenceType === "SCOR"
          ? generateScorReference(
              safeString(args.invoice?.invoiceNumber) ||
                safeString(args.invoice?._id?.toString?.() ?? args.invoice?._id),
            )
          : null;
    const invoices = args.db.collection("invoices");

    const updated = await invoices.findOneAndUpdate(
      {
        _id: args.invoice._id,
        companyId: args.companyId,
        $or: [
          { qrReferenceType: { $exists: false } },
          { qrReferenceType: null },
        ],
      },
      {
        $set: {
          qrReference,
          qrReferenceType: referenceType,
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after" },
    );

    const persisted =
      updated ??
      (await invoices.findOne({ _id: args.invoice._id, companyId: args.companyId })) ??
      args.invoice;
    logQrBill("info", "reference_persisted", {
      invoiceNumber: safeString(args.invoice?.invoiceNumber),
      referenceType: safeString(persisted?.qrReferenceType) || referenceType,
      hasReference: Boolean(safeString(persisted?.qrReference)) || referenceType === "NON",
    });
    return persisted;
  } catch (error: any) {
    logQrBill("error", "reference_persistence_failed", {
      invoiceNumber: safeString(args.invoice?.invoiceNumber),
      message: safeString(error?.message) || "Unbekannter Fehler",
    });
    return {
      ...args.invoice,
      __qrBillWarning:
        "Die QR-Referenz konnte nicht gespeichert werden; deshalb wurde kein QR-Zahlteil gedruckt.",
    };
  }
}

function normalizeLanguage(value: unknown): Language {
  const normalized = safeString(value).toUpperCase();
  return (["DE", "FR", "IT", "EN"] as const).includes(normalized as any)
    ? (normalized as Language)
    : "DE";
}

function trimTo(value: unknown, length: number) {
  return safeString(value).slice(0, length);
}

function buildDebtor(customer: any, planning: any): Data["debtor"] | undefined {
  const profile = planning?.data?.profile ?? {};
  const source = customer ?? {};
  const name = trimTo(
    safeString(source?.companyName) ||
      safeString(source?.name) ||
      [safeString(source?.firstName), safeString(source?.lastName)].filter(Boolean).join(" ") ||
      safeString(profile?.companyName) ||
      [
        safeString(profile?.firstName ?? profile?.contactFirstName),
        safeString(profile?.lastName ?? profile?.contactLastName),
      ].filter(Boolean).join(" "),
    70,
  );
  const address = trimTo(source?.street ?? profile?.street, 70);
  const buildingNumber = trimTo(source?.streetNo ?? profile?.streetNo, 16);
  const zip = trimTo(source?.zip ?? profile?.zip, 16);
  const city = trimTo(source?.city ?? profile?.city, 35);
  const country = safeString(source?.country).toUpperCase() || "CH";

  if (!name || !address || !zip || !city || !/^[A-Z]{2}$/.test(country)) {
    return undefined;
  }

  return {
    name,
    address,
    ...(buildingNumber ? { buildingNumber } : {}),
    zip,
    city,
    country,
  };
}

function validateQrBillData(args: {
  account: string;
  referenceType: QrReferenceType;
  creditor: any;
}) {
  if (!args.account) return "Für die QR-Rechnung fehlt eine IBAN.";
  if (!isValidIban(args.account)) return "Die IBAN für die QR-Rechnung ist ungültig.";
  if (!/^(CH|LI)/.test(args.account)) {
    return "Für die QR-Rechnung ist eine schweizerische oder liechtensteinische IBAN erforderlich.";
  }
  if (args.referenceType === "QRR" && !isQrIban(args.account)) {
    return "Für eine QR-Referenz (QRR) ist zwingend eine gültige QR-IBAN erforderlich.";
  }
  if (args.referenceType !== "QRR" && isQrIban(args.account)) {
    return "Für SCOR oder NON darf keine QR-IBAN verwendet werden.";
  }
  if (!safeString(args.creditor?.name)) {
    return "Für die QR-Rechnung fehlt der Name des Zahlungsempfängers.";
  }
  if (!safeString(args.creditor?.address)) {
    return "Für die QR-Rechnung fehlt die Strasse des Zahlungsempfängers.";
  }
  if (!safeString(args.creditor?.zip)) {
    return "Für die QR-Rechnung fehlt die PLZ des Zahlungsempfängers.";
  }
  if (!safeString(args.creditor?.city)) {
    return "Für die QR-Rechnung fehlt der Ort des Zahlungsempfängers.";
  }
  if (!/^[A-Z]{2}$/.test(safeString(args.creditor?.country).toUpperCase())) {
    return "Für die QR-Rechnung muss das Land des Zahlungsempfängers als ISO-2-Code erfasst sein.";
  }
  return null;
}

async function renderPaymentPart(data: Data, language: Language) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const document = new PDFKitDocument({ autoFirstPage: false, margin: 0 });
    document.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);

    try {
      const qrBill = new SwissQRBill(data, {
        language,
        outlines: true,
        scissors: true,
        renderAdditionalInformation: true,
      });
      qrBill.attachTo(document);
      document.end();
    } catch (error) {
      document.end();
      reject(error);
    }
  });
}

export async function createInvoiceQrPaymentPart(args: {
  invoice: any;
  planning: any;
  company: any;
  customer?: any | null;
}) {
  const qrBill = args.company?.qrBill ?? {};
  const eligibility = getQrEligibility(args.invoice, qrBill);
  logQrBill(eligibility.eligible ? "info" : "warn", "eligibility_checked", {
    invoiceNumber: safeString(args.invoice?.invoiceNumber),
    invoiceType: safeString(args.invoice?.invoiceType),
    status: safeString(args.invoice?.status),
    paymentStatus: safeString(args.invoice?.paymentStatus),
    enabled: qrBill?.enabled !== false,
    eligible: eligibility.eligible,
    reason: eligibility.reason,
    openAmount: eligibility.openAmount,
  });
  if (!eligibility.eligible) {
    return { paymentPartPdfBytes: null, qrBillWarning: eligibility.warning };
  }
  if (safeString(args.invoice?.__qrBillWarning)) {
    const qrBillWarning = safeString(args.invoice.__qrBillWarning);
    logQrBill("error", "render_skipped_after_reference_failure", {
      invoiceNumber: safeString(args.invoice?.invoiceNumber),
      warning: qrBillWarning,
    });
    return { paymentPartPdfBytes: null, qrBillWarning };
  }

  const referenceType = resolveQrReferenceType(
    args.invoice?.qrReferenceType ?? qrBill?.referenceType,
  );
  const bank = args.company?.bank ?? {};
  const billing = args.company?.billing ?? {};
  const account = normalizeCompact(
    referenceType === "QRR" ? qrBill?.qrIban : bank?.iban || billing?.iban,
  );
  const creditor = {
    account,
    name: trimTo(bank?.accountHolder || args.company?.name, 70),
    address: trimTo(qrBill?.creditor?.street, 70),
    buildingNumber: trimTo(qrBill?.creditor?.houseNumber, 16),
    zip: trimTo(qrBill?.creditor?.zip, 16),
    city: trimTo(qrBill?.creditor?.city, 35),
    country: safeString(qrBill?.creditor?.country).toUpperCase(),
  };
  const warning = validateQrBillData({ account, referenceType, creditor });
  if (warning) {
    logQrBill("warn", "validation_failed", {
      invoiceNumber: safeString(args.invoice?.invoiceNumber),
      referenceType,
      hasAccount: Boolean(account),
      hasCreditorAddress: Boolean(creditor.address && creditor.zip && creditor.city && creditor.country),
      warning,
    });
    return { paymentPartPdfBytes: null, qrBillWarning: warning };
  }

  const invoiceNumber = safeString(args.invoice?.invoiceNumber);
  const reference = normalizeCompact(args.invoice?.qrReference);
  if (referenceType === "QRR" && !isValidQrReference(reference)) {
    logQrBill("warn", "reference_validation_failed", {
      invoiceNumber,
      referenceType,
    });
    return {
      paymentPartPdfBytes: null,
      qrBillWarning: "Die QR-Referenz ist ungültig und der Zahlteil wurde nicht gedruckt.",
    };
  }
  if (referenceType === "SCOR" && !isValidScorReference(reference)) {
    logQrBill("warn", "reference_validation_failed", {
      invoiceNumber,
      referenceType,
    });
    return {
      paymentPartPdfBytes: null,
      qrBillWarning: "Die Creditor Reference ist ungültig und der Zahlteil wurde nicht gedruckt.",
    };
  }

  const rateLabel =
    safeString(args.invoice?.rateLabel) ||
    safeString(args.invoice?.label) ||
    `Rate ${Math.max(0, Math.trunc(safeNumber(args.invoice?.rateIndex, 0))) + 1}`;
  const paymentInformation = [invoiceNumber, rateLabel].filter(Boolean).join(" · ");
  const data: Data = {
    creditor: {
      account,
      name: creditor.name,
      address: creditor.address,
      ...(creditor.buildingNumber ? { buildingNumber: creditor.buildingNumber } : {}),
      zip: creditor.zip,
      city: creditor.city,
      country: creditor.country,
    },
    debtor: buildDebtor(args.customer, args.planning),
    currency: "CHF",
    amount: eligibility.openAmount,
    ...(referenceType === "NON"
      ? { additionalInformation: paymentInformation.slice(0, MAX_QR_MESSAGE_LENGTH) }
      : {
          reference,
          message: paymentInformation.slice(0, MAX_QR_MESSAGE_LENGTH),
        }),
  };

  try {
    const paymentPartPdfBytes = await renderPaymentPart(
      data,
      normalizeLanguage(qrBill?.language || args.company?.defaults?.language || "de"),
    );
    logQrBill("info", "payment_part_rendered", {
      invoiceNumber,
      referenceType,
      openAmount: eligibility.openAmount,
      bytes: paymentPartPdfBytes.length,
    });
    return { paymentPartPdfBytes, qrBillWarning: null };
  } catch (error: any) {
    logQrBill("error", "payment_part_render_failed", {
      invoiceNumber,
      referenceType,
      message: safeString(error?.message) || "Unbekannter Fehler",
    });
    return {
      paymentPartPdfBytes: null,
      qrBillWarning: "Der QR-Zahlteil konnte wegen ungültiger Zahlungsdaten nicht gedruckt werden.",
    };
  }
}
