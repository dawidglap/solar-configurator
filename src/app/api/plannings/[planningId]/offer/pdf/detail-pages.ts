import { PDFDocument, PDFPage, PDFFont, rgb, type RGB } from "pdf-lib";
import { sanitizePdfText } from "@/lib/pdfText";
import { roundChf05, sumChf05 } from "@/lib/chf";
import { htmlToPlainText } from "@/lib/htmlToPlainText";

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
  articleNumber?: string;
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
  optional?: boolean;
};

type AddDetailPagesArgs = {
  offer: {
    title?: string;
    planningNumber?: string;
    detailItems?: DetailItem[];
  };
  company?: CompanyLike | null;
  documentType?: "angebot" | "auftrag";
  documentTitle?: string;
  documentNumberLabel?: string;
  projectType?: "photovoltaic" | "heating";
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
const COLOR_OPTIONAL_BG = rgb(254 / 255, 246 / 255, 220 / 255);
const COLOR_OPTIONAL_BORDER = rgb(240 / 255, 198 / 255, 76 / 255);
const COLOR_OPTIONAL_NOTE = rgb(0.46, 0.38, 0.2);
const OPTIONAL_HEADER_HEIGHT = 26;
const OPTIONAL_SUMMARY_HEIGHT = 36;
const CONTENT_BOTTOM = MARGIN_BOTTOM + 70;

export const POSITION_COLUMN_WIDTHS = {
  pos: 40,
  qtyW: 55,
  priceW: 95,
  totalW: 100,
  numericGap: 12,
  gapAfterDesc: 8,
  cellInset: 6,
} as const;

export const POSITION_TABLE_BOUNDS = {
  left: MARGIN_X,
  right: PAGE_W - MARGIN_X,
  width: PAGE_W - MARGIN_X * 2,
} as const;

export const POSITION_COLUMN_LAYOUT = (() => {
  const totalRight = POSITION_TABLE_BOUNDS.right;
  const totalLeft = totalRight - POSITION_COLUMN_WIDTHS.totalW;
  const priceRight = totalLeft - POSITION_COLUMN_WIDTHS.numericGap;
  const priceLeft = priceRight - POSITION_COLUMN_WIDTHS.priceW;
  const qtyRight = priceLeft - POSITION_COLUMN_WIDTHS.numericGap;
  const qtyLeft = qtyRight - POSITION_COLUMN_WIDTHS.qtyW;
  const descRight = qtyLeft - POSITION_COLUMN_WIDTHS.gapAfterDesc;
  const descX = POSITION_TABLE_BOUNDS.left + POSITION_COLUMN_WIDTHS.pos;

  return Object.freeze({
    posX: POSITION_TABLE_BOUNDS.left + POSITION_COLUMN_WIDTHS.cellInset,
    descX,
    descWidth: Math.max(140, descRight - descX),
    qtyLeft,
    qtyRight,
    priceLeft,
    priceRight,
    totalLeft,
    totalRight,
  });
})();

export const HEATING_POSITION_COLUMN_WIDTHS = {
  pos: 28,
  qtyW: 48,
  priceW: 75,
  totalW: 80,
  numericGap: 7,
  gapAfterDesc: 6,
  cellInset: 4,
} as const;

export const HEATING_POSITION_COLUMN_LAYOUT = (() => {
  const totalRight = POSITION_TABLE_BOUNDS.right;
  const totalLeft = totalRight - HEATING_POSITION_COLUMN_WIDTHS.totalW;
  const priceRight = totalLeft - HEATING_POSITION_COLUMN_WIDTHS.numericGap;
  const priceLeft = priceRight - HEATING_POSITION_COLUMN_WIDTHS.priceW;
  const qtyRight = priceLeft - HEATING_POSITION_COLUMN_WIDTHS.numericGap;
  const qtyLeft = qtyRight - HEATING_POSITION_COLUMN_WIDTHS.qtyW;
  const descRight = qtyLeft - HEATING_POSITION_COLUMN_WIDTHS.gapAfterDesc;
  const descX = POSITION_TABLE_BOUNDS.left + HEATING_POSITION_COLUMN_WIDTHS.pos;

  return Object.freeze({
    posX: POSITION_TABLE_BOUNDS.left + HEATING_POSITION_COLUMN_WIDTHS.cellInset,
    descX,
    descWidth: Math.max(140, descRight - descX),
    qtyLeft,
    qtyRight,
    priceLeft,
    priceRight,
    totalLeft,
    totalRight,
  });
})();

const HEATING_DETAIL_TYPOGRAPHY = Object.freeze({
  positionSize: 8,
  quantitySize: 8,
  priceSize: 8,
  totalSize: 8.2,
  titleSize: 9,
  titleLineHeight: 10.2,
  articleSize: 7.4,
  articleLineHeight: 9,
  sublineSize: 7.5,
  sublineLineHeight: 8.8,
  descriptionSize: 7.8,
  descriptionLineHeight: 9.3,
  featureSize: 7.7,
  featureLineHeight: 9.2,
  extraSize: 7.6,
  extraLineHeight: 9.1,
  paragraphSpacing: 3,
  headerSize: 7.3,
  continuationSize: 7.8,
  continuationLineHeight: 13,
});

export function rightAlignedTextX(rightEdge: number, textWidth: number) {
  return rightEdge - textWidth;
}

function safeString(v: unknown) {
  return sanitizePdfText(v);
}

function safeNumber(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function safeStringArray(v: unknown) {
  return Array.isArray(v)
    ? v.map(htmlToPlainText).filter(Boolean)
    : [];
}

function plainText(value: unknown) {
  return safeString(htmlToPlainText(value));
}

function money(n?: number) {
  return new Intl.NumberFormat("de-CH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(roundChf05(safeNumber(n, 0)));
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
  page.drawText(safeString(text), { x, y, size, font, color });
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

function splitLongToken(token: string, maxWidth: number, font: PDFFont, size: number) {
  if (!token) return [];

  const chunks: string[] = [];
  let current = "";

  for (const char of token) {
    const trial = current + char;
    if (font.widthOfTextAtSize(trial, size) <= maxWidth) {
      current = trial;
      continue;
    }

    if (current) {
      chunks.push(current);
    }
    current = char;
  }

  if (current) chunks.push(current);
  return chunks;
}

function wrapTextStrict(text: string, maxWidth: number, font: PDFFont, size: number) {
  const clean = safeString(text).replace(/\s+/g, " ").trim();
  if (!clean) return [];

  const preparedWords = clean.split(" ").flatMap((word) => {
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      return [word];
    }
    return splitLongToken(word, maxWidth, font, size);
  });

  const lines: string[] = [];
  let current = "";

  for (const word of preparedWords) {
    const trial = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(trial, size) <= maxWidth) {
      current = trial;
      continue;
    }

    if (current) {
      lines.push(current);
    }
    current = word;
  }

  if (current) lines.push(current);
  return lines;
}

function fitHeaderTitle(text: string, maxWidth: number, font: PDFFont) {
  const clean = safeString(text) || "Photovoltaik-Angebot";
  const candidates = [15, 14, 13, 12];

  for (const size of candidates) {
    const lines = wrapText(clean, maxWidth, font, size);
    if (lines.length <= 3) {
      return { size, lines };
    }
  }

  const size = 12;
  const lines = wrapText(clean, maxWidth, font, size);
  if (lines.length <= 3) {
    return { size, lines };
  }

  const clipped = [...lines.slice(0, 3)];
  const last = clipped[2] || "";
  clipped[2] = last.length > 2 ? `${last.slice(0, Math.max(1, last.length - 2))}…` : "…";
  return { size, lines: clipped };
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
  const bodyWidth = POSITION_TABLE_BOUNDS.width;
  const { descWidth } = POSITION_COLUMN_LAYOUT;

  const titleLines = wrapTextStrict(buildItemTitle(item), descWidth, bold, 9.6);
  let h = Math.max(1, titleLines.length) * 11;
  if (
    item.optional === true &&
    titleLines[0] &&
    bold.widthOfTextAtSize(titleLines[0], 9.6) + 6 + 34 > descWidth
  ) {
    h += 12;
  }
  const subline = buildItemSubline(item);
  h += subline ? wrapTextStrict(subline, descWidth, font, 8.2).length * 10 : 2;

  const description = plainText(item.description);
  const longDescription = plainText(item.longDescription);

  if (description) {
    h += wrapTextStrict(description, descWidth, font, 9.5).length * 11;
    h += 4;
  }

  if (longDescription) {
    h += wrapTextStrict(longDescription, descWidth, font, 9.2).length * 11;
    h += 4;
  }

  const features = safeStringArray(item.features);
  if (features.length) {
    for (const feature of features) {
      const lines = wrapTextStrict(feature, descWidth - 16, font, 8.8);
      h += Math.max(1, lines.length) * 10;
    }
    h += 4;
  }

  const extras = [
    plainText(item.warranty) ? `Garantie: ${plainText(item.warranty)}` : "",
    plainText(item.compatibility) ? `Kompatibilität: ${plainText(item.compatibility)}` : "",
    plainText(item.notes) ? `Hinweise: ${plainText(item.notes)}` : "",
  ].filter(Boolean);

  for (const extra of extras) {
    h += wrapTextStrict(extra, bodyWidth, font, 8.5).length * 10;
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
  const includedItems = items
    .filter((item) => item.optional !== true)
    .map((item, index) => ({ ...item, position: index + 1 }));
  const optionalItems = items
    .filter((item) => item.optional === true)
    .map((item, index) => ({ ...item, position: index + 1 }));

  const font = await pdf.embedFont("Helvetica");
  const bold = await pdf.embedFont("Helvetica-Bold");

  const footerLines = buildFooterLines(args.company);

  if (args.projectType === "heating" && args.documentType === "angebot") {
    await addBoundedHeatingDetailPages(pdf, {
      ...args,
      includedItems,
      optionalItems,
      font,
      bold,
      footerLines,
    });
    return;
  }

  let pageNumber = pdf.getPageCount() + 1;
  let page = createPage(pdf, {
    pageNumber,
    offerTitle: safeString(args.offer?.title) || "Photovoltaik-Angebot",
    planningNumber: safeString(args.offer?.planningNumber),
    company: args.company,
    font,
    bold,
    footerLines,
    documentTitle: args.documentTitle,
    documentNumberLabel: args.documentNumberLabel,
  });

  let y = page.cursorY;
  let currentSection = "";

  for (const item of includedItems) {
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
        documentTitle: args.documentTitle,
        documentNumberLabel: args.documentNumberLabel,
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

  if (!optionalItems.length) return;

  const createNextPage = () => {
    pageNumber += 1;
    page = createPage(pdf, {
      pageNumber,
      offerTitle: safeString(args.offer?.title) || "Photovoltaik-Angebot",
      planningNumber: safeString(args.offer?.planningNumber),
      company: args.company,
      font,
      bold,
      footerLines,
      documentTitle: args.documentTitle,
      documentNumberLabel: args.documentNumberLabel,
    });
    y = page.cursorY;
  };

  const optionalTotal = sumChf05(
    optionalItems.map((item) => safeNumber(item.lineTotalNet, 0)),
  );
  let remainingItems = [...optionalItems];
  let summaryPending = true;

  while (remainingItems.length || summaryPending) {
    const nextItemHeight = remainingItems.length
      ? estimateItemHeight(remainingItems[0], font, bold)
      : OPTIONAL_SUMMARY_HEIGHT;
    if (y - OPTIONAL_HEADER_HEIGHT - nextItemHeight < CONTENT_BOTTOM) {
      createNextPage();
    }

    const topY = y;
    const availableHeight = topY - CONTENT_BOTTOM;
    const chunk: DetailItem[] = [];
    let segmentHeight = OPTIONAL_HEADER_HEIGHT;

    for (const item of remainingItems) {
      const itemHeight = estimateItemHeight(item, font, bold);
      if (chunk.length > 0 && segmentHeight + itemHeight > availableHeight) {
        break;
      }
      chunk.push(item);
      segmentHeight += itemHeight;
      if (segmentHeight >= availableHeight) break;
    }

    const consumesAllItems = chunk.length === remainingItems.length;
    if (
      consumesAllItems &&
      summaryPending &&
      segmentHeight + OPTIONAL_SUMMARY_HEIGHT > availableHeight &&
      chunk.length > 1
    ) {
      const movedItem = chunk.pop();
      if (movedItem) {
        segmentHeight -= estimateItemHeight(movedItem, font, bold);
      }
    }

    const itemsAfterChunk = remainingItems.length - chunk.length;
    const includeSummary =
      summaryPending &&
      itemsAfterChunk === 0 &&
      segmentHeight + OPTIONAL_SUMMARY_HEIGHT <= availableHeight;
    if (includeSummary) segmentHeight += OPTIONAL_SUMMARY_HEIGHT;

    page.page.drawRectangle({
      x: POSITION_TABLE_BOUNDS.left,
      y: topY - segmentHeight,
      width: POSITION_TABLE_BOUNDS.width,
      height: segmentHeight + 6,
      color: COLOR_OPTIONAL_BG,
      borderColor: COLOR_OPTIONAL_BORDER,
      borderWidth: 1,
    });

    let contentY = drawOptionalSectionHeader(page.page, { y: topY, bold });
    for (const item of chunk) {
      contentY = drawDetailItem(page.page, {
        y: contentY,
        item,
        font,
        bold,
        optionalStyle: true,
      });
    }
    remainingItems = remainingItems.slice(chunk.length);

    if (includeSummary) {
      contentY = drawOptionalSummary(page.page, {
        y: contentY,
        total: optionalTotal,
        font,
        bold,
      });
      summaryPending = false;
    }

    y = Math.min(contentY, topY - segmentHeight) - 10;
    if (remainingItems.length || summaryPending) {
      createNextPage();
    }
  }
}

type BoundedLine = {
  text: string;
  x: number;
  size: number;
  font: PDFFont;
  color: RGB;
  lineHeight: number;
  bullet?: boolean;
};

function buildBoundedItemLines(item: DetailItem, font: PDFFont, bold: PDFFont) {
  const tableCol = HEATING_POSITION_COLUMN_LAYOUT;
  const type = HEATING_DETAIL_TYPOGRAPHY;
  const lines: BoundedLine[] = [];
  const pushWrapped = (args: {
    text: string;
    x?: number;
    width?: number;
    size: number;
    lineHeight: number;
    font?: PDFFont;
    color?: RGB;
    bullet?: boolean;
    preserveParagraphs?: boolean;
  }) => {
    const lineFont = args.font ?? font;
    const x = args.x ?? tableCol.descX;
    const width = args.width ?? tableCol.descWidth;
    const paragraphs = args.preserveParagraphs
      ? safeString(args.text).split(/\r?\n+/).map((text) => text.trim()).filter(Boolean)
      : [args.text];
    paragraphs.forEach((paragraph, paragraphIndex) => {
      const wrapped = wrapTextStrict(paragraph, width, lineFont, args.size);
      wrapped.forEach((text, index) => {
        const isLastLine = index === wrapped.length - 1;
        lines.push({
          text,
          x,
          size: args.size,
          font: lineFont,
          color: args.color ?? COLOR_TEXT,
          lineHeight:
            args.lineHeight +
            (args.preserveParagraphs && isLastLine && paragraphIndex < paragraphs.length - 1
              ? type.paragraphSpacing
              : 0),
          bullet: args.bullet === true && index === 0,
        });
      });
    });
  };

  pushWrapped({
    text: buildItemTitle(item),
    size: type.titleSize,
    lineHeight: type.titleLineHeight,
    font: bold,
  });

  const articleNumber = safeString(item.articleNumber);
  if (articleNumber) {
    pushWrapped({
      text: `Artikelnr.: ${articleNumber}`,
      size: type.articleSize,
      lineHeight: type.articleLineHeight,
      color: COLOR_MUTED,
    });
  }

  const subline = buildItemSubline(item);
  if (subline) {
    pushWrapped({
      text: subline,
      size: type.sublineSize,
      lineHeight: type.sublineLineHeight,
      color: COLOR_MUTED,
    });
  }

  const description = plainText(item.description);
  if (description) {
    pushWrapped({
      text: description,
      size: type.descriptionSize,
      lineHeight: type.descriptionLineHeight,
      preserveParagraphs: true,
    });
  }

  const longDescription = plainText(item.longDescription);
  if (longDescription) {
    pushWrapped({
      text: longDescription,
      size: type.descriptionSize,
      lineHeight: type.descriptionLineHeight,
      color: COLOR_MUTED,
      preserveParagraphs: true,
    });
  }

  for (const feature of safeStringArray(item.features)) {
    pushWrapped({
      text: feature,
      x: tableCol.descX + 16,
      width: tableCol.descWidth - 16,
      size: type.featureSize,
      lineHeight: type.featureLineHeight,
      bullet: true,
    });
  }

  const extras = [
    plainText(item.warranty) ? `Garantie: ${plainText(item.warranty)}` : "",
    plainText(item.compatibility) ? `Kompatibilität: ${plainText(item.compatibility)}` : "",
    plainText(item.notes) ? `Hinweise: ${plainText(item.notes)}` : "",
  ].filter(Boolean);
  for (const extra of extras) {
    pushWrapped({
      text: extra,
      size: type.extraSize,
      lineHeight: type.extraLineHeight,
      color: COLOR_MUTED,
    });
  }

  return lines;
}

async function addBoundedHeatingDetailPages(
  pdf: PDFDocument,
  args: AddDetailPagesArgs & {
    includedItems: DetailItem[];
    optionalItems: DetailItem[];
    font: PDFFont;
    bold: PDFFont;
    footerLines: string[];
  },
) {
  const { font, bold, footerLines } = args;
  let pageNumber = pdf.getPageCount() + 1;
  let page = createPage(pdf, {
    pageNumber,
    offerTitle: safeString(args.offer?.title) || "Heizungsangebot",
    planningNumber: safeString(args.offer?.planningNumber),
    company: args.company,
    font,
    bold,
    footerLines,
    documentTitle: args.documentTitle,
    documentNumberLabel: args.documentNumberLabel,
    compactHeatingLayout: true,
  });
  let y = page.cursorY;

  const nextPage = () => {
    pageNumber += 1;
    page = createPage(pdf, {
      pageNumber,
      offerTitle: safeString(args.offer?.title) || "Heizungsangebot",
      planningNumber: safeString(args.offer?.planningNumber),
      company: args.company,
      font,
      bold,
      footerLines,
      documentTitle: args.documentTitle,
      documentNumberLabel: args.documentNumberLabel,
      compactHeatingLayout: true,
    });
    y = page.cursorY;
  };

  const ensureSpace = (height: number) => {
    if (y - height < CONTENT_BOTTOM) nextPage();
  };

  const drawItem = (item: DetailItem, optionalStyle = false) => {
    const lines = buildBoundedItemLines(item, font, bold);
    const dividerHeight = 16;
    const itemHeight = lines.reduce((sum, line) => sum + line.lineHeight, 0) + dividerHeight;
    const fullPageCapacity = page.cursorY - CONTENT_BOTTOM;

    if (itemHeight <= fullPageCapacity && y - itemHeight < CONTENT_BOTTOM) {
      nextPage();
    } else if (y - Math.min(itemHeight, 38) < CONTENT_BOTTOM) {
      nextPage();
    }

    const tableCol = HEATING_POSITION_COLUMN_LAYOUT;
    const type = HEATING_DETAIL_TYPOGRAPHY;
    const rowTopY = y;
    const qty = safeNumber(item.quantity, 0);
    const unitLabel = safeString(item.unitLabel) || safeString(item.unit) || "Stk.";
    const qtyText = qty > 0 ? `${qty} ${unitLabel}` : "-";
    const unitPriceText = money(item.unitPriceNet);
    const lineTotalText = money(item.lineTotalNet);

    drawText(
      page.page,
      String(item.position || "-"),
      tableCol.posX,
      rowTopY,
      type.positionSize,
      font,
      COLOR_TEXT,
    );
    drawText(
      page.page,
      qtyText,
      rightAlignedTextX(tableCol.qtyRight, font.widthOfTextAtSize(qtyText, type.quantitySize)),
      rowTopY,
      type.quantitySize,
      font,
      COLOR_TEXT,
    );
    drawText(
      page.page,
      unitPriceText,
      rightAlignedTextX(tableCol.priceRight, font.widthOfTextAtSize(unitPriceText, type.priceSize)),
      rowTopY,
      type.priceSize,
      font,
      COLOR_TEXT,
    );
    drawText(
      page.page,
      lineTotalText,
      rightAlignedTextX(tableCol.totalRight, bold.widthOfTextAtSize(lineTotalText, type.totalSize)),
      rowTopY,
      type.totalSize,
      bold,
      COLOR_TEXT,
    );

    if (optionalStyle) {
      const badgeX = tableCol.posX;
      page.page.drawRectangle({
        x: badgeX,
        y: rowTopY - 15,
        width: 34,
        height: 12,
        color: COLOR_OPTIONAL_BORDER,
      });
      drawText(page.page, "Optional", badgeX + 4, rowTopY - 12, 6.3, bold, COLOR_TEXT);
    }

    let continuation = false;
    for (const line of lines) {
      if (y - line.lineHeight < CONTENT_BOTTOM) {
        nextPage();
        continuation = true;
        drawText(
          page.page,
          String(item.position || "-"),
          tableCol.posX,
          y,
          type.positionSize,
          font,
          COLOR_TEXT,
        );
        drawText(
          page.page,
          `Position ${item.position || "-"} - Fortsetzung`,
          tableCol.descX,
          y,
          type.continuationSize,
          bold,
          COLOR_MUTED,
        );
        y -= type.continuationLineHeight;
      }

      if (line.bullet) {
        drawText(page.page, "•", tableCol.descX + 4, y, type.featureSize, bold, COLOR_TEXT);
      }
      drawText(page.page, line.text, line.x, y, line.size, line.font, line.color);
      y -= line.lineHeight;
    }

    if (continuation && y - dividerHeight < CONTENT_BOTTOM) {
      y = CONTENT_BOTTOM;
      return;
    }
    y -= 4;
    if (y >= CONTENT_BOTTOM) {
      drawLine(
        page.page,
        POSITION_TABLE_BOUNDS.left,
        y,
        POSITION_TABLE_BOUNDS.right,
        y,
        0.6,
        optionalStyle ? COLOR_OPTIONAL_BORDER : COLOR_LINE,
      );
    }
    y -= 12;
  };

  if (args.includedItems.length) {
    ensureSpace(estimateSectionHeaderHeight() + 38);
    y = drawSectionHeader(page.page, {
      y,
      label: "Positionen",
      font,
      bold,
      columnLayout: HEATING_POSITION_COLUMN_LAYOUT,
      compact: true,
    });
    for (const item of args.includedItems) drawItem(item);
  }

  if (!args.optionalItems.length) return;

  ensureSpace(OPTIONAL_HEADER_HEIGHT + 38);
  y = drawOptionalSectionHeader(page.page, {
    y,
    bold,
    columnLayout: HEATING_POSITION_COLUMN_LAYOUT,
  });
  for (const item of args.optionalItems) drawItem(item, true);

  ensureSpace(OPTIONAL_SUMMARY_HEIGHT);
  const optionalTotal = sumChf05(
    args.optionalItems.map((item) => safeNumber(item.lineTotalNet, 0)),
  );
  y = drawOptionalSummary(page.page, {
    y,
    total: optionalTotal,
    font,
    bold,
    columnLayout: HEATING_POSITION_COLUMN_LAYOUT,
    compactCurrency: true,
  });
}

function drawOptionalSectionHeader(
  page: PDFPage,
  args: {
    y: number;
    bold: PDFFont;
    columnLayout?: typeof POSITION_COLUMN_LAYOUT;
  },
) {
  const columnLayout = args.columnLayout ?? POSITION_COLUMN_LAYOUT;
  drawText(
    page,
    "Optionale Positionen",
    columnLayout.posX,
    args.y - 6,
    9.2,
    args.bold,
    COLOR_TEXT,
  );
  drawLine(
    page,
    POSITION_TABLE_BOUNDS.left,
    args.y - 15,
    POSITION_TABLE_BOUNDS.right,
    args.y - 15,
    0.8,
    COLOR_OPTIONAL_BORDER,
  );
  return args.y - OPTIONAL_HEADER_HEIGHT;
}

function drawOptionalSummary(
  page: PDFPage,
  args: {
    y: number;
    total: number;
    font: PDFFont;
    bold: PDFFont;
    columnLayout?: typeof POSITION_COLUMN_LAYOUT;
    compactCurrency?: boolean;
  },
) {
  const tableCol = args.columnLayout ?? POSITION_COLUMN_LAYOUT;
  let y = args.y + 1;
  drawText(page, "Total optionale Positionen", tableCol.descX, y, 9.2, args.bold, COLOR_TEXT);
  const totalText = args.compactCurrency ? money(args.total) : `${money(args.total)} CHF`;
  drawText(
    page,
    totalText,
    rightAlignedTextX(
      tableCol.totalRight,
      args.bold.widthOfTextAtSize(totalText, 9.2),
    ),
    y,
    9.2,
    args.bold,
    COLOR_TEXT,
  );
  y -= 18;
  const noteLines = wrapTextStrict(
    "Diese Positionen sind nicht im Total enthalten und können auf Wunsch ergänzt werden.",
    tableCol.totalRight - tableCol.descX,
    args.font,
    8.2,
  );
  for (const line of noteLines) {
    drawText(page, line, tableCol.descX, y, 8.2, args.font, COLOR_OPTIONAL_NOTE);
    y -= 10;
  }
  return y - 5;
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
    documentTitle?: string;
    documentNumberLabel?: string;
    compactHeatingLayout?: boolean;
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
  const headerRight = [
    safeString(args.documentNumberLabel) ||
      (args.planningNumber ? `Angebot Nr. ${args.planningNumber}` : ""),
    `Seite ${args.pageNumber}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const headerRightW = args.font.widthOfTextAtSize(headerRight, 9.2);
  const headerGap = 18;
  const headerMaxWidth = Math.max(180, PAGE_W - MARGIN_X * 2 - headerRightW - headerGap);
  const titleWrap = fitHeaderTitle(args.offerTitle, headerMaxWidth, args.bold);
  const titleLineHeight = titleWrap.size + 2;
  let titleY = PAGE_H - 36;
  for (const line of titleWrap.lines) {
    drawText(page, line, MARGIN_X, titleY, titleWrap.size, args.bold, COLOR_TEXT);
    titleY -= titleLineHeight;
  }

  drawText(page, headerRight, PAGE_W - MARGIN_X - headerRightW, PAGE_H - 33, 9.2, args.font, COLOR_MUTED);

  const headerLineY = titleY - 7;

  drawLine(page, MARGIN_X, headerLineY, PAGE_W - MARGIN_X, headerLineY, 1.4, COLOR_ACCENT);

  // Table head
  const headY = headerLineY - 22;
  const tableCol = args.compactHeatingLayout
    ? HEATING_POSITION_COLUMN_LAYOUT
    : POSITION_COLUMN_LAYOUT;
  const tableHeaderSize = args.compactHeatingLayout
    ? HEATING_DETAIL_TYPOGRAPHY.headerSize
    : 9;
  page.drawRectangle({
    x: POSITION_TABLE_BOUNDS.left,
    y: headY - 14,
    width: POSITION_TABLE_BOUNDS.width,
    height: 22,
    color: COLOR_SOFT,
  });

  drawText(page, "Pos.", tableCol.posX, headY - 6, tableHeaderSize, args.bold, COLOR_TEXT);
  drawText(page, "Beschreibung", tableCol.descX, headY - 6, tableHeaderSize, args.bold, COLOR_TEXT);
  for (const [label, rightEdge] of [
    ["Menge", tableCol.qtyRight],
    [args.compactHeatingLayout ? "Preis CHF" : "Preis", tableCol.priceRight],
    [args.compactHeatingLayout ? "Total CHF" : "Total", tableCol.totalRight],
  ] as const) {
    drawText(
      page,
      label,
      rightAlignedTextX(rightEdge, args.bold.widthOfTextAtSize(label, tableHeaderSize)),
      headY - 6,
      tableHeaderSize,
      args.bold,
      COLOR_TEXT,
    );
  }

  drawLine(
    page,
    POSITION_TABLE_BOUNDS.left,
    headY - 16,
    POSITION_TABLE_BOUNDS.right,
    headY - 16,
    0.8,
    COLOR_LINE,
  );

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
    cursorY: headY - 34,
  };
}

function drawSectionHeader(
  page: PDFPage,
  args: {
    y: number;
    label: string;
    font: PDFFont;
    bold: PDFFont;
    columnLayout?: typeof POSITION_COLUMN_LAYOUT;
    compact?: boolean;
  }
) {
  const { y, label, bold } = args;
  const columnLayout = args.columnLayout ?? POSITION_COLUMN_LAYOUT;

  page.drawRectangle({
    x: POSITION_TABLE_BOUNDS.left,
    y: y - 12,
    width: POSITION_TABLE_BOUNDS.width,
    height: 18,
    color: rgb(0.97, 0.97, 0.97),
  });

  drawText(
    page,
    label,
    columnLayout.posX,
    y - 6,
    args.compact ? 8.2 : 9.2,
    bold,
    COLOR_TEXT,
  );
  return y - (args.compact ? 23 : 26);
}

function drawDetailItem(
  page: PDFPage,
  args: {
    y: number;
    item: DetailItem;
    font: PDFFont;
    bold: PDFFont;
    optionalStyle?: boolean;
  }
) {
  const { item, font, bold } = args;
  let y = args.y;
  const tableCol = POSITION_COLUMN_LAYOUT;

  const title = buildItemTitle(item);
  const subline = buildItemSubline(item);
  const qty = safeNumber(item.quantity, 0);
  const unitLabel = safeString(item.unitLabel) || safeString(item.unit) || "Stk.";
  const qtyText = qty > 0 ? `${qty} ${unitLabel}` : "—";
  const unitPriceText = `${money(item.unitPriceNet)} CHF`;
  const lineTotalText = `${money(item.lineTotalNet)} CHF`;

  drawText(page, String(item.position || "—"), tableCol.posX, y, 9.2, font, COLOR_TEXT);

  const titleLines = wrapTextStrict(title, tableCol.descWidth, bold, 9.6);
  let badgeDeferred = false;
  for (let index = 0; index < titleLines.length; index += 1) {
    const line = titleLines[index];
    drawText(page, line, tableCol.descX, y, 9.6, bold, COLOR_TEXT);
    if (args.optionalStyle && index === 0) {
      const badgeWidth = 34;
      const badgeX = tableCol.descX + bold.widthOfTextAtSize(line, 9.6) + 6;
      if (badgeX + badgeWidth <= tableCol.descX + tableCol.descWidth) {
        page.drawRectangle({
          x: badgeX,
          y: y - 3,
          width: badgeWidth,
          height: 12,
          color: COLOR_OPTIONAL_BORDER,
        });
        drawText(page, "Optional", badgeX + 4, y, 6.3, bold, COLOR_TEXT);
      } else {
        badgeDeferred = true;
      }
    }
    y -= 11;
  }
  if (args.optionalStyle && badgeDeferred) {
    page.drawRectangle({
      x: tableCol.descX,
      y: y - 3,
      width: 34,
      height: 12,
      color: COLOR_OPTIONAL_BORDER,
    });
    drawText(page, "Optional", tableCol.descX + 4, y, 6.3, bold, COLOR_TEXT);
    y -= 12;
  }

  const qtyW = font.widthOfTextAtSize(qtyText, 9);
  const rowTopY = args.y;
  drawText(
    page,
    qtyText,
    rightAlignedTextX(tableCol.qtyRight, qtyW),
    rowTopY,
    9,
    font,
    COLOR_TEXT,
  );

  const unitPriceW = font.widthOfTextAtSize(unitPriceText, 9);
  drawText(
    page,
    unitPriceText,
    rightAlignedTextX(tableCol.priceRight, unitPriceW),
    rowTopY,
    9,
    font,
    COLOR_TEXT,
  );

  const lineTotalW = bold.widthOfTextAtSize(lineTotalText, 9.2);
  drawText(
    page,
    lineTotalText,
    rightAlignedTextX(tableCol.totalRight, lineTotalW),
    rowTopY,
    9.2,
    bold,
    COLOR_TEXT,
  );

  if (subline) {
    const sublineLines = wrapTextStrict(subline, tableCol.descWidth, font, 8.2);
    for (const line of sublineLines) {
      drawText(page, line, tableCol.descX, y, 8.2, font, COLOR_MUTED);
      y -= 10;
    }
  } else {
    y -= 2;
  }

  const description = plainText(item.description);
  if (description) {
    const lines = wrapTextStrict(description, tableCol.descWidth, font, 9.5);
    for (const line of lines) {
      drawText(page, line, tableCol.descX, y, 9.5, font, COLOR_TEXT);
      y -= 11;
    }
    y -= 2;
  }

  const longDescription = plainText(item.longDescription);
  if (longDescription) {
    const lines = wrapTextStrict(longDescription, tableCol.descWidth, font, 9.2);
    for (const line of lines) {
      drawText(page, line, tableCol.descX, y, 9.2, font, COLOR_TEXT);
      y -= 11;
    }
    y -= 2;
  }

  const features = safeStringArray(item.features);
  if (features.length) {
    for (const feature of features) {
      const lines = wrapTextStrict(feature, tableCol.descWidth - 16, font, 8.8);
      if (!lines.length) continue;

      drawText(page, "•", tableCol.descX + 4, y, 9, bold, COLOR_TEXT);
      drawText(page, lines[0], tableCol.descX + 16, y, 8.8, font, COLOR_TEXT);
      y -= 10;

      for (let i = 1; i < lines.length; i++) {
        drawText(page, lines[i], tableCol.descX + 16, y, 8.8, font, COLOR_TEXT);
        y -= 10;
      }
    }
    y -= 2;
  }

  const extras = [
    plainText(item.warranty) ? `Garantie: ${plainText(item.warranty)}` : "",
    plainText(item.compatibility) ? `Kompatibilität: ${plainText(item.compatibility)}` : "",
    plainText(item.notes) ? `Hinweise: ${plainText(item.notes)}` : "",
  ].filter(Boolean);

  for (const extra of extras) {
    const lines = wrapTextStrict(extra, PAGE_W - MARGIN_X * 2 - 40, font, 8.5);
    for (const line of lines) {
      drawText(page, line, tableCol.descX, y, 8.5, font, COLOR_MUTED);
      y -= 10;
    }
  }

  y -= 4;
  drawLine(
    page,
    POSITION_TABLE_BOUNDS.left,
    y,
    POSITION_TABLE_BOUNDS.right,
    y,
    0.6,
    COLOR_LINE,
  );
  y -= 12;

  return y;
}
