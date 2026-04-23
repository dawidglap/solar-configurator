import { promises as fs } from "fs";
import path from "path";
import { PDFDocument, PDFPage, PDFFont, rgb } from "pdf-lib";

type OfferCoverData = {
  title: string;
  planningNumber: string;
  kWp: number;
  customerName: string;
  companyName: string;

  netSystemPriceChf: number;
  vatRatePct: number;
  vatAmountChf: number;
  grossPriceChf: number;

  automaticPvSubsidyChf: number;
  manualAdditionalSubsidyChf?: number;
  subsidyChf: number;

  totalInvestmentChf: number;
  taxSavingsChf?: number;
  effectiveCostChf?: number;

  validUntil?: string;
  offerDate?: string;

  moduleCount?: number;
  batteryLabel?: string;
  wallboxLabel?: string;
  batteryPriceChf?: number;
  wallboxPriceChf?: number;

  discountChf?: number;
  discountPct?: number;
  discountFromPctChf?: number;
  totalDiscountChf?: number;

  advisorName?: string;
  advisorRole?: string;
};

type Row = {
  left: string;
  middle?: string;
  right: string;
  bold?: boolean;
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

async function readPublicAsset(filename: string) {
  const filePath = path.join(process.cwd(), "public", filename);
  return fs.readFile(filePath);
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

function truncate(text: string, max = 52) {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function drawPricingRows(args: {
  page: PDFPage;
  rows: Row[];
  x: number;
  y: number;
  width: number;
  lineHeight?: number;
  font: PDFFont;
  bold: PDFFont;
  size?: number;
}) {
  const { page, rows, x, y, width, font, bold } = args;
  const lineHeight = args.lineHeight ?? 19;
  const size = args.size ?? 10;

  const col1 = x;
  const col2 = x + 118;
  const col3 = x + width;

  let cursorY = y;

  for (const row of rows) {
    const rowFont = row.bold ? bold : font;
    const rowColor = rgb(0.17, 0.29, 0.35);

    if (row.left) {
      drawText(page, row.left, col1, cursorY, size, rowFont, rowColor);
    }

    if (row.middle) {
      drawText(page, truncate(row.middle, 52), col2, cursorY, size, rowFont, rowColor);
    }

    const rightText = row.right || "";
    const rightWidth = rowFont.widthOfTextAtSize(rightText, size);
    drawText(page, rightText, col3 - rightWidth, cursorY, size, rowFont, rowColor);

    cursorY -= lineHeight;
  }

  return cursorY;
}

export async function addCoverPage(pdf: PDFDocument, data: OfferCoverData) {
  const page = pdf.addPage([595.28, 841.89]);
  const { width } = page.getSize();

  const font = await pdf.embedFont("Helvetica");
  const bold = await pdf.embedFont("Helvetica-Bold");

  const textDark = rgb(0.17, 0.29, 0.35);
  const textMuted = rgb(0.34, 0.42, 0.46);
  const teal = rgb(0.12, 0.32, 0.37);
  const softGray = rgb(0.95, 0.95, 0.95);
  const lineGray = rgb(0.79, 0.81, 0.83);

  const pageMarginX = 44;

  const heroX = 44;
  const heroY = 598;
  const heroW = width - 88;
  const heroH = 190;

  const logoBoxX = 56;
  const logoBoxY = heroY + heroH - 60;
  const logoBoxW = 128;
  const logoBoxH = 44;

  const titleBoxX = 26;
  const titleBoxW = width - 52;
  const titleBoxH = 116;
  const titleBoxY = heroY - 24;

  page.drawRectangle({
    x: 0,
    y: 0,
    width,
    height: 841.89,
    color: rgb(1, 1, 1),
  });

  const heroBytes = await readPublicAsset("hero-pdf.jpg");
  const heroImage = await pdf.embedJpg(heroBytes);
  const heroDims = fitCover(heroImage.width, heroImage.height, heroW, heroH);

  page.drawImage(heroImage, {
    x: heroX + (heroW - heroDims.width) / 2,
    y: heroY + (heroH - heroDims.height) / 2,
    width: heroDims.width,
    height: heroDims.height,
  });

  page.drawRectangle({
    x: logoBoxX,
    y: logoBoxY,
    width: logoBoxW,
    height: logoBoxH,
    color: rgb(1, 1, 1),
  });

  const logoBytes = await readPublicAsset("logo-demo.jpg");
  const logoImage = await pdf.embedJpg(logoBytes);
  const logoDims = fitContain(
    logoImage.width,
    logoImage.height,
    logoBoxW - 18,
    logoBoxH - 12
  );

  page.drawImage(logoImage, {
    x: logoBoxX + (logoBoxW - logoDims.width) / 2,
    y: logoBoxY + (logoBoxH - logoDims.height) / 2,
    width: logoDims.width,
    height: logoDims.height,
  });

  page.drawRectangle({
    x: titleBoxX,
    y: titleBoxY,
    width: titleBoxW,
    height: titleBoxH,
    color: softGray,
  });

  const title = data.title || "Photovoltaik-Anlage";
  const bigKwText = `${money(data.kWp)} kWp`;

  const titleFontSize =
    title.length > 48 ? 13.5 : title.length > 40 ? 14.5 : 15.5;

  drawText(page, title, titleBoxX + 16, titleBoxY + 74, titleFontSize, font, textDark);
  drawText(page, bigKwText, titleBoxX + 16, titleBoxY + 38, 21.5, bold, textDark);

  drawLine(
    page,
    titleBoxX + 16,
    titleBoxY + 26,
    titleBoxX + titleBoxW - 16,
    titleBoxY + 26,
    2.5,
    teal
  );

  drawText(
    page,
    `Offerte Nr.  ${data.planningNumber || "—"}`,
    titleBoxX + 16,
    titleBoxY + 9,
    9.5,
    font,
    textMuted
  );

  const offerDateText = `Datum: ${data.offerDate || "—"}`;
  const offerDateWidth = font.widthOfTextAtSize(offerDateText, 9.5);

  drawText(
    page,
    offerDateText,
    titleBoxX + titleBoxW - 16 - offerDateWidth,
    titleBoxY + 9,
    9.5,
    font,
    textMuted
  );

  let y = 522;

  drawText(page, `Herr ${data.customerName || "—"}`, pageMarginX, y, 12.5, bold, textDark);
  y -= 22;

  const introLines = [
    `Vielen Dank für Ihr Interesse an einer Zusammenarbeit mit ${data.companyName || "uns"}.`,
    `Mit ${data.companyName || "uns"} haben Sie einen verlässlichen Partner für innovative`,
    "Photovoltaik-Lösungen an Ihrer Seite.",
  ];

  for (const line of introLines) {
    drawText(page, line, pageMarginX, y, 9.2, font, textDark);
    y -= 12;
  }

  y -= 16;
  drawText(page, "Photovoltaik-Anlage", pageMarginX, y, 12.2, bold, textDark);
  y -= 16;

  const grossPrice = Number(data.grossPriceChf || 0);
  const automaticPvSubsidy = Number(data.automaticPvSubsidyChf || 0);
  const manualAdditionalSubsidy = Number(data.manualAdditionalSubsidyChf || 0);
  const totalSubsidy = Number(data.subsidyChf || 0);
  const taxSavings = Number(data.taxSavingsChf || 0);
  const effectiveCost =
    typeof data.effectiveCostChf === "number"
      ? Number(data.effectiveCostChf)
      : Math.max(0, Number(data.totalInvestmentChf || 0) - taxSavings);

  const discountChf = Number(data.discountChf || 0);
  const discountPct = Number(data.discountPct || 0);
  const discountFromPctChf = Number(data.discountFromPctChf || 0);
  const totalDiscountChf = Number(data.totalDiscountChf || 0);

  const systemSummary = [
    data.kWp > 0 ? `${money(data.kWp)} kWp` : "",
    data.moduleCount ? `${data.moduleCount} Module` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const optionRows: Row[] = [
    ...(data.batteryLabel
      ? [
          {
            left: "",
            middle: `Batterie: ${truncate(data.batteryLabel, 34)}`,
            right:
              (data.batteryPriceChf ?? 0) > 0
                ? `${money(data.batteryPriceChf)} CHF`
                : "—",
          } satisfies Row,
        ]
      : []),
    ...(data.wallboxLabel
      ? [
          {
            left: "",
            middle: `Ladestation: ${truncate(data.wallboxLabel, 34)}`,
            right:
              (data.wallboxPriceChf ?? 0) > 0
                ? `${money(data.wallboxPriceChf)} CHF`
                : "—",
          } satisfies Row,
        ]
      : []),
  ];

const tableX = 30;
const tableW = width - 60;

  const costRows: Row[] = [
    {
      left: "Kosten*",
      middle: systemSummary || "Solaranlage",
      right: `${money(data.netSystemPriceChf)} CHF`,
    },
    ...optionRows,
    ...(totalDiscountChf > 0
      ? [
          ...(discountPct > 0
            ? [
                {
                  left: "",
                  middle: `Rabatt ${pct(discountPct)} %`,
                  right: `-${money(discountFromPctChf)} CHF`,
                } satisfies Row,
              ]
            : []),
          ...(discountChf > 0
            ? [
                {
                  left: "",
                  middle: "Zusätzlicher Rabatt",
                  right: `-${money(discountChf)} CHF`,
                } satisfies Row,
              ]
            : []),
        ]
      : []),
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
    size: 9.5,
    lineHeight: 17,
  });

  drawLine(page, tableX, y + 7, tableX + tableW, y + 7, 1, lineGray);

  if (totalSubsidy > 0) {
    const subsidyRows: Row[] = [
      ...(automaticPvSubsidy > 0
        ? [
            {
              left: "Förderungen**",
              middle: "Pronovo Einmalvergütung",
              right: `-${money(automaticPvSubsidy)} CHF`,
            } satisfies Row,
          ]
        : []),
      ...(manualAdditionalSubsidy > 0
        ? [
            {
              left: "",
              middle: "Weitere Fördergelder / Kanton",
              right: `-${money(manualAdditionalSubsidy)} CHF`,
            } satisfies Row,
          ]
        : []),
    ];

    y -= 10;
    y = drawPricingRows({
      page,
      rows: subsidyRows,
      x: tableX,
      y,
      width: tableW,
      font,
      bold,
      size: 9.5,
      lineHeight: 17,
    });

    drawLine(page, tableX, y + 7, tableX + tableW, y + 7, 1, lineGray);
  }

  y -= 10;

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
    size: 9.5,
    lineHeight: 17,
  });

  drawLine(page, tableX, y + 7, tableX + tableW, y + 7, 1, lineGray);

  y -= 14;
  drawText(
    page,
    "*   Kosten gelten bei Bestellung aller aufgeführten Systeme.",
    tableX,
    y,
    7.8,
    font,
    textDark
  );
  y -= 10;
  drawText(
    page,
    `**  Pronovo-Einmalvergütung: ${data.kWp <= 30 ? "360 CHF/kWp" : "300 CHF/kWp"} auf Basis von ${money(data.kWp)} kWp.`,
    tableX,
    y,
    7.8,
    font,
    textDark
  );
  y -= 10;
  drawText(
    page,
    "    Weitere Fördergelder (z. B. Kanton / Gemeinde) wurden, falls vorhanden, separat berücksichtigt.",
    tableX,
    y,
    7.8,
    font,
    textDark
  );
  y -= 10;
  drawText(
    page,
    "    Förderungen und Steuerersparnisse sind unverbindliche Schätzwerte und nicht garantiert.",
    tableX,
    y,
    7.8,
    font,
    textDark
  );

  y -= 22;
  drawText(page, "Offerte gültig bis:", tableX, y, 9.4, font, textDark);
  drawText(page, data.validUntil || "—", tableX + 118, y, 9.4, bold, textDark);
  drawLine(page, tableX, y - 7, tableX + 270, y - 7, 1, lineGray);

  y -= 24;
  drawText(
    page,
    "Als Ihr persönlicher Ansprechpartner stehen wir Ihnen jederzeit gerne",
    tableX,
    y,
    9,
    font,
    textDark
  );
  y -= 12;
  drawText(
    page,
    "zur Verfügung. Wir freuen uns, von Ihnen zu hören!",
    tableX,
    y,
    9,
    font,
    textDark
  );

  y -= 26;
  drawText(page, "Mit freundlichen Grüssen", tableX, y, 9.2, font, textDark);

  y -= 22;
  drawText(
    page,
    data.advisorName || data.companyName || "—",
    tableX,
    y,
    12.5,
    bold,
    textDark
  );

  y -= 13;
  drawText(
    page,
    `${data.advisorRole || "Beratung"} · ${data.companyName || "—"}`,
    tableX,
    y,
    8.5,
    font,
    textMuted
  );
}