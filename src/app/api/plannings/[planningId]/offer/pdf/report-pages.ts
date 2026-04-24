import { PDFDocument, PDFPage, PDFFont, rgb } from "pdf-lib";

type ReportPagesData = {
  planningNumber?: string;
  companyName?: string;
  reportSummary?: any;
  offer?: any;
};

const PAGE_W = 595.28;
const PAGE_H = 841.89;

const CONTENT_LEFT = 44;
const CONTENT_RIGHT = 551;
const CONTENT_WIDTH = CONTENT_RIGHT - CONTENT_LEFT;

const C = {
  dark: rgb(0.13, 0.22, 0.27),
  muted: rgb(0.45, 0.52, 0.56),
  light: rgb(0.95, 0.97, 0.97),
  border: rgb(0.84, 0.87, 0.88),
  teal: rgb(0.12, 0.32, 0.37),
  green: rgb(0.22, 0.78, 0.64),
  orange: rgb(0.95, 0.58, 0.16),
  red: rgb(0.92, 0.24, 0.22),
  gray: rgb(0.58, 0.62, 0.65),
  white: rgb(1, 1, 1),
};

function n(v: any, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function fmtNum(v: any, digits = 0) {
  return new Intl.NumberFormat("de-CH", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n(v));
}

function fmtChf(v: any) {
  return `CHF ${fmtNum(v, 0)}`;
}

function fmtPct(v: any, digits = 1) {
  return `${fmtNum(v, digits)}%`;
}

function txt(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  size: number,
  font: PDFFont,
  color = C.dark
) {
  page.drawText(String(text ?? ""), { x, y, size, font, color });
}

function rightTxt(
  page: PDFPage,
  text: string,
  rightX: number,
  y: number,
  size: number,
  font: PDFFont,
  color = C.dark
) {
  const w = font.widthOfTextAtSize(String(text ?? ""), size);
  txt(page, text, rightX - w, y, size, font, color);
}

function header(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  title: string,
  planningNumber?: string
) {
  txt(page, title, 44, 792, 19, bold, C.dark);

  if (planningNumber) {
    rightTxt(page, `Offerte Nr. ${planningNumber}`, 551, 797, 8.8, font, C.muted);
  }

  page.drawLine({
    start: { x: 44, y: 778 },
    end: { x: 551, y: 778 },
    thickness: 2,
    color: C.teal,
  });
}

function footer(page: PDFPage, font: PDFFont, companyName?: string) {
  page.drawLine({
    start: { x: 44, y: 42 },
    end: { x: 551, y: 42 },
    thickness: 0.6,
    color: C.border,
  });

  txt(page, companyName || "HELIONIC", 44, 27, 7.5, font, C.muted);
}

function drawKpi(args: {
  page: PDFPage;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  value: string;
  font: PDFFont;
  bold: PDFFont;
  color?: any;
}) {
  const { page, x, y, w, h, label, value, font, bold, color = C.dark } = args;

  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    color: C.light,
    borderColor: C.border,
    borderWidth: 0.6,
  });

  txt(page, label, x + 10, y + h - 17, 7.2, font, C.muted);
  txt(page, value, x + 10, y + 13, 13, bold, color);
}

function drawSectionTitle(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  bold: PDFFont
) {
  txt(page, text, x, y, 12.5, bold, C.dark);

  page.drawLine({
    start: { x, y: y - 9 },
    end: { x: 551, y: y - 9 },
    thickness: 0.7,
    color: C.border,
  });
}

function drawParagraph(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  maxChars: number,
  lineHeight: number,
  font: PDFFont,
  size = 8.2,
  color = C.dark
) {
  const words = text.split(/\s+/);
  let line = "";
  let yy = y;

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;

    if (next.length > maxChars) {
      txt(page, line, x, yy, size, font, color);
      yy -= lineHeight;
      line = word;
    } else {
      line = next;
    }
  }

  if (line) txt(page, line, x, yy, size, font, color);
  return yy - lineHeight;
}

function niceCeil(value: number) {
  if (value <= 0) return 1000;

  const rough = value * 1.15;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalized = rough / pow;

  let niceNormalized = 1;

  if (normalized <= 1) niceNormalized = 1;
  else if (normalized <= 2) niceNormalized = 2;
  else if (normalized <= 2.5) niceNormalized = 2.5;
  else if (normalized <= 5) niceNormalized = 5;
  else niceNormalized = 10;

  return niceNormalized * pow;
}

