import { PDFDocument, PDFPage, PDFFont, rgb } from "pdf-lib";

type CompanyLike = {
  name?: string;
  pdfSettings?: {
    showFooter?: boolean;
    footerCompanyName?: string;
    footerAddressLine?: string;
    footerEmail?: string;
    footerWebsite?: string;
    footerPhone?: string;
    footerMobile?: string;
    footerBankName?: string;
    footerAccountHolder?: string;
    footerIban?: string;
    footerBic?: string;
    footerVatNumber?: string;
    footerUidNumber?: string;
  };
};

type DetailItem = {
  position: number;
  category?: string;
  brand?: string;
  model?: string;
  name?: string;
  quantity?: number;
  unit?: string;
  unitLabel?: string;
  unitPriceNet?: number;
  lineTotalNet?: number;

  catalogItemId?: string;
  pdfSection?: string;

  description?: string;
  longDescription?: string;
  features?: string[];
  warranty?: string;
  compatibility?: string;
  notes?: string;
};

type AddDetailPagesArgs = {
  offer: {
    title?: string;
    planningNumber?: string;
    detailItems?: DetailItem[];
  };
  company?: CompanyLike | null;
};

const PAGE_W = 595.28;
const PAGE_H = 841.89;

const MARGIN_X = 42;
const MARGIN_TOP = 46;
const MARGIN_BOTTOM = 54;

const COLOR_TEXT = rgb(0.17, 0.29, 0.35);
const COLOR_MUTED = rgb(0.36, 0.43, 0.47);
const COLOR_LINE = rgb(0.82, 0.84, 0.86);
const COLOR_SOFT = rgb(0.95, 0.95, 0.95);
const COLOR_ACCENT = rgb(0.12, 0.32, 0.37);

function safeString(v: unknown) {
  return typeof v === "string" ? v.trim() : "";
}

