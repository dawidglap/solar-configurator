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

  txt(page, label, x + 9, y + h - 14, 6.3, font, C.muted);
  txt(page, value, x + 9, y + 10, 9.5, bold, color);
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

  const plotX = x + 30;
  const plotY = y + 22;
  const plotW = w - 42;
  const plotH = h - 45;

  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    color: rgb(0.985, 0.99, 0.99),
    borderColor: C.border,
    borderWidth: 0.5,
  });

  for (let i = 0; i <= 3; i++) {
    const value = (max / 3) * i;
    const yy = plotY + (plotH / 3) * i;

    page.drawLine({
      start: { x: plotX, y: yy },
      end: { x: plotX + plotW, y: yy },
      thickness: 0.3,
      color: rgb(0.86, 0.88, 0.89),
    });

    rightTxt(page, fmtAxis(value), plotX - 6, yy - 2, 5.4, font, C.muted);
  }

  const point = (val: number, i: number) => ({
    x: plotX + (plotW / (data.length - 1)) * i,
    y: plotY + (val / max) * plotH,
  });

  for (let i = 0; i < data.length - 1; i++) {
    const a = point(data[i].production, i);
    const b = point(data[i + 1].production, i + 1);
    page.drawLine({ start: a, end: b, thickness: 1.5, color: C.green });

    const c = point(data[i].consumption, i);
    const d = point(data[i + 1].consumption, i + 1);
    page.drawLine({ start: c, end: d, thickness: 1.5, color: C.orange });
  }

  data.forEach((d, i) => {
    const px = plotX + (plotW / (data.length - 1)) * i;
    txt(page, d.month, px - 1.5, y + 8, 5.4, font, C.muted);
  });

  page.drawCircle({ x: x + 78, y: y + h - 14, size: 2.3, color: C.green });
  txt(page, "Produktion", x + 84, y + h - 16, 5.8, font, C.muted);

  page.drawCircle({ x: x + 147, y: y + h - 14, size: 2.3, color: C.orange });
  txt(page, "Verbrauch", x + 153, y + h - 16, 5.8, font, C.muted);
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

  const limit = mode === "cashflow" ? Math.max(Math.abs(min), Math.abs(max)) : niceCeil(max);
  const top = mode === "cashflow" ? limit : niceCeil(max);
  const bottom = mode === "cashflow" ? -limit : 0;

  const plotX = x + 35;
  const plotY = y + 22;
  const plotW = w - 45;
  const plotH = h - 45;

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
    borderWidth: 0.5,
  });

  for (let i = 0; i <= 3; i++) {
    const value = bottom + ((top - bottom) / 3) * i;
    const yy = valueToY(value);

    page.drawLine({
      start: { x: plotX, y: yy },
      end: { x: plotX + plotW, y: yy },
      thickness: 0.3,
      color: rgb(0.86, 0.88, 0.89),
    });

    rightTxt(page, fmtAxis(value), plotX - 6, yy - 2, 5.3, font, C.muted);
  }

  page.drawLine({
    start: { x: plotX, y: zeroY },
    end: { x: plotX + plotW, y: zeroY },
    thickness: 0.5,
    color: rgb(0.65, 0.69, 0.71),
  });

  const gap = values.length > 12 ? 2 : 4;
  const barW = Math.max(3, (plotW - gap * (values.length - 1)) / values.length);

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
      txt(page, labels[i], bx - 1, y + 8, 5.2, font, C.muted);
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
  const { page, x, y, size, pct, bold } = args;

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
  txt(page, fmtPct(pct, 1), x - 14, y - 3, 8.5, bold, C.dark);
}