function fmtAxis(v: number) {
  if (Math.abs(v) >= 1000) return `${fmtNum(v / 1000, v >= 10000 ? 0 : 1)}k`;
  return fmtNum(v, 0);
}

function monthlyEnergy(report: any) {
  const prod = n(report?.annualProductionKwh);
  const cons = n(report?.yearlyConsumptionKwh);

  const pf = [0.04, 0.05, 0.08, 0.1, 0.12, 0.13, 0.13, 0.12, 0.09, 0.07, 0.04, 0.03];
  const cf = [0.09, 0.09, 0.085, 0.08, 0.075, 0.07, 0.07, 0.075, 0.08, 0.085, 0.09, 0.095];

  return pf.map((f, i) => ({
    month: ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"][i],
    production: Math.round(prod * f),
    consumption: Math.round(cons * cf[i]),
  }));
}

function drawLineChart(args: {
  page: PDFPage;
  data: { month: string; production: number; consumption: number }[];
  x: number;
  y: number;
  w: number;
  h: number;
  font: PDFFont;
}) {
  const { page, data, x, y, w, h, font } = args;

  const rawMax = Math.max(1, ...data.flatMap((d) => [d.production, d.consumption]));
  const max = niceCeil(rawMax);

  const plotX = x + 42;
  const plotY = y + 28;
  const plotW = w - 58;
  const plotH = h - 58;

  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    color: rgb(0.985, 0.99, 0.99),
    borderColor: C.border,
    borderWidth: 0.6,
  });

  for (let i = 0; i <= 4; i++) {
    const value = (max / 4) * i;
    const yy = plotY + (plotH / 4) * i;

    page.drawLine({
      start: { x: plotX, y: yy },
      end: { x: plotX + plotW, y: yy },
      thickness: 0.35,
      color: rgb(0.86, 0.88, 0.89),
    });

    rightTxt(page, fmtAxis(value), plotX - 8, yy - 2, 6.4, font, C.muted);
  }

  const point = (val: number, i: number) => ({
    x: plotX + (plotW / (data.length - 1)) * i,
    y: plotY + (val / max) * plotH,
  });

  for (let i = 0; i < data.length - 1; i++) {
    const a = point(data[i].production, i);
    const b = point(data[i + 1].production, i + 1);
    page.drawLine({ start: a, end: b, thickness: 2, color: C.green });

    const c = point(data[i].consumption, i);
    const d = point(data[i + 1].consumption, i + 1);
    page.drawLine({ start: c, end: d, thickness: 2, color: C.orange });
  }

  data.forEach((d, i) => {
    const px = plotX + (plotW / (data.length - 1)) * i;
    txt(page, d.month, px - 2, y + 11, 6.5, font, C.muted);
  });

  page.drawCircle({ x: x + 185, y: y + h - 20, size: 3, color: C.green });
  txt(page, "Produktion", x + 193, y + h - 23, 7.3, font, C.muted);

  page.drawCircle({ x: x + 285, y: y + h - 20, size: 3, color: C.orange });
  txt(page, "Verbrauch", x + 293, y + h - 23, 7.3, font, C.muted);
}

function drawBarChart(args: {
  page: PDFPage;
  values: number[];
  labels: string[];
  x: number;
  y: number;
  w: number;
  h: number;
  font: PDFFont;
  mode?: "cashflow" | "saving";
}) {
  const { page, values, labels, x, y, w, h, font, mode = "saving" } = args;

  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);

  const limit = mode === "cashflow"
    ? Math.max(Math.abs(min), Math.abs(max))
    : niceCeil(max);

  const top = mode === "cashflow" ? limit : niceCeil(max);
  const bottom = mode === "cashflow" ? -limit : 0;

  const plotX = x + 48;
  const plotY = y + 30;
  const plotW = w - 62;
  const plotH = h - 60;

  const valueToY = (value: number) => {
    const range = top - bottom || 1;
    return plotY + ((value - bottom) / range) * plotH;
  };

  const zeroY = valueToY(0);

  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    color: rgb(0.985, 0.99, 0.99),
    borderColor: C.border,
    borderWidth: 0.6,
  });

  for (let i = 0; i <= 4; i++) {
    const value = bottom + ((top - bottom) / 4) * i;
    const yy = valueToY(value);

    page.drawLine({
      start: { x: plotX, y: yy },
      end: { x: plotX + plotW, y: yy },
      thickness: 0.35,
      color: rgb(0.86, 0.88, 0.89),
    });

    rightTxt(page, fmtAxis(value), plotX - 8, yy - 2, 6.3, font, C.muted);
  }

  page.drawLine({
    start: { x: plotX, y: zeroY },
    end: { x: plotX + plotW, y: zeroY },
    thickness: 0.6,
    color: rgb(0.65, 0.69, 0.71),
  });

  const gap = 3;
  const barW = Math.max(4, (plotW - gap * (values.length - 1)) / values.length);

  values.forEach((v, i) => {
    const bx = plotX + i * (barW + gap);
    const by = Math.min(zeroY, valueToY(v));
    const bh = Math.abs(valueToY(v) - zeroY);

    page.drawRectangle({
      x: bx,
      y: by,
      width: barW,
      height: Math.max(1, bh),
      color: v >= 0 ? C.green : C.red,
    });

    if (labels[i] && (values.length <= 12 || i % 5 === 0)) {
      txt(page, labels[i], bx - 1, y + 11, 6.2, font, C.muted);
    }
  });
}