function safeNumber(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function safeStringArray(v: unknown) {
  return Array.isArray(v)
    ? v.map((x) => safeString(x)).filter(Boolean)
    : [];
}

function money(n?: number) {
  return new Intl.NumberFormat("de-CH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safeNumber(n, 0));
}

function drawText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  size: number,
  font: PDFFont,
  color = COLOR_TEXT
) {
  page.drawText(text, { x, y, size, font, color });
}

function drawLine(
  page: PDFPage,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  thickness = 1,
  color = COLOR_LINE
) {
  page.drawLine({
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    thickness,
    color,
  });
}

function wrapText(text: string, maxWidth: number, font: PDFFont, size: number) {
  const clean = safeString(text).replace(/\s+/g, " ").trim();
  if (!clean) return [];

  const words = clean.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const trial = current ? `${current} ${word}` : word;
    const width = font.widthOfTextAtSize(trial, size);

    if (width <= maxWidth) {
      current = trial;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines;
}

function normalizeSection(section: string) {
  const s = safeString(section).toLowerCase();
  if (!s) return "allgemein";
  return s;
}

function sectionLabel(section: string) {
  const s = normalizeSection(section);

  if (s === "system") return "System";
  if (s === "components") return "Komponenten";
  if (s === "electrical") return "Elektrik";
  if (s === "mounting") return "Montagesystem";
  if (s === "service") return "Dienstleistungen";
  if (s === "optional") return "Optionen";
  return "Weitere Positionen";
}

function buildItemTitle(item: DetailItem) {
  const title =
    safeString(item.name) ||
    [safeString(item.brand), safeString(item.model)].filter(Boolean).join(" ");

  return title || "Position";
}

function buildItemSubline(item: DetailItem) {
  const parts = [
    safeString(item.brand),
    safeString(item.model),
    safeString(item.category),
  ].filter(Boolean);

  return parts.join(" · ");
}

function buildFooterLines(company?: CompanyLike | null) {
  const pdf = company?.pdfSettings;
  const showFooter = pdf?.showFooter ?? true;
  if (!showFooter) return [];

  const line1 = [
    safeString(pdf?.footerCompanyName) || safeString(company?.name),
    safeString(pdf?.footerAddressLine),
  ]
    .filter(Boolean)
    .join(" · ");

  const line2 = [
    safeString(pdf?.footerEmail),
    safeString(pdf?.footerWebsite),
    safeString(pdf?.footerPhone),
    safeString(pdf?.footerMobile),
  ]
    .filter(Boolean)
    .join(" · ");

  const line3 = [
    safeString(pdf?.footerBankName),
    safeString(pdf?.footerAccountHolder),
    safeString(pdf?.footerIban),
    safeString(pdf?.footerBic),
  ]
    .filter(Boolean)
    .join(" · ");

  const line4 = [
    safeString(pdf?.footerVatNumber),
    safeString(pdf?.footerUidNumber),
  ]
    .filter(Boolean)
    .join(" · ");

  return [line1, line2, line3, line4].filter(Boolean);
}

function estimateItemHeight(item: DetailItem, font: PDFFont, bold: PDFFont) {
  const bodyWidth = PAGE_W - MARGIN_X * 2;
  const leftWidth = 360;

  let h = 0;

  h += 22; // table row
  h += 8;

  const description = safeString(item.description);
  const longDescription = safeString(item.longDescription);

  if (description) {
    h += wrapText(description, leftWidth, font, 9.5).length * 11;
    h += 4;
  }

  if (longDescription) {
    h += wrapText(longDescription, leftWidth, font, 9.2).length * 11;
    h += 4;
  }

  const features = safeStringArray(item.features);
  if (features.length) {
    for (const feature of features) {
      const lines = wrapText(feature, leftWidth - 12, font, 8.8);
      h += Math.max(1, lines.length) * 10;
    }
    h += 4;
  }

  const extras = [
    safeString(item.warranty) ? `Garantie: ${safeString(item.warranty)}` : "",
    safeString(item.compatibility) ? `Kompatibilität: ${safeString(item.compatibility)}` : "",
    safeString(item.notes) ? `Hinweise: ${safeString(item.notes)}` : "",
  ].filter(Boolean);

  for (const extra of extras) {
    h += wrapText(extra, bodyWidth, font, 8.5).length * 10;
  }

  h += 8;
  h += 8; // divider / spacing

  return h;
}

function estimateSectionHeaderHeight() {
  return 28;
}

export async function addDetailPages(pdf: PDFDocument, args: AddDetailPagesArgs) {
  const items = Array.isArray(args.offer?.detailItems) ? args.offer.detailItems : [];
  if (!items.length) return;

  const font = await pdf.embedFont("Helvetica");
  const bold = await pdf.embedFont("Helvetica-Bold");

  const footerLines = buildFooterLines(args.company);

  let pageNumber = pdf.getPageCount() + 1;
  let page = createPage(pdf, {
    pageNumber,
    offerTitle: safeString(args.offer?.title) || "Photovoltaik-Angebot",
    planningNumber: safeString(args.offer?.planningNumber),
    company: args.company,
    font,
    bold,
    footerLines,
  });

  let y = page.cursorY;
  let currentSection = "";

  for (const item of items) {
    const section = normalizeSection(item.pdfSection || "");
    const needsSectionHeader = section !== currentSection;

    const sectionHeight = needsSectionHeader ? estimateSectionHeaderHeight() : 0;
    const itemHeight = estimateItemHeight(item, font, bold);
    const minNeeded = sectionHeight + itemHeight;

    if (y - minNeeded < MARGIN_BOTTOM + 70) {
      pageNumber += 1;
      page = createPage(pdf, {
        pageNumber,
        offerTitle: safeString(args.offer?.title) || "Photovoltaik-Angebot",
        planningNumber: safeString(args.offer?.planningNumber),
        company: args.company,
        font,
        bold,
        footerLines,
      });
      y = page.cursorY;
      currentSection = "";
    }

    if (needsSectionHeader) {
      y = drawSectionHeader(page.page, {
        y,
        label: sectionLabel(section),
        font,
        bold,
      });
      currentSection = section;
    }

    y = drawDetailItem(page.page, {
      y,
      item,
      font,
      bold,
    });
  }
}

function createPage(
  pdf: PDFDocument,
  args: {
    pageNumber: number;
    offerTitle: string;
    planningNumber: string;
    company?: CompanyLike | null;
    font: PDFFont;
    bold: PDFFont;
    footerLines: string[];
  }
) {
  const page = pdf.addPage([PAGE_W, PAGE_H]);

  page.drawRectangle({
    x: 0,
    y: 0,
    width: PAGE_W,
    height: PAGE_H,
    color: rgb(1, 1, 1),
  });

  // Header
  drawText(page, args.offerTitle, MARGIN_X, PAGE_H - 36, 15, args.bold, COLOR_TEXT);

  const topRight = [
    args.planningNumber ? `Offerte Nr. ${args.planningNumber}` : "",
    `Seite ${args.pageNumber}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const topRightW = args.font.widthOfTextAtSize(topRight, 9.2);
  drawText(page, topRight, PAGE_W - MARGIN_X - topRightW, PAGE_H - 33, 9.2, args.font, COLOR_MUTED);

  drawLine(page, MARGIN_X, PAGE_H - 46, PAGE_W - MARGIN_X, PAGE_H - 46, 1.4, COLOR_ACCENT);

  // Table head
  const headY = PAGE_H - 68;
  page.drawRectangle({
    x: MARGIN_X,
    y: headY - 14,
    width: PAGE_W - MARGIN_X * 2,
    height: 22,
    color: COLOR_SOFT,
  });

  drawText(page, "Pos.", MARGIN_X + 6, headY - 6, 9, args.bold, COLOR_TEXT);
  drawText(page, "Beschreibung", MARGIN_X + 40, headY - 6, 9, args.bold, COLOR_TEXT);
  drawText(page, "Menge", PAGE_W - MARGIN_X - 148, headY - 6, 9, args.bold, COLOR_TEXT);
  drawText(page, "Preis", PAGE_W - MARGIN_X - 90, headY - 6, 9, args.bold, COLOR_TEXT);
  drawText(page, "Total", PAGE_W - MARGIN_X - 34, headY - 6, 9, args.bold, COLOR_TEXT);

  drawLine(page, MARGIN_X, headY - 16, PAGE_W - MARGIN_X, headY - 16, 0.8, COLOR_LINE);

  // Footer
  if (args.footerLines.length) {
    let footerY = 42;
    drawLine(page, MARGIN_X, footerY + 26, PAGE_W - MARGIN_X, footerY + 26, 0.8, COLOR_LINE);

    for (const line of args.footerLines) {
      const lines = wrapText(line, PAGE_W - MARGIN_X * 2, args.font, 7.2);
      for (const l of lines) {
        drawText(page, l, MARGIN_X, footerY, 7.2, args.font, COLOR_MUTED);
        footerY -= 9;
      }
    }
  }

  return {
    page,
    cursorY: PAGE_H - 102,
  };
}

function drawSectionHeader(
  page: PDFPage,
  args: {
    y: number;
    label: string;
    font: PDFFont;
    bold: PDFFont;
  }
) {
  const { y, label, bold } = args;

  page.drawRectangle({
    x: MARGIN_X,
    y: y - 12,
    width: PAGE_W - MARGIN_X * 2,
    height: 18,
    color: rgb(0.97, 0.97, 0.97),
  });

  drawText(page, label, MARGIN_X + 6, y - 6, 9.2, bold, COLOR_TEXT);
  return y - 26;
}

function drawDetailItem(
  page: PDFPage,
  args: {
    y: number;
    item: DetailItem;
    font: PDFFont;
    bold: PDFFont;
  }
) {
  const { item, font, bold } = args;
  let y = args.y;

  const title = buildItemTitle(item);
  const subline = buildItemSubline(item);
  const qty = safeNumber(item.quantity, 0);
  const unitLabel = safeString(item.unitLabel) || safeString(item.unit) || "Stk.";
  const qtyText = qty > 0 ? `${qty} ${unitLabel}` : "—";
  const unitPriceText = `${money(item.unitPriceNet)} CHF`;
  const lineTotalText = `${money(item.lineTotalNet)} CHF`;

  drawText(page, String(item.position || "—"), MARGIN_X + 6, y, 9.2, font, COLOR_TEXT);
  drawText(page, title, MARGIN_X + 40, y, 9.6, bold, COLOR_TEXT);

  const qtyW = font.widthOfTextAtSize(qtyText, 9);
  drawText(page, qtyText, PAGE_W - MARGIN_X - 132 - qtyW, y, 9, font, COLOR_TEXT);

  const unitPriceW = font.widthOfTextAtSize(unitPriceText, 9);
  drawText(page, unitPriceText, PAGE_W - MARGIN_X - 72 - unitPriceW, y, 9, font, COLOR_TEXT);

  const lineTotalW = bold.widthOfTextAtSize(lineTotalText, 9.2);
  drawText(page, lineTotalText, PAGE_W - MARGIN_X - lineTotalW, y, 9.2, bold, COLOR_TEXT);

  y -= 12;

  if (subline) {
    drawText(page, subline, MARGIN_X + 40, y, 8.2, font, COLOR_MUTED);
    y -= 12;
  } else {
    y -= 2;
  }

  const leftWidth = 360;

  const description = safeString(item.description);
  if (description) {
    const lines = wrapText(description, leftWidth, font, 9.5);
    for (const line of lines) {
      drawText(page, line, MARGIN_X + 40, y, 9.5, font, COLOR_TEXT);
      y -= 11;
    }
    y -= 2;
  }

  const longDescription = safeString(item.longDescription);
  if (longDescription) {
    const lines = wrapText(longDescription, leftWidth, font, 9.2);
    for (const line of lines) {
      drawText(page, line, MARGIN_X + 40, y, 9.2, font, COLOR_TEXT);
      y -= 11;
    }
    y -= 2;
  }

  const features = safeStringArray(item.features);
  if (features.length) {
    for (const feature of features) {
      const lines = wrapText(feature, leftWidth - 12, font, 8.8);
      if (!lines.length) continue;

      drawText(page, "•", MARGIN_X + 44, y, 9, bold, COLOR_TEXT);
      drawText(page, lines[0], MARGIN_X + 56, y, 8.8, font, COLOR_TEXT);
      y -= 10;

      for (let i = 1; i < lines.length; i++) {
        drawText(page, lines[i], MARGIN_X + 56, y, 8.8, font, COLOR_TEXT);
        y -= 10;
      }
    }
    y -= 2;
  }

  const extras = [
    safeString(item.warranty) ? `Garantie: ${safeString(item.warranty)}` : "",
    safeString(item.compatibility) ? `Kompatibilität: ${safeString(item.compatibility)}` : "",
    safeString(item.notes) ? `Hinweise: ${safeString(item.notes)}` : "",
  ].filter(Boolean);

  for (const extra of extras) {
    const lines = wrapText(extra, PAGE_W - MARGIN_X * 2 - 40, font, 8.5);
    for (const line of lines) {
      drawText(page, line, MARGIN_X + 40, y, 8.5, font, COLOR_MUTED);
      y -= 10;
    }
  }

  y -= 4;
  drawLine(page, MARGIN_X, y, PAGE_W - MARGIN_X, y, 0.6, COLOR_LINE);
  y -= 12;

  return y;
}