function addBerichtOverviewPage(
  pdf: PDFDocument,
  data: ReportPagesData,
  font: PDFFont,
  bold: PDFFont
) {
  const r = data.reportSummary || {};
  const offer = data.offer || {};
  const page = pdf.addPage([PAGE_W, PAGE_H]);

  header(page, font, bold, "Bericht", data.planningNumber);

  txt(
    page,
    "Kompakte Übersicht der wichtigsten Kennzahlen zu Energiefluss, Wirtschaftlichkeit, Produktion und Ersparnis.",
    44,
    748,
    9,
    font,
    C.muted
  );

  const gap = 14;
  const colW = (CONTENT_WIDTH - gap) / 2;
  const leftX = 44;
  const rightX = leftX + colW + gap;

  const annual = n(r.annualBenefitChf);
  const investment = n(r.totalInvestmentChf ?? offer?.pricing?.totalInvestmentChf);

  // Energiefluss
  page.drawRectangle({
    x: leftX,
    y: 515,
    width: colW,
    height: 215,
    color: C.light,
    borderColor: C.border,
    borderWidth: 0.6,
  });

  txt(page, "Energiefluss", leftX + 12, 708, 11, bold, C.dark);

  drawKpi({
    page,
    x: leftX + 12,
    y: 665,
    w: 102,
    h: 36,
    label: "Eigenverbrauch",
    value: fmtPct(r.selfUseSharePct),
    font,
    bold,
    color: C.green,
  });

  drawKpi({
    page,
    x: leftX + 125,
    y: 665,
    w: 102,
    h: 36,
    label: "Autarkie",
    value: fmtPct(r.autarkyPct),
    font,
    bold,
    color: C.green,
  });

  drawLineChart({
    page,
    data: monthlyEnergy(r),
    x: leftX + 10,
    y: 530,
    w: colW - 20,
    h: 120,
    font,
  });

  // Wirtschaftlichkeit
  page.drawRectangle({
    x: rightX,
    y: 515,
    width: colW,
    height: 215,
    color: C.light,
    borderColor: C.border,
    borderWidth: 0.6,
  });

  txt(page, "Wirtschaftlichkeit", rightX + 12, 708, 11, bold, C.dark);

  drawKpi({
    page,
    x: rightX + 12,
    y: 665,
    w: 68,
    h: 36,
    label: "Break-even",
    value: r.breakEvenYears != null ? `${fmtNum(r.breakEvenYears, 1)} J.` : "—",
    font,
    bold,
    color: rgb(0.22, 0.48, 0.78),
  });

  drawKpi({
    page,
    x: rightX + 88,
    y: 665,
    w: 82,
    h: 36,
    label: "Investition",
    value: fmtChf(investment),
    font,
    bold,
  });

  drawKpi({
    page,
    x: rightX + 178,
    y: 665,
    w: 57,
    h: 36,
    label: "Rendite",
    value: r.roiPct != null ? fmtPct(r.roiPct) : "—",
    font,
    bold,
    color: C.green,
  });

  page.drawRectangle({
    x: rightX + 12,
    y: 626,
    width: colW - 24,
    height: 28,
    color: rgb(0.95, 0.98, 0.97),
    borderColor: C.border,
    borderWidth: 0.5,
  });

  txt(page, "PV Einmalvergütung", rightX + 22, 642, 6.5, font, C.muted);
  txt(page, fmtChf(r.automaticPvSubsidyChf), rightX + 105, 642, 7.2, bold, C.dark);

  txt(page, "Weitere", rightX + 22, 631, 6.5, font, C.muted);
  txt(page, fmtChf(r.manualAdditionalSubsidyChf), rightX + 105, 631, 7.2, bold, C.dark);

  rightTxt(page, `Total ${fmtChf(r.subsidyChf)}`, rightX + colW - 20, 631, 7.5, bold, C.green);

  const cashflow = Array.from({ length: 26 }, (_, i) =>
    Math.round(-investment + annual * i)
  );

  drawBarChart({
    page,
    values: cashflow,
    labels: Array.from({ length: 26 }, (_, i) => String(i)),
    x: rightX + 10,
    y: 530,
    w: colW - 20,
    h: 85,
    font,
    mode: "cashflow",
  });

  // Produktion
  page.drawRectangle({
    x: leftX,
    y: 300,
    width: colW,
    height: 195,
    color: C.light,
    borderColor: C.border,
    borderWidth: 0.6,
  });

  txt(page, "Produktion", leftX + 12, 473, 11, bold, C.dark);

  txt(
    page,
    `${fmtNum(r.moduleCount)} × ${r.selectedPanelName || "PV Modul"}`,
    leftX + 12,
    459,
    7,
    font,
    C.muted
  );

  const prodRows = [
    ["Jahresproduktion", `${fmtNum(r.annualProductionKwh)} kWh`],
    ["Spez. Ertrag", `${fmtNum(r.yearlyYieldKwhPerKwp)} kWh/kWp`],
    ["Modulleistung", `${fmtNum(r.selectedPanelWp)} Wp`],
    ["Anzahl Module", `${fmtNum(r.moduleCount)}`],
    ["Dachflächen", `${fmtNum(r.roofCount)}`],
    ["Belegte Fläche", `${fmtNum(r.moduleAreaM2, 1)} m²`],
  ];

  let py = 435;

  prodRows.forEach((row, i) => {
    const x = i % 2 === 0 ? leftX + 12 : leftX + 132;
    if (i % 2 === 0 && i > 0) py -= 34;

    txt(page, row[0], x, py, 6.8, font, C.muted);
    txt(page, row[1], x, py - 13, 8.2, bold, C.dark);
  });

  page.drawLine({
    start: { x: leftX + 12, y: 345 },
    end: { x: leftX + colW - 12, y: 345 },
    thickness: 0.5,
    color: C.border,
  });

  drawDonut({
    page,
    x: leftX + 62,
    y: 323,
    size: 23,
    pct: n(r.selfUseSharePct),
    font,
    bold,
  });

  txt(page, "Eigenverbrauch", leftX + 105, 331, 6.8, font, C.muted);
  txt(page, fmtPct(r.selfUseSharePct), leftX + 105, 318, 8.5, bold, C.dark);

  txt(page, "Einspeisung", leftX + 170, 331, 6.8, font, C.muted);
  txt(page, fmtPct(100 - n(r.selfUseSharePct)), leftX + 170, 318, 8.5, bold, C.dark);

  // Ersparnis
  page.drawRectangle({
    x: rightX,
    y: 300,
    width: colW,
    height: 195,
    color: C.light,
    borderColor: C.border,
    borderWidth: 0.6,
  });

  txt(page, "Ersparnis", rightX + 12, 473, 11, bold, C.dark);

  drawKpi({
    page,
    x: rightX + 12,
    y: 435,
    w: 68,
    h: 36,
    label: "Pro Monat",
    value: fmtChf(Math.round(annual / 12)),
    font,
    bold,
  });

  drawKpi({
    page,
    x: rightX + 88,
    y: 435,
    w: 68,
    h: 36,
    label: "Pro Jahr",
    value: fmtChf(annual),
    font,
    bold,
  });

  drawKpi({
    page,
    x: rightX + 164,
    y: 435,
    w: 71,
    h: 36,
    label: "In 20 Jahren",
    value: fmtChf(annual * 20),
    font,
    bold,
    color: C.green,
  });

  const savingFactors = [0.04, 0.05, 0.08, 0.1, 0.12, 0.13, 0.13, 0.12, 0.09, 0.07, 0.04, 0.03];
  const savingLabels = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
  const savingValues = savingFactors.map((f) => Math.round(annual * f));

  drawBarChart({
    page,
    values: savingValues,
    labels: savingLabels,
    x: rightX + 10,
    y: 315,
    w: colW - 20,
    h: 105,
    font,
    mode: "saving",
  });

  // Monatliche Ersparnis Detail
  page.drawRectangle({
    x: 44,
    y: 78,
    width: 507,
    height: 200,
    color: C.light,
    borderColor: C.border,
    borderWidth: 0.6,
  });

  txt(page, "Monatliche Ersparnis", 58, 256, 11, bold, C.dark);

  drawBarChart({
    page,
    values: savingValues,
    labels: savingLabels,
    x: 58,
    y: 100,
    w: 480,
    h: 140,
    font,
    mode: "saving",
  });

  footer(page, font, data.companyName);
}

export async function addReportPages(pdf: PDFDocument, data: ReportPagesData) {
  const report = data.reportSummary;
  if (!report) return;

  const font = await pdf.embedFont("Helvetica");
  const bold = await pdf.embedFont("Helvetica-Bold");

  addBerichtOverviewPage(pdf, data, font, bold);
}