function drawDonut(args: {
  page: PDFPage;
  x: number;
  y: number;
  size: number;
  pct: number;
  font: PDFFont;
  bold: PDFFont;
}) {
  const { page, x, y, size, pct, font, bold } = args;

  page.drawCircle({ x, y, size, color: C.gray });

  const segments = 34;
  const active = Math.round((Math.max(0, Math.min(100, pct)) / 100) * segments);

  for (let i = 0; i < active; i++) {
    const a = (-90 + (360 / segments) * i) * (Math.PI / 180);

    page.drawCircle({
      x: x + Math.cos(a) * size * 0.72,
      y: y + Math.sin(a) * size * 0.72,
      size: size * 0.105,
      color: C.green,
    });
  }

  page.drawCircle({ x, y, size: size * 0.57, color: C.white });
  txt(page, fmtPct(pct, 1), x - 17, y - 4, 11, bold, C.dark);
}

function addEnergieflussPage(
  pdf: PDFDocument,
  data: ReportPagesData,
  font: PDFFont,
  bold: PDFFont
) {
  const r = data.reportSummary || {};
  const page = pdf.addPage([PAGE_W, PAGE_H]);

  header(page, font, bold, "Energiefluss", data.planningNumber);

  txt(
    page,
    "Diese Seite zeigt, wie die erzeugte Solarenergie im Gebäude genutzt wird.",
    44,
    748,
    9.5,
    font,
    C.muted
  );

  drawKpi({
    page,
    x: 44,
    y: 685,
    w: 240,
    h: 48,
    label: "Eigenverbrauch",
    value: fmtPct(r.selfUseSharePct),
    font,
    bold,
    color: C.green,
  });

  drawKpi({
    page,
    x: 311,
    y: 685,
    w: 240,
    h: 48,
    label: "Autarkie",
    value: fmtPct(r.autarkyPct),
    font,
    bold,
    color: C.green,
  });

  drawSectionTitle(page, "Monatliche Produktion und Verbrauch", 44, 645, bold);

  drawLineChart({
    page,
    data: monthlyEnergy(r),
    x: 44,
    y: 365,
    w: 507,
    h: 245,
    font,
  });

  drawSectionTitle(page, "Einordnung", 44, 315, bold);

  const text =
    `Die geplante Photovoltaikanlage erzeugt voraussichtlich ${fmtNum(r.annualProductionKwh)} kWh Solarstrom pro Jahr. ` +
    `Davon werden rund ${fmtPct(r.selfUseSharePct)} direkt im Gebäude genutzt. ` +
    `Der Autarkiegrad von ${fmtPct(r.autarkyPct)} zeigt, welchen Anteil des jährlichen Strombedarfs die Anlage rechnerisch abdecken kann. ` +
    `Ein hoher Eigenverbrauch reduziert den Netzstrombezug und verbessert die Wirtschaftlichkeit im Alltag.`;

  drawParagraph(page, text, CONTENT_LEFT, 90, 105, 12, font);

  page.drawRectangle({
    x: 44,
    y: 95,
    width: 507,
    height: 58,
    color: rgb(0.95, 0.98, 0.97),
    borderColor: C.border,
    borderWidth: 0.6,
  });

  txt(page, "Hinweis", 58, 128, 8.5, bold, C.teal);
  drawParagraph(
    page,
    "Die tatsächlichen Werte können je nach Wetter, Verbrauchsprofil, Verschattung und Betriebsverhalten abweichen.",
    58,
    112,
    105,
    12,
    font,
    8,
    C.dark
  );

  footer(page, font, data.companyName);
}

