import {
  PDFDocument,
  PDFPage,
  PDFFont,
  StandardFonts,
  rgb,
} from "pdf-lib";

type OfferCoverData = {
  title: string;
  planningNumber: string;
  kWp: number;
  customerName: string;
  companyName: string;

  // economic block
  netSystemPriceChf: number;
  vatRatePct: number;
  vatAmountChf: number;
  grossPriceChf: number;

  subsidyChf: number;
  additionalSubsidyChf?: number;

  totalInvestmentChf: number;
  taxSavingsChf?: number;
  effectiveCostChf?: number;

  validUntil?: string;

  // optional summary
  moduleCount?: number;
  batteryLabel?: string;
  wallboxLabel?: string;
};

function money(n?: number) {
  const value = Number(n ?? 0);
  return new Intl.NumberFormat("de-CH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function pct(n?: number) {
  const value = Number(n ?? 0);
  return new Intl.NumberFormat("de-CH", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

function fmtDate(dateLike?: string) {
  if (!dateLike) return "—";
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return dateLike;
  return new Intl.DateTimeFormat("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

function safeBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.APP_BASE_URL ||
    "https://planner.helionic.ch"
  ).replace(/\/$/, "");
}

async function fetchAsset(path: string) {
  const url = `${safeBaseUrl()}${path}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Asset not found: ${url}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function fitContain(
  srcW: number,
  srcH: number,
  boxW: number,
  boxH: number
): { width: number; height: number } {
  const scale = Math.min(boxW / srcW, boxH / srcH);
  return {
    width: srcW * scale,
    height: srcH * scale,
  };
}

function fitCover(
  srcW: number,
  srcH: number,
  boxW: number,
  boxH: number
): { width: number; height: number } {
  const scale = Math.max(boxW / srcW, boxH / srcH);
  return {
    width: srcW * scale,
    height: srcH * scale,
  };
}

function drawText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  size: number,
  font: PDFFont,
  color = rgb(0.14, 0.22, 0.27)
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
  color = rgb(0.78, 0.81, 0.83)
) {
  page.drawLine({
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    thickness,
    color,
  });
}

type Row = {
  left: string;
  middle?: string;
  right: string;
  bold?: boolean;
};

function drawPricingRows(args: {
  page: PDFPage;
  rows: Row[];
  x: number;
  y: number;
  width: number;
  lineHeight?: number;
  font: PDFFont;
  bold: PDFFont;
}) {
  const { page, rows, x, y, width, font, bold } = args;
  const lineHeight = args.lineHeight ?? 22;

  const col1 = x;
  const col2 = x + 120;
  const col3 = x + width;

  let cursorY = y;

  for (const row of rows) {
    const rowFont = row.bold ? bold : font;
    const rowColor = rgb(0.17, 0.29, 0.35);

    drawText(page, row.left, col1, cursorY, 11, rowFont, rowColor);

    if (row.middle) {
      drawText(page, row.middle, col2, cursorY, 11, rowFont, rowColor);
    }

    const rightWidth = rowFont.widthOfTextAtSize(row.right, 11);
    drawText(page, row.right, col3 - rightWidth, cursorY, 11, rowFont, rowColor);

    cursorY -= lineHeight;
  }

  return cursorY;
}

export async function addCoverPage(pdf: PDFDocument, data: OfferCoverData) {
  const page = pdf.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const textDark = rgb(0.17, 0.29, 0.35);
  const textMuted = rgb(0.34, 0.42, 0.46);
  const teal = rgb(0.12, 0.32, 0.37);
  const softGray = rgb(0.95, 0.95, 0.95);
  const lineGray = rgb(0.79, 0.81, 0.83);

  const companyName = data.companyName?.trim() || "Ihre Firma";

  /* ---------------- layout ---------------- */

  const pageMarginX = 44;
  const topWhiteSpace = 28;

  const heroX = 44;
  const heroY = 512;
  const heroW = width - 88;
  const heroH = 300;

  const titleBoxX = 58;
  const titleBoxW = width - 116;
  const titleBoxH = 128;
  const titleBoxY = heroY + 10;

  const logoBoxX = 52;
  const logoBoxY = heroY + heroH - 86;
  const logoBoxW = 158;
  const logoBoxH = 66;

  /* ---------------- page background ---------------- */

  page.drawRectangle({
    x: 0,
    y: 0,
    width,
    height,
    color: rgb(1, 1, 1),
  });

  /* ---------------- hero image (NO STRETCH) ---------------- */

  const heroBytes = await fetchAsset("/hero-pdf.jpg");
  const heroImage = await pdf.embedJpg(heroBytes);

  const heroDims = fitCover(heroImage.width, heroImage.height, heroW, heroH);

  page.drawImage(heroImage, {
    x: heroX + (heroW - heroDims.width) / 2,
    y: heroY + (heroH - heroDims.height) / 2,
    width: heroDims.width,
    height: heroDims.height,
  });

  /* top white strip */
  page.drawRectangle({
    x: 0,
    y: height - topWhiteSpace,
    width,
    height: topWhiteSpace,
    color: rgb(1, 1, 1),
  });

  /* ---------------- logo box ---------------- */

  page.drawRectangle({
    x: logoBoxX,
    y: logoBoxY,
    width: logoBoxW,
    height: logoBoxH,
    color: rgb(1, 1, 1),
  });

  const logoBytes = await fetchAsset("/logo-demo.jpg");
  const logoImage = await pdf.embedJpg(logoBytes);

  const logoPaddingX = 16;
  const logoPaddingY = 10;

  const logoDims = fitContain(
    logoImage.width,
    logoImage.height,
    logoBoxW - logoPaddingX * 2,
    logoBoxH - logoPaddingY * 2
  );

  page.drawImage(logoImage, {
    x: logoBoxX + (logoBoxW - logoDims.width) / 2,
    y: logoBoxY + (logoBoxH - logoDims.height) / 2,
    width: logoDims.width,
    height: logoDims.height,
  });

  /* ---------------- title box ---------------- */

  page.drawRectangle({
    x: titleBoxX,
    y: titleBoxY,
    width: titleBoxW,
    height: titleBoxH,
    color: softGray,
  });

  const title = data.title || "Photovoltaik-Anlage";
  const bigKwText = `${money(data.kWp)} kWp`;

  drawText(page, title, titleBoxX + 16, titleBoxY + 78, 19, font, textDark);
  drawText(page, bigKwText, titleBoxX + 16, titleBoxY + 40, 29, bold, textDark);

  drawLine(
    page,
    titleBoxX + 16,
    titleBoxY + 24,
    titleBoxX + titleBoxW - 16,
    titleBoxY + 24,
    3,
    teal
  );

  drawText(
    page,
    `Offerte Nr.  ${data.planningNumber || "—"}`,
    titleBoxX + 16,
    titleBoxY + 6,
    10,
    font,
    textMuted
  );

  /* ---------------- greeting ---------------- */

  let y = 430;

  drawText(page, `Herr ${data.customerName || "—"}`, pageMarginX, y, 15, font, textDark);
  y -= 26;

  const introLines = [
    "Vielen Dank für Ihr Interesse an einer Zusammenarbeit mit uns.",
    `Mit ${companyName} haben Sie einen verlässlichen Partner für innovative`,
    "Photovoltaik-Lösungen in der Schweiz an Ihrer Seite.",
  ];

  for (const line of introLines) {
    drawText(page, line, pageMarginX, y, 10.5, font, textDark);
    y -= 14;
  }

  /* ---------------- section title ---------------- */

  y -= 22;
  drawText(page, "Photovoltaik-Anlage", pageMarginX, y, 14, bold, textDark);
  y -= 20;

  /* ---------------- pricing block ---------------- */

  const grossPrice = Number(data.grossPriceChf || 0);
  const subsidy = Number(data.subsidyChf || 0);
  const additionalSubsidy = Number(data.additionalSubsidyChf || 0);
  const totalSubsidy = subsidy + additionalSubsidy;
  const taxSavings = Number(data.taxSavingsChf || 0);
  const effectiveCost =
    typeof data.effectiveCostChf === "number"
      ? Number(data.effectiveCostChf)
      : Math.max(0, Number(data.totalInvestmentChf || 0) - taxSavings);

  const summaryLabelParts = [
    data.kWp > 0 ? `${money(data.kWp)} kWp` : "",
    data.moduleCount ? `${data.moduleCount} Module` : "",
    data.batteryLabel ? data.batteryLabel : "",
    data.wallboxLabel ? data.wallboxLabel : "",
  ].filter(Boolean);

  const systemSummary = summaryLabelParts.join(" · ");

  const tableX = pageMarginX;
  const tableW = 390;

  const costRows: Row[] = [
    {
      left: "Kosten*",
      middle: systemSummary || "Solaranlage",
      right: `${money(data.netSystemPriceChf)} CHF`,
    },
    {
      left: "",
      middle: `MWST ${pct(data.vatRatePct)} %`,
      right: `${money(data.vatAmountChf)} CHF`,
    },
    {
      left: "",
      middle: "Kosten inkl. MWST",
      right: `${money(grossPrice)} CHF`,
      bold: true,
    },
  ];

  y = drawPricingRows({
    page,
    rows: costRows,
    x: tableX,
    y,
    width: tableW,
    font,
    bold,
  });

  drawLine(page, tableX, y + 8, tableX + tableW, y + 8, 1, lineGray);

  if (totalSubsidy > 0) {
    const subsidyRows: Row[] = [
      {
        left: "Förderungen**",
        middle: "Einmalvergütung (Photovoltaik)",
        right: `-${money(subsidy)} CHF`,
      },
      ...(additionalSubsidy > 0
        ? [
            {
              left: "",
              middle: "Weitere Fördergelder",
              right: `-${money(additionalSubsidy)} CHF`,
            } satisfies Row,
          ]
        : []),
    ];

    y -= 12;
    y = drawPricingRows({
      page,
      rows: subsidyRows,
      x: tableX,
      y,
      width: tableW,
      font,
      bold,
    });

    drawLine(page, tableX, y + 8, tableX + tableW, y + 8, 1, lineGray);
  }

  y -= 12;

  const investmentRows: Row[] = [
    {
      left: "Ihre Investition",
      middle: "Ihre Gesamtinvestition",
      right: `${money(data.totalInvestmentChf)} CHF`,
    },
    ...(taxSavings > 0
      ? [
          {
            left: "",
            middle: "Erwartete Steuerersparnis***",
            right: `${money(taxSavings)} CHF`,
          } satisfies Row,
        ]
      : []),
    {
      left: "",
      middle: "Effektive Kosten",
      right: `${money(effectiveCost)} CHF`,
      bold: true,
    },
  ];

  y = drawPricingRows({
    page,
    rows: investmentRows,
    x: tableX,
    y,
    width: tableW,
    font,
    bold,
  });

  drawLine(page, tableX, y + 8, tableX + tableW, y + 8, 1, lineGray);

  /* ---------------- notes ---------------- */

  y -= 18;
  drawText(
    page,
    "*   Kosten gelten bei Bestellung aller aufgeführten Systeme.",
    tableX,
    y,
    9,
    font,
    textDark
  );
  y -= 12;
  drawText(
    page,
    "**  Förderungen können nicht garantiert werden.",
    tableX,
    y,
    9,
    font,
    textDark
  );
  y -= 12;
  drawText(
    page,
    "*** Erwartete Steuerersparnis ist eine unverbindliche Schätzung.",
    tableX,
    y,
    9,
    font,
    textDark
  );

  /* ---------------- validity ---------------- */

  y -= 34;
  drawText(page, "Offerte gültig bis:", tableX, y, 10.5, font, textDark);
  drawText(page, fmtDate(data.validUntil), tableX + 118, y, 10.5, bold, textDark);
  drawLine(page, tableX, y - 8, tableX + 270, y - 8, 1, lineGray);

  /* ---------------- closing ---------------- */

  y -= 34;
  drawText(
    page,
    "Als Ihr persönlicher Ansprechpartner stehen wir Ihnen jederzeit gerne",
    tableX,
    y,
    10.5,
    font,
    textDark
  );
  y -= 14;
  drawText(
    page,
    "zur Verfügung. Wir freuen uns, von Ihnen zu hören!",
    tableX,
    y,
    10.5,
    font,
    textDark
  );

  y -= 46;
  drawText(page, "Mit freundlichen Grüssen", tableX, y, 11, font, textDark);

  y -= 38;
  drawText(page, companyName, tableX, y, 18, bold, textDark);
  y -= 18;
  drawText(page, "Ihr Partner für Photovoltaik-Lösungen", tableX, y, 10.5, font, textMuted);
}