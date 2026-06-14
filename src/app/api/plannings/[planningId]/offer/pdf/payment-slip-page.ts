import { PDFDocument, PDFPage, PDFFont, degrees, rgb } from "pdf-lib";

type PaymentSlipRow = {
  label: string;
  pct: number;
  amountChf: number;
  dueAt: string;
};

type PaymentSlipPageData = {
  documentType: "angebot" | "auftrag";
  documentNumber: string;
  documentNumberLabel: string;
  invoiceDate: string;
  dueDate: string;
  invoiceDateIso?: Date | null;
  companyName: string;
  companyLogoUrl?: string;
  companyAddressLines: string[];
  customerAddressLines: string[];
  paymentRows: PaymentSlipRow[];
  totalAmountChf: number;
  currency: string;
  bankDetails: {
    accountHolder?: string;
    iban?: string;
    bankName?: string;
    bicSwift?: string;
  };
  reference: string;
  additionalInformation: string;
  showPreviewWatermark?: boolean;
  showIbanWarning?: boolean;
};

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN_X = 42;
const TOP_Y = 790;
const BOTTOM_Y = 54;

const C = {
  text: rgb(0.14, 0.22, 0.27),
  muted: rgb(0.43, 0.49, 0.52),
  line: rgb(0.82, 0.84, 0.86),
  soft: rgb(0.96, 0.97, 0.97),
  accent: rgb(0.12, 0.32, 0.37),
  warning: rgb(0.76, 0.24, 0.16),
  white: rgb(1, 1, 1),
};

function safeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function money(value: number) {
  return new Intl.NumberFormat("de-CH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function drawText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  size: number,
  font: PDFFont,
  color = C.text,
) {
  page.drawText(text, { x, y, size, font, color });
}

function drawRightText(
  page: PDFPage,
  text: string,
  rightX: number,
  y: number,
  size: number,
  font: PDFFont,
  color = C.text,
) {
  const width = font.widthOfTextAtSize(text, size);
  drawText(page, text, rightX - width, y, size, font, color);
}

function drawLine(page: PDFPage, x1: number, y1: number, x2: number, y2: number, thickness = 0.7) {
  page.drawLine({
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    thickness,
    color: C.line,
  });
}

function drawDashedLine(
  page: PDFPage,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  dash = 4,
  gap = 3,
) {
  const horizontal = Math.abs(y2 - y1) < 0.1;
  const length = horizontal ? Math.abs(x2 - x1) : Math.abs(y2 - y1);
  const step = dash + gap;
  const direction = horizontal ? Math.sign(x2 - x1) || 1 : Math.sign(y2 - y1) || 1;

  for (let offset = 0; offset < length; offset += step) {
    const segment = Math.min(dash, length - offset);
    if (horizontal) {
      drawLine(page, x1 + offset * direction, y1, x1 + (offset + segment) * direction, y2, 0.7);
    } else {
      drawLine(page, x1, y1 + offset * direction, x2, y1 + (offset + segment) * direction, 0.7);
    }
  }
}

function drawDashedRect(page: PDFPage, x: number, y: number, w: number, h: number) {
  drawDashedLine(page, x, y, x + w, y);
  drawDashedLine(page, x, y + h, x + w, y + h);
  drawDashedLine(page, x, y, x, y + h);
  drawDashedLine(page, x + w, y, x + w, y + h);
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

function drawWrappedLines(args: {
  page: PDFPage;
  lines: string[];
  x: number;
  y: number;
  size: number;
  lineHeight: number;
  font: PDFFont;
  color?: ReturnType<typeof rgb>;
}) {
  const { page, lines, x, y, size, lineHeight, font, color = C.text } = args;
  let cursorY = y;

  for (const line of lines) {
    drawText(page, line, x, cursorY, size, font, color);
    cursorY -= lineHeight;
  }

  return cursorY;
}

function mmToPt(mm: number) {
  return mm * 2.8346456693;
}

async function loadLogoBytes(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Logo download failed with ${response.status}`);
  }

  const contentType = safeString(response.headers.get("content-type")).toLowerCase();
  const bytes = Buffer.from(await response.arrayBuffer());

  return {
    bytes,
    isPng: contentType.includes("png") || url.toLowerCase().includes(".png"),
  };
}

async function drawLogo(args: {
  pdf: PDFDocument;
  page: PDFPage;
  url?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}) {
  const { pdf, page, url, x, y, w, h } = args;
  if (!safeString(url)) return false;

  try {
    const { bytes, isPng } = await loadLogoBytes(safeString(url));
    const image = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    const scale = Math.min(w / image.width, h / image.height);
    const width = image.width * scale;
    const height = image.height * scale;

    page.drawImage(image, {
      x,
      y: y + (h - height) / 2,
      width,
      height,
    });

    return true;
  } catch (error) {
    console.warn("PAYMENT SLIP LOGO ERROR:", error);
    return false;
  }
}

function drawWatermark(page: PDFPage, bold: PDFFont) {
  page.drawText("Vorschau — nicht zahlungswirksam", {
    x: 96,
    y: 356,
    size: 34,
    font: bold,
    color: rgb(0.55, 0.58, 0.6),
    rotate: degrees(34),
    opacity: 0.1,
  });
}

function fallbackText(value: unknown) {
  return safeString(value) || "—";
}

function drawInfoBlock(args: {
  page: PDFPage;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  font: PDFFont;
  bold: PDFFont;
}) {
  const { page, title, x, y, w, h, font, bold } = args;
  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    color: C.white,
    borderColor: C.line,
    borderWidth: 0.75,
  });
  drawText(page, title, x + 10, y + h - 16, 10, bold);
  drawLine(page, x + 10, y + h - 22, x + w - 10, y + h - 22, 0.6);
  drawText(page, "", x + 10, y + h - 16, 8, font);
}

export async function addPaymentSlipPage(pdf: PDFDocument, data: PaymentSlipPageData) {
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const font = await pdf.embedFont("Helvetica");
  const bold = await pdf.embedFont("Helvetica-Bold");

  page.drawRectangle({
    x: 0,
    y: 0,
    width: PAGE_W,
    height: PAGE_H,
    color: C.white,
  });

  if (data.showPreviewWatermark) {
    drawWatermark(page, bold);
  }

  const title = "Zahlungsschein";
  drawText(page, title, MARGIN_X, TOP_Y, 18, bold);
  drawLine(page, MARGIN_X, TOP_Y - 10, PAGE_W - MARGIN_X, TOP_Y - 10, 1.8);

  const metaX = 370;
  const metaY = 740;
  const metaWidth = PAGE_W - metaX - MARGIN_X;
  const metaRows = [
    ["Rechnungsdatum", data.invoiceDate],
    ["Fällig am", data.dueDate],
    ["Kategorie", "Photovoltaik-Anlage"],
    ["Zahlung", "Einmalig"],
  ];

  page.drawRectangle({
    x: metaX,
    y: metaY - 62,
    width: metaWidth,
    height: 70,
    color: C.soft,
    borderColor: C.line,
    borderWidth: 0.7,
  });

  let metaCursorY = metaY - 10;
  for (const [label, value] of metaRows) {
    drawText(page, label, metaX + 12, metaCursorY, 8.2, font, C.muted);
    drawRightText(page, fallbackText(value), metaX + metaWidth - 12, metaCursorY, 8.8, bold);
    metaCursorY -= 15.5;
  }

  if (data.showIbanWarning) {
    drawText(
      page,
      "IBAN in Firmeneinstellungen ergänzen, um den Zahlungsschein zu vervollständigen.",
      MARGIN_X,
      730,
      8.8,
      bold,
      C.warning,
    );
  }

  const logoShown = await drawLogo({
    pdf,
    page,
    url: data.companyLogoUrl,
    x: MARGIN_X,
    y: 650,
    w: 96,
    h: 44,
  });

  const companyNameX = logoShown ? MARGIN_X + 108 : MARGIN_X;
  const companyNameLines = wrapText(data.companyName, 215, bold, 17);
  drawWrappedLines({
    page,
    lines: companyNameLines,
    x: companyNameX,
    y: 676,
    size: 17,
    lineHeight: 18.5,
    font: bold,
  });

  drawText(page, "Empfänger-Adresse", 334, 690, 9, bold, C.muted);
  drawWrappedLines({
    page,
    lines: data.customerAddressLines.length ? data.customerAddressLines : ["—"],
    x: 334,
    y: 674,
    size: 9.3,
    lineHeight: 12,
    font,
  });

  const tableTopY = 606;
  const tableLeft = MARGIN_X;
  const tableRight = PAGE_W - MARGIN_X;
  const colDescription = tableLeft + 12;
  const colAmountRight = tableLeft + 380;
  const colDueRight = tableRight - 12;

  page.drawRectangle({
    x: tableLeft,
    y: tableTopY - 26,
    width: tableRight - tableLeft,
    height: 24,
    color: C.soft,
    borderColor: C.line,
    borderWidth: 0.7,
  });

  drawText(page, "Beschreibung", colDescription, tableTopY - 16, 9, bold);
  drawRightText(page, "Betrag", colAmountRight, tableTopY - 16, 9, bold);
  drawRightText(page, "Fällig am", colDueRight, tableTopY - 16, 9, bold);

  let rowY = tableTopY - 44;
  for (const row of data.paymentRows) {
    drawText(page, safeString(row.label) || "Rate", colDescription, rowY, 8.8, font);
    drawRightText(
      page,
      `${data.currency} ${money(row.amountChf)}`,
      colAmountRight,
      rowY,
      8.8,
      font,
    );
    drawRightText(page, fallbackText(row.dueAt), colDueRight, rowY, 8.8, font);
    drawLine(page, tableLeft, rowY - 6, tableRight, rowY - 6, 0.45);
    rowY -= 21;
  }

  rowY -= 4;
  drawText(page, "Offener Betrag", colDescription, rowY, 9.3, bold);
  drawRightText(
    page,
    `${data.currency} ${money(data.totalAmountChf)}`,
    colAmountRight,
    rowY,
    9.3,
    bold,
  );
  drawLine(page, tableLeft, rowY - 7, tableRight, rowY - 7, 0.9);

  const cutY = 354;
  drawDashedLine(page, MARGIN_X, cutY, PAGE_W - MARGIN_X, cutY, 5, 3);
  drawText(page, "✂", MARGIN_X + 4, cutY + 6, 10, font, C.muted);

  const sectionY = 82;
  const sectionH = 248;
  const gap = 12;
  const leftW = 136;
  const midW = 175;
  const rightW = PAGE_W - MARGIN_X * 2 - leftW - midW - gap * 2;
  const leftX = MARGIN_X;
  const midX = leftX + leftW + gap;
  const rightX = midX + midW + gap;

  drawInfoBlock({ page, title: "Empfangsschein", x: leftX, y: sectionY, w: leftW, h: sectionH, font, bold });
  drawInfoBlock({ page, title: "Zahlteil", x: midX, y: sectionY, w: midW, h: sectionH, font, bold });
  drawInfoBlock({
    page,
    title: "Konto / Zahlbar an",
    x: rightX,
    y: sectionY,
    w: rightW,
    h: sectionH,
    font,
    bold,
  });

  const accountHolder = fallbackText(data.bankDetails.accountHolder || data.companyName);
  const iban = fallbackText(data.bankDetails.iban);
  const bankName = fallbackText(data.bankDetails.bankName);
  const bicSwift = fallbackText(data.bankDetails.bicSwift);
  const payerLines = data.customerAddressLines.length ? data.customerAddressLines : ["—"];
  const companyLines = data.companyAddressLines.length ? data.companyAddressLines : ["—"];

  let leftCursorY = sectionY + sectionH - 38;
  drawText(page, "Konto / Zahlbar an", leftX + 10, leftCursorY, 7.8, bold, C.muted);
  leftCursorY -= 11;
  leftCursorY = drawWrappedLines({
    page,
    lines: [iban, accountHolder, ...companyLines],
    x: leftX + 10,
    y: leftCursorY,
    size: 8.1,
    lineHeight: 10,
    font,
  });
  leftCursorY -= 6;
  drawText(page, "Referenz", leftX + 10, leftCursorY, 7.8, bold, C.muted);
  leftCursorY -= 11;
  leftCursorY = drawWrappedLines({
    page,
    lines: [fallbackText(data.reference)],
    x: leftX + 10,
    y: leftCursorY,
    size: 8.1,
    lineHeight: 10,
    font,
  });
  leftCursorY -= 6;
  drawText(page, "Zahlbar durch", leftX + 10, leftCursorY, 7.8, bold, C.muted);
  leftCursorY -= 11;
  leftCursorY = drawWrappedLines({
    page,
    lines: payerLines,
    x: leftX + 10,
    y: leftCursorY,
    size: 8.1,
    lineHeight: 10,
    font,
  });
  leftCursorY -= 6;
  drawText(page, "Währung / Betrag", leftX + 10, leftCursorY, 7.8, bold, C.muted);
  leftCursorY -= 11;
  drawText(page, `${data.currency} / ${money(data.totalAmountChf)}`, leftX + 10, leftCursorY, 8.4, bold);
  drawText(page, "Annahmestelle", leftX + 10, sectionY + 12, 8, font, C.muted);

  const qrSize = mmToPt(46);
  const qrX = midX + (midW - qrSize) / 2;
  const qrY = sectionY + 80;
  drawDashedRect(page, qrX, qrY, qrSize, qrSize);
  const qrLabel = "QR-Code folgt";
  const qrLabelWidth = bold.widthOfTextAtSize(qrLabel, 9);
  drawText(page, qrLabel, qrX + (qrSize - qrLabelWidth) / 2, qrY + qrSize / 2 - 4, 9, bold, C.muted);
  drawText(page, "Währung", midX + 14, sectionY + 52, 7.8, bold, C.muted);
  drawText(page, data.currency, midX + 14, sectionY + 40, 8.8, font);
  drawText(page, "Betrag", midX + 84, sectionY + 52, 7.8, bold, C.muted);
  drawText(page, money(data.totalAmountChf), midX + 84, sectionY + 40, 8.8, font);

  let rightCursorY = sectionY + sectionH - 38;
  drawText(page, "IBAN", rightX + 10, rightCursorY, 7.8, bold, C.muted);
  rightCursorY -= 11;
  drawText(page, iban, rightX + 10, rightCursorY, 8.4, bold);
  rightCursorY -= 16;
  rightCursorY = drawWrappedLines({
    page,
    lines: [accountHolder, ...companyLines],
    x: rightX + 10,
    y: rightCursorY,
    size: 8.1,
    lineHeight: 10,
    font,
  });
  rightCursorY -= 6;
  drawText(page, "Referenz", rightX + 10, rightCursorY, 7.8, bold, C.muted);
  rightCursorY -= 11;
  rightCursorY = drawWrappedLines({
    page,
    lines: [fallbackText(data.reference)],
    x: rightX + 10,
    y: rightCursorY,
    size: 8.1,
    lineHeight: 10,
    font,
  });
  rightCursorY -= 6;
  drawText(page, "Zusätzliche Informationen", rightX + 10, rightCursorY, 7.8, bold, C.muted);
  rightCursorY -= 11;
  rightCursorY = drawWrappedLines({
    page,
    lines: [fallbackText(data.additionalInformation), `${bankName} · ${bicSwift}`],
    x: rightX + 10,
    y: rightCursorY,
    size: 8.1,
    lineHeight: 10,
    font,
  });
  rightCursorY -= 6;
  drawText(page, "Zahlbar durch", rightX + 10, rightCursorY, 7.8, bold, C.muted);
  rightCursorY -= 11;
  drawWrappedLines({
    page,
    lines: payerLines,
    x: rightX + 10,
    y: rightCursorY,
    size: 8.1,
    lineHeight: 10,
    font,
  });

  drawLine(page, MARGIN_X, BOTTOM_Y, PAGE_W - MARGIN_X, BOTTOM_Y, 0.6);
  drawText(page, safeString(data.documentNumberLabel), MARGIN_X, BOTTOM_Y - 16, 7.5, font, C.muted);
}