function addWirtschaftProduktionErsparnisPage(
  pdf: PDFDocument,
  data: ReportPagesData,
  font: PDFFont,
  bold: PDFFont
) {
  const r = data.reportSummary || {};
  const offer = data.offer || {};
  const page = pdf.addPage([PAGE_W, PAGE_H]);

  header(page, font, bold, "Wirtschaftlichkeit, Produktion & Ersparnis", data.planningNumber);

  txt(
    page,
    "Zusammenfassung der wichtigsten wirtschaftlichen und technischen Kennzahlen.",
    44,
    748,
    9.5,
    font,
    C.muted
  );

  // Wirtschaftlichkeit
  drawSectionTitle(page, "Wirtschaftlichkeit", 44, 715, bold);

  drawKpi({
    page,
    x: 44,
    y: 650,
    w: 155,
    h: 46,
    label: "Break-even",
    value: r.breakEvenYears != null ? `${fmtNum(r.breakEvenYears, 1)} J.` : "—",
    font,
    bold,
    color: rgb(0.22, 0.48, 0.78),
  });

  drawKpi({
    page,
    x: 220,
    y: 650,
    w: 155,
    h: 46,
    label: "Investition",
    value: fmtChf(r.totalInvestmentChf ?? offer?.pricing?.totalInvestmentChf),
    font,
    bold,
  });

  drawKpi({
    page,
    x: 396,
    y: 650,
    w: 155,
    h: 46,
    label: "Rendite",
    value: r.roiPct != null ? fmtPct(r.roiPct) : "—",
    font,
    bold,
    color: C.green,
  });

  page.drawRectangle({
    x: 44,
    y: 602,
    width: 507,
    height: 33,
    color: rgb(0.95, 0.98, 0.97),
    borderColor: C.border,
    borderWidth: 0.6,
  });

  txt(page, "PV Einmalvergütung", 58, 622, 7.5, font, C.muted);
  txt(page, fmtChf(r.automaticPvSubsidyChf), 158, 622, 8, bold, C.dark);

  txt(page, "Weitere Förderungen", 267, 622, 7.5, font, C.muted);
  txt(page, fmtChf(r.manualAdditionalSubsidyChf), 380, 622, 8, bold, C.dark);

  rightTxt(page, `Total ${fmtChf(r.subsidyChf)}`, 535, 622, 8.2, bold, C.green);

  // Produktion
  drawSectionTitle(page, "Produktion", 44, 565, bold);

  const rows = [
    ["Jahresproduktion", `${fmtNum(r.annualProductionKwh)} kWh`, "Spez. Ertrag", `${fmtNum(r.yearlyYieldKwhPerKwp)} kWh/kWp`],
    ["Modulleistung", `${fmtNum(r.selectedPanelWp)} Wp`, "Anzahl Module", `${fmtNum(r.moduleCount)} Stk.`],
    ["Dachflächen", `${fmtNum(r.roofCount)} Fläche${n(r.roofCount) === 1 ? "" : "n"}`, "Belegte Fläche", `${fmtNum(r.moduleAreaM2, 1)} m²`],
  ];

  let y = 532;

  rows.forEach((row) => {
    txt(page, row[0], 44, y, 7.5, font, C.muted);
    rightTxt(page, row[1], 260, y, 8.3, bold, C.dark);

    txt(page, row[2], 315, y, 7.5, font, C.muted);
    rightTxt(page, row[3], 551, y, 8.3, bold, C.dark);

    page.drawLine({
      start: { x: 44, y: y - 7 },
      end: { x: 551, y: y - 7 },
      thickness: 0.4,
      color: C.border,
    });

    y -= 24;
  });

  // Eigenverbrauch mini
  page.drawRectangle({
    x: 44,
    y: 350,
    width: 230,
    height: 95,
    color: C.light,
    borderColor: C.border,
    borderWidth: 0.6,
  });

  txt(page, "Eigenverbrauch / Einspeisung", 58, 423, 9, bold, C.dark);

  drawDonut({
    page,
    x: 118,
    y: 385,
    size: 31,
    pct: n(r.selfUseSharePct),
    font,
    bold,
  });

  txt(page, "Eigenverbrauch", 170, 398, 7.3, font, C.muted);
  txt(page, fmtPct(r.selfUseSharePct), 170, 384, 9, bold, C.dark);

  txt(page, "Einspeisung", 170, 368, 7.3, font, C.muted);
  txt(page, fmtPct(100 - n(r.selfUseSharePct)), 170, 354, 9, bold, C.dark);

  // Ersparnis KPI
  page.drawRectangle({
    x: 296,
    y: 350,
    width: 255,
    height: 95,
    color: C.light,
    borderColor: C.border,
    borderWidth: 0.6,
  });

  const annual = n(r.annualBenefitChf);

  txt(page, "Ersparnis", 310, 423, 9, bold, C.dark);

 const col1 = 310;
const col2 = 410;

txt(page, "Pro Monat", col1, 398, 7, font, C.muted);
txt(page, fmtChf(Math.round(annual / 12)), col1, 382, 10, bold, C.dark);

txt(page, "Pro Jahr", col2, 398, 7, font, C.muted);
txt(page, fmtChf(annual), col2, 382, 10, bold, C.dark);

txt(page, "In 20 Jahren", col1, 360, 7, font, C.muted);
txt(page, fmtChf(annual * 20), col1, 345, 11, bold, C.green);

  // Cashflow
  drawSectionTitle(page, "Kumulierter Cashflow über 25 Jahre", 44, 310, bold);

  const investment = n(r.totalInvestmentChf ?? offer?.pricing?.totalInvestmentChf);
  const cashflow = Array.from({ length: 26 }, (_, i) => Math.round(-investment + annual * i));

  drawBarChart({
    page,
    values: cashflow,
    labels: Array.from({ length: 26 }, (_, i) => String(i)),
    x: 44,
    y: 120,
    w: 507,
    h: 160,
    font,
    mode: "cashflow",
  });

drawParagraph(
  page,
  `Die Investition amortisiert sich rechnerisch nach ca. ${r.breakEvenYears != null ? fmtNum(r.breakEvenYears, 1) : "—"} Jahren. Der Nutzen entsteht vor allem durch Eigenverbrauch, Einspeisevergütung und Förderbeiträge.`,
  44,
  90,
  105,
  12,
  font,
  8,
  C.dark
);

  footer(page, font, data.companyName);
}

