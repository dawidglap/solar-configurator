import type { Db } from "mongodb";
import { PDFDocument, PDFPage, PDFFont, rgb } from "pdf-lib";
import { addPaymentSlipPage } from "@/app/api/plannings/[planningId]/offer/pdf/payment-slip-page";
import { safeString, toObjectIdOrNull, type SessionPayload } from "@/lib/api-session";
import { formatIban, roundToFiveCents } from "@/lib/planningDocuments";
import {
  ensurePlanningFileIndexes,
  getPlanningFilesCollection,
  removePlanningFileCloudinaryAsset,
  uploadGeneratedPlanningFileBuffer,
} from "@/lib/planningFiles";
import { getSessionUserEmail, getSessionUserMeta, safeNumber } from "@/lib/tasks";
import { getInvoiceByIdForCompany, type InvoiceType } from "@/lib/invoices";

type BuildInvoicePdfArgs = {
  invoice: any;
  planning: any;
  company: any;
};

type PersistInvoicePdfArgs = {
  db: Db;
  companyId: string;
  invoiceId: string;
  planningId: string;
  customerId?: string | null;
  invoice: any;
  buffer: Buffer;
  session: SessionPayload;
};

function parseDate(value: unknown) {
  if (value instanceof Date) return value;
  const normalized = safeString(value);
  if (!normalized) return null;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateCH(value: Date | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(value);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + Math.max(0, Math.trunc(days)));
  return next;
}

function money(value: number) {
  return new Intl.NumberFormat("de-CH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function wrapText(text: string, maxWidth: number, font: PDFFont, size: number) {
  const clean = safeString(text).replace(/\s+/g, " ").trim();
  if (!clean) return [];

  const words = clean.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next;
      continue;
    }

    if (current) lines.push(current);
    current = word;
  }

  if (current) lines.push(current);
  return lines;
}

function splitParagraphs(text: string) {
  return safeString(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function loadLogoBytes(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Logo download failed (${response.status})`);
  }
  const contentType = safeString(response.headers.get("content-type")).toLowerCase();
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    isPng: contentType.includes("png") || url.toLowerCase().includes(".png"),
  };
}

async function drawLogo(args: {
  pdf: PDFDocument;
  page: PDFPage;
  logoUrl?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}) {
  if (!safeString(args.logoUrl)) return false;

  try {
    const { bytes, isPng } = await loadLogoBytes(safeString(args.logoUrl));
    const image = isPng ? await args.pdf.embedPng(bytes) : await args.pdf.embedJpg(bytes);
    const scale = Math.min(args.w / image.width, args.h / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    args.page.drawImage(image, {
      x: args.x,
      y: args.y + (args.h - height) / 2,
      width,
      height,
    });
    return true;
  } catch (error) {
    console.warn("INVOICE LOGO ERROR:", error);
    return false;
  }
}

function resolveFooterBankDetails(company: any) {
  const pdfSettings = company?.pdfSettings ?? {};
  const sourceSegments = [
    safeString(pdfSettings?.footerBankName),
    safeString(pdfSettings?.footerAccountHolder),
    safeString(pdfSettings?.footerIban),
    safeString(pdfSettings?.footerBic),
  ]
    .filter(Boolean)
    .flatMap((value) =>
      value
        .split(/[·•|]/)
        .map((segment) => safeString(segment))
        .filter(Boolean),
    );

  let bankName = "";
  let accountHolder = "";
  let iban = "";
  let bicSwift = "";

  for (const segment of sourceSegments) {
    const compact = segment.replace(/\s+/g, "").toUpperCase();
    if (!iban && /^[A-Z]{2}[0-9A-Z]{13,32}$/.test(compact)) {
      iban = compact;
      continue;
    }
    if (!bicSwift && /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(compact)) {
      bicSwift = compact;
      continue;
    }
    if (!bankName) {
      bankName = segment;
      continue;
    }
    if (!accountHolder) {
      accountHolder = segment;
    }
  }

  const bank = company?.bank ?? {};
  const billing = company?.billing ?? {};

  return {
    accountHolder:
      safeString(bank?.accountHolder) ||
      safeString(company?.name) ||
      safeString(billing?.accountHolder) ||
      accountHolder,
    iban: safeString(bank?.iban) || safeString(billing?.iban) || iban,
    bankName: safeString(bank?.bankName) || safeString(billing?.bankName) || bankName,
    bicSwift:
      safeString(bank?.bicSwift) ||
      safeString(billing?.bicSwift ?? billing?.bic) ||
      bicSwift,
  };
}

function buildCompanyAddressLines(company: any) {
  return [
    safeString(company?.name),
    safeString(company?.address?.street),
    [safeString(company?.address?.zip), safeString(company?.address?.city)].filter(Boolean).join(" "),
    safeString(company?.address?.country),
  ].filter(Boolean);
}

function buildRecipientLines(planning: any, invoice: any) {
  const profile = planning?.data?.profile ?? {};
  const companyName = safeString(profile?.companyName);
  const personName = [
    safeString(profile?.firstName ?? profile?.contactFirstName),
    safeString(profile?.lastName ?? profile?.contactLastName),
  ]
    .filter(Boolean)
    .join(" ");

  return [
    safeString(invoice?.anrede),
    companyName || personName,
    safeString(profile?.street ?? profile?.buildingStreet),
    [safeString(profile?.zip ?? profile?.buildingZip), safeString(profile?.city ?? profile?.buildingCity)]
      .filter(Boolean)
      .join(" "),
  ].filter(Boolean);
}

function getInvoiceHeading(invoice: any) {
  const invoiceType = safeString(invoice?.invoiceType).toLowerCase() as InvoiceType;
  if (invoiceType === "mahnung") {
    const level = Math.max(1, safeNumber(invoice?.dunningLevel, 1));
    return `${level}. Mahnung`;
  }
  if (invoiceType === "gutschrift") {
    return "Gutschrift";
  }
  return "Rechnung";
}

function getInvoiceFileLabel(invoice: any) {
  const heading = getInvoiceHeading(invoice).replace(/\s+/g, "_");
  return `${heading}_${safeString(invoice?.invoiceNumber) || "Dokument"}.pdf`;
}

export async function buildInvoicePdf(args: BuildInvoicePdfArgs) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont("Helvetica");
  const bold = await pdf.embedFont("Helvetica-Bold");

  const cText = rgb(0.14, 0.22, 0.27);
  const cMuted = rgb(0.43, 0.49, 0.52);
  const cLine = rgb(0.82, 0.84, 0.86);
  const cSoft = rgb(0.96, 0.97, 0.97);
  const marginX = 44;

  page.drawRectangle({
    x: 0,
    y: 0,
    width: 595.28,
    height: 841.89,
    color: rgb(1, 1, 1),
  });

  const logoShown = await drawLogo({
    pdf,
    page,
    logoUrl: safeString(args.company?.branding?.logoUrl),
    x: marginX,
    y: 734,
    w: 120,
    h: 54,
  });

  if (!logoShown) {
    page.drawText(safeString(args.company?.name) || "Ihre Firma", {
      x: marginX,
      y: 758,
      size: 18,
      font: bold,
      color: cText,
    });
  }

  const companyLines = buildCompanyAddressLines(args.company);
  let companyY = 742;
  for (const line of companyLines) {
    page.drawText(line, {
      x: 382,
      y: companyY,
      size: 8.6,
      font,
      color: cMuted,
    });
    companyY -= 11;
  }

  const heading = getInvoiceHeading(args.invoice);
  page.drawText(`${heading} Nr. ${safeString(args.invoice?.invoiceNumber) || "—"}`, {
    x: marginX,
    y: 688,
    size: 20,
    font: bold,
    color: cText,
  });
  page.drawLine({
    start: { x: marginX, y: 676 },
    end: { x: 551, y: 676 },
    thickness: 1.6,
    color: cLine,
  });

  const recipientLines = buildRecipientLines(args.planning, args.invoice);
  page.drawText("Empfänger", {
    x: marginX,
    y: 640,
    size: 9,
    font: bold,
    color: cMuted,
  });
  let recipientY = 622;
  for (const line of recipientLines) {
    page.drawText(line, {
      x: marginX,
      y: recipientY,
      size: 11,
      font,
      color: cText,
    });
    recipientY -= 14;
  }

  const issueDate = parseDate(args.invoice?.issueDate);
  const dueDate = parseDate(args.invoice?.dueDate);
  const customerNumber = safeString(args.planning?.customerId) || safeString(args.planning?.data?.profile?.customerNumber) || "—";
  const detailRows = [
    ["Rechnungsnummer", safeString(args.invoice?.invoiceNumber) || "—"],
    ["Auftragsnummer", safeString(args.invoice?.orderId) || "—"],
    ["Kundennummer", customerNumber],
    ["Datum", formatDateCH(issueDate)],
    ["Fälligkeit", formatDateCH(dueDate)],
  ];

  page.drawRectangle({
    x: 330,
    y: 546,
    width: 221,
    height: 116,
    color: cSoft,
    borderColor: cLine,
    borderWidth: 0.7,
  });

  let detailsY = 636;
  for (const [label, value] of detailRows) {
    page.drawText(label, {
      x: 344,
      y: detailsY,
      size: 8.5,
      font,
      color: cMuted,
    });
    const width = bold.widthOfTextAtSize(value, 9);
    page.drawText(value, {
      x: 538 - width,
      y: detailsY,
      size: 9,
      font: bold,
      color: cText,
    });
    detailsY -= 18;
  }

  let bodyY = 514;
  for (const paragraph of splitParagraphs(args.invoice?.bodyText)) {
    const lines = wrapText(paragraph, 507, font, 10.5);
    for (const line of lines) {
      page.drawText(line, {
        x: marginX,
        y: bodyY,
        size: 10.5,
        font,
        color: cText,
      });
      bodyY -= 13;
    }
    bodyY -= 8;
  }

  const tableTop = Math.max(320, bodyY - 14);
  page.drawRectangle({
    x: marginX,
    y: tableTop,
    width: 507,
    height: 24,
    color: cSoft,
    borderColor: cLine,
    borderWidth: 0.7,
  });
  page.drawText("Beschreibung", { x: marginX + 12, y: tableTop + 8, size: 9, font: bold, color: cText });
  page.drawText("Betrag", { x: 478, y: tableTop + 8, size: 9, font: bold, color: cText });

  const rowY = tableTop - 24;
  const description = `Photovoltaik-Anlage – Rate ${safeNumber(args.invoice?.rateIndex, 0) + 1} (${safeNumber(args.invoice?.pct, 0)}%)`;
  page.drawText(description, { x: marginX + 12, y: rowY, size: 9.5, font, color: cText });
  const amountLabel = `${safeString(args.invoice?.currency) || "CHF"} ${money(safeNumber(args.invoice?.amount, 0))}`;
  const amountWidth = bold.widthOfTextAtSize(amountLabel, 9.5);
  page.drawText(amountLabel, { x: 539 - amountWidth, y: rowY, size: 9.5, font: bold, color: cText });
  page.drawLine({
    start: { x: marginX, y: rowY - 8 },
    end: { x: 551, y: rowY - 8 },
    thickness: 0.5,
    color: cLine,
  });

  const totalY = rowY - 36;
  const vatLabel = `MwSt. bereits enthalten (${money(roundToFiveCents(safeNumber(args.invoice?.amount, 0) / 1.081 * 0.081))} CHF)`;
  page.drawText(vatLabel, { x: marginX + 12, y: totalY, size: 8.5, font, color: cMuted });
  page.drawText("Total", { x: 424, y: totalY, size: 9.5, font: bold, color: cText });
  page.drawText(amountLabel, {
    x: 539 - amountWidth,
    y: totalY,
    size: 9.5,
    font: bold,
    color: cText,
  });

  if (safeString(args.invoice?.invoiceType) === "mahnung") {
    const fee = Math.max(0, safeNumber(args.invoice?.amount, 0) - safeNumber(args.invoice?.baseAmount, 0));
    if (fee > 0.009) {
      page.drawText(`Mahngebühr inklusive: CHF ${money(fee)}`, {
        x: marginX + 12,
        y: totalY - 18,
        size: 8.5,
        font,
        color: cMuted,
      });
    }
  }

  const bank = resolveFooterBankDetails(args.company);
  const footerLine = [
    safeString(bank.bankName),
    safeString(bank.accountHolder) || safeString(args.company?.name),
    formatIban(bank.iban),
    safeString(bank.bicSwift),
  ]
    .filter(Boolean)
    .join(" · ");

  page.drawLine({
    start: { x: marginX, y: 64 },
    end: { x: 551, y: 64 },
    thickness: 0.6,
    color: cLine,
  });
  page.drawText(footerLine || safeString(args.company?.name) || "Ihre Firma", {
    x: marginX,
    y: 48,
    size: 7.6,
    font,
    color: cMuted,
  });

  if (safeString(args.invoice?.invoiceType) !== "gutschrift") {
    await addPaymentSlipPage(pdf, {
      documentType: "auftrag",
      documentNumber: safeString(args.invoice?.invoiceNumber) || "—",
      documentNumberLabel: `${heading} Nr. ${safeString(args.invoice?.invoiceNumber) || "—"}`,
      invoiceDate: formatDateCH(issueDate),
      dueDate: formatDateCH(dueDate ?? addDays(issueDate ?? new Date(), 30)),
      invoiceDateIso: issueDate,
      companyName: safeString(args.company?.name) || "Ihre Firma",
      companyLogoUrl: safeString(args.company?.branding?.logoUrl),
      companyAddressLines: companyLines,
      customerAddressLines: recipientLines,
      paymentRows: [
        {
          label: description,
          pct: safeNumber(args.invoice?.pct, 0),
          amountChf: safeNumber(args.invoice?.amount, 0),
          dueAt: formatDateCH(dueDate),
        },
      ],
      totalAmountChf: safeNumber(args.invoice?.amount, 0),
      currency: safeString(args.invoice?.currency) || "CHF",
      bankDetails: {
        accountHolder: bank.accountHolder,
        iban: formatIban(bank.iban),
        bankName: bank.bankName,
        bicSwift: bank.bicSwift,
      },
      reference: safeString(args.invoice?.invoiceNumber) || safeString(args.invoice?._id),
      additionalInformation: `${safeString(args.invoice?.orderId) || safeString(args.invoice?.invoiceNumber)} vom ${formatDateCH(issueDate)}`,
      showPreviewWatermark: false,
      showIbanWarning: !safeString(bank.iban),
    });
  }

  const pdfBytes = await pdf.save();
  return {
    pdfBytes: Buffer.from(pdfBytes),
    fileName: getInvoiceFileLabel(args.invoice),
  };
}

export async function persistInvoicePdfFile(args: PersistInvoicePdfArgs) {
  await ensurePlanningFileIndexes(args.db);
  const files = getPlanningFilesCollection(args.db);
  const invoiceObjectId = toObjectIdOrNull(args.invoiceId);
  const pdfFileObjectId = toObjectIdOrNull(args.invoice?.pdfFileId);
  const existing =
    (pdfFileObjectId
      ? await files.findOne({ _id: pdfFileObjectId })
      : null) ||
    (invoiceObjectId
      ? await files.findOne({
          companyId: args.companyId,
          planningId: args.planningId,
          invoiceId: invoiceObjectId,
          isDeleted: { $ne: true },
        })
      : null);

  const uploadedDoc = await uploadGeneratedPlanningFileBuffer({
    companyId: args.companyId,
    planningId: args.planningId,
    category: "document",
    title: getInvoiceHeading(args.invoice) + " " + (safeString(args.invoice?.invoiceNumber) || "Dokument"),
    originalFileName: getInvoiceFileLabel(args.invoice),
    mimeType: "application/pdf",
    buffer: args.buffer,
    customerId: safeString(args.customerId),
    session: args.session,
    type: `${safeString(args.invoice?.invoiceType) || "rechnung"}_pdf`,
    linkToPlanningId: args.planningId,
  });

  const now = new Date().toISOString();
  const meta = getSessionUserMeta(args.session);
  const nextDoc = {
    ...uploadedDoc,
    invoiceId: invoiceObjectId,
    updatedAt: now,
    uploadedByUserId: toObjectIdOrNull(meta.id) ?? meta.id ?? null,
    uploadedByName: meta.name || "Unbekannt",
    ...(getSessionUserEmail(args.session) ? { uploadedByEmail: getSessionUserEmail(args.session) } : {}),
  };

  if (!existing) {
    const insert = await files.insertOne(nextDoc);
    return { ...nextDoc, _id: insert.insertedId };
  }

  try {
    await removePlanningFileCloudinaryAsset(existing);
  } catch (error) {
    console.error("REMOVE OLD INVOICE PDF ERROR:", error);
  }

  await files.updateOne(
    { _id: existing._id },
    {
      $set: {
        ...nextDoc,
        createdAt: existing.createdAt ?? nextDoc.createdAt,
      },
    },
  );

  return {
    ...existing,
    ...nextDoc,
  };
}

export async function getInvoiceContextById(args: {
  db: Db;
  companyId: string;
  invoiceId: string;
}) {
  const invoice = await getInvoiceByIdForCompany(args.db, args.invoiceId, args.companyId);
  if (!invoice) return null;

  const planningObjectId = toObjectIdOrNull(invoice.planningId);
  const planning = planningObjectId
    ? await args.db.collection("plannings").findOne({
        _id: planningObjectId,
        companyId: args.companyId,
      })
    : null;
  if (!planning) return null;

  const companyObjectId = toObjectIdOrNull(args.companyId);
  if (!companyObjectId) return null;

  const company = await args.db.collection("companies").findOne({
    _id: companyObjectId,
  });
  if (!company) return null;

  return { invoice, planning, company };
}