function addErsparnisDetailPage(
  pdf: PDFDocument,
  data: ReportPagesData,
  font: PDFFont,
  bold: PDFFont
) {
  const r = data.reportSummary || {};
  const page = pdf.addPage([PAGE_W, PAGE_H]);

  header(page, font, bold, "Monatliche Ersparnis", data.planningNumber);

  txt(
    page,
    "Die monatliche Darstellung zeigt, wann der finanzielle Nutzen besonders stark ausfällt.",
    44,
    748,
    9.5,
    font,
    C.muted
  );

  const annual = n(r.annualBenefitChf);
  const factors = [0.04, 0.05, 0.08, 0.1, 0.12, 0.13, 0.13, 0.12, 0.09, 0.07, 0.04, 0.03];
  const labels = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
  const values = factors.map((f) => Math.round(annual * f));

  drawKpi({
    page,
    x: 44,
    y: 685,
    w: 155,
    h: 46,
    label: "Pro Monat",
    value: fmtChf(Math.round(annual / 12)),
    font,
    bold,
  });

  drawKpi({
    page,
    x: 220,
    y: 685,
    w: 155,
    h: 46,
    label: "Pro Jahr",
    value: fmtChf(annual),
    font,
    bold,
  });

  drawKpi({
    page,
    x: 396,
    y: 685,
    w: 155,
    h: 46,
    label: "In 20 Jahren",
    value: fmtChf(annual * 20),
    font,
    bold,
    color: C.green,
  });

  drawSectionTitle(page, "Monatliche Verteilung", 44, 635, bold);

  drawBarChart({
    page,
    values,
    labels,
    x: 44,
    y: 330,
    w: 507,
    h: 265,
    font,
    mode: "saving",
  });

  drawSectionTitle(page, "Einordnung", 44, 280, bold);

  drawParagraph(
    page,
    `Die Ersparnis entsteht durch vermiedenen Strombezug und die Vergütung für eingespeiste Energie. In sonnenstarken Monaten ist der Effekt in der Regel höher, während im Winter geringere PV-Erträge zu erwarten sind.`,
    44,
    250,
    108,
    13,
    font,
    8.5,
    C.dark
  );

  footer(page, font, data.companyName);
}

export async function addReportPages(pdf: PDFDocument, data: ReportPagesData) {
  const report = data.reportSummary;
  if (!report) return;

  const font = await pdf.embedFont("Helvetica");
  const bold = await pdf.embedFont("Helvetica-Bold");

  addEnergieflussPage(pdf, data, font, bold);
  addWirtschaftProduktionErsparnisPage(pdf, data, font, bold);
  addErsparnisDetailPage(pdf, data, font, bold);
}