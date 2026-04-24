import { PDFDocument, PDFPage, PDFFont, rgb } from "pdf-lib";

type ReportPagesData = {
  planningNumber?: string;
  companyName?: string;
  reportSummary?: any;
  offer?: any;
};

const PAGE_W = 595.28;
const PAGE_H = 841.89;

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

function s(v: any) {
  return typeof v === "string" ? v.trim() : "";
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

function truncate(text: string, max = 44) {
  const t = s(text);
  if (!t) return "—";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
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

function card(
  page: PDFPage,
  x: number,
  y: number,
  w: number,
  h: number,
  title?: string
) {
  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    color: C.light,
    borderColor: C.border,
    borderWidth: 0.6,
  });

  if (title) {
    txt(page, title, x + 14, y + h - 24, 12, page.doc.context.lookup as any);
  }
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
  txt(page, value, x + 10, y + 14, 13.5, bold, color);
}

function drawSectionTitle(page: PDFPage, text: string, x: number, y: number, bold: PDFFont) {
  txt(page, text, x, y, 14, bold, C.dark);
  page.drawLine({
    start: { x, y: y - 10 },
    end: { x: 551, y: y - 10 },
    thickness: 0.8,
    color: C.border,
  });
}

function monthlyProduction(report: any) {
  const prod = n(report?.annualProductionKwh);
  const cons = n(report?.yearlyConsumptionKwh);
  const pf = [0.04, 0.05, 0.08, 0.1, 0.12, 0.13, 0.13, 0.12, 0.09, 0.07, 0.04, 0.03];
  const cf = [0.09, 0.09, 0.085, 0.08, 0.075, 0.07, 0.07, 0.075, 0.08, 0.085, 0.09, 0.095];
  return pf.map((f, i) => ({
    month: ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"][i],
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
  const max = Math.max(1, ...data.flatMap((d) => [d.production, d.consumption]));
  const plotX = x + 35;
  const plotY = y + 30;
  const plotW = w - 50;
  const plotH = h - 55;

  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    color: rgb(0.98, 0.99, 0.99),
    borderColor: C.border,
    borderWidth: 0.6,
  });

  for (let i = 0; i <= 4; i++) {
    const yy = plotY + (plotH / 4) * i;
    page.drawLine({
      start: { x: plotX, y: yy },
      end: { x: plotX + plotW, y: yy },
      thickness: 0.35,
      color: rgb(0.86, 0.88, 0.89),
    });
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
    txt(page, d.month.slice(0, 1), px - 3, y + 11, 6.5, font, C.muted);
  });

  page.drawCircle({ x: x + 150, y: y + h - 18, size: 3, color: C.green });
  txt(page, "Produktion", x + 158, y + h - 21, 7.5, font, C.muted);
  page.drawCircle({ x: x + 235, y: y + h - 18, size: 3, color: C.orange });
  txt(page, "Verbrauch", x + 243, y + h - 21, 7.5, font, C.muted);
}

function drawBarChart(args: {
  page: PDFPage;
  values: number[];
  labels?: string[];
  x: number;
  y: number;
  w: number;
  h: number;
  font: PDFFont;
  mode?: "cashflow" | "saving";
}) {
  const { page, values, labels = [], x, y, w, h, font, mode = "saving" } = args;
  const maxAbs = Math.max(1, ...values.map((v) => Math.abs(v)));
  const zeroY = mode === "cashflow" ? y + h * 0.45 : y + 25;
  const plotX = x + 28;
  const plotW = w - 42;
  const barGap = 3;
  const barW = Math.max(3, (plotW - barGap * (values.length - 1)) / values.length);

  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    color: rgb(0.98, 0.99, 0.99),
    borderColor: C.border,
    borderWidth: 0.6,
  });

  page.drawLine({
    start: { x: plotX, y: zeroY },
    end: { x: plotX + plotW, y: zeroY },
    thickness: 0.6,
    color: rgb(0.68, 0.72, 0.74),
  });

  values.forEach((v, i) => {
    const bh = Math.abs(v) / maxAbs * (h - 55);
    const bx = plotX + i * (barW + barGap);
    const by = v >= 0 ? zeroY : zeroY - bh;
    page.drawRectangle({
      x: bx,
      y: by,
      width: barW,
      height: Math.max(1, bh),
      color: v >= 0 ? C.green : C.red,
    });

    if (labels[i] && (values.length <= 12 || i % 5 === 0)) {
      txt(page, labels[i], bx - 1, y + 9, 6.2, font, C.muted);
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
  const segments = 28;
  const active = Math.round((Math.max(0, Math.min(100, pct)) / 100) * segments);

  for (let i = 0; i < active; i++) {
    const a = (-90 + (360 / segments) * i) * (Math.PI / 180);
    const r = size;
    page.drawCircle({
      x: x + Math.cos(a) * r * 0.72,
      y: y + Math.sin(a) * r * 0.72,
      size: size * 0.12,
      color: C.green,
    });
  }

  page.drawCircle({ x, y, size: size * 0.58, color: C.white });
  txt(page, fmtPct(pct, 1), x - 18, y - 4, 12, bold, C.dark);
  txt(page, "Eigenverbrauch", x - 28, y - 18, 6.5, font, C.muted);
}

function drawParagraph(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  maxChars: number,
  lineHeight: number,
  font: PDFFont,
  size = 8.5,
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

function addEnergieflussPage(pdf: PDFDocument, data: ReportPagesData, font: PDFFont, bold: PDFFont) {
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
    data: monthlyProduction(r),
    x: 44,
    y: 400,
    w: 507,
    h: 215,
    font,
  });

  drawSectionTitle(page, "Einordnung", 44, 345, bold);

  const text =
    `Die geplante Photovoltaikanlage erzeugt voraussichtlich ${fmtNum(r.annualProductionKwh)} kWh Solarstrom pro Jahr. ` +
    `Davon werden rund ${fmtPct(r.selfUseSharePct)} direkt im Gebäude genutzt. ` +
    `Der Autarkiegrad von ${fmtPct(r.autarkyPct)} zeigt, welchen Anteil des jährlichen Strombedarfs die Anlage rechnerisch abdecken kann. ` +
    `Je höher der Eigenverbrauch, desto stärker reduziert sich der Bezug von Netzstrom und desto wirtschaftlicher arbeitet die Anlage im Alltag.`;

  drawParagraph(page, text, 44, 315, 105, 13, font, 8.8, C.dark);

  page.drawRectangle({
    x: 44,
    y: 98,
    width: 507,
    height: 72,
    color: rgb(0.95, 0.98, 0.97),
    borderColor: C.border,
    borderWidth: 0.6,
  });

  txt(page, "Hinweis", 58, 145, 8.5, bold, C.teal);
  drawParagraph(
    page,
    "Die tatsächlichen Werte können je nach Wetter, Verbrauchsprofil, Verschattung und Betriebsverhalten abweichen.",
    58,
    129,
    100,
    12,
    font,
    8,
    C.dark
  );

  footer(page, font, data.companyName);
}

function addWirtschaftlichkeitPage(pdf: PDFDocument, data: ReportPagesData, font: PDFFont, bold: PDFFont) {
  const r = data.reportSummary || {};
  const offer = data.offer || {};
  const page = pdf.addPage([PAGE_W, PAGE_H]);

  header(page, font, bold, "Wirtschaftlichkeit", data.planningNumber);

  txt(
    page,
    "Finanzielle Übersicht der Investition, Förderungen und erwarteten Amortisation.",
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
    w: 155,
    h: 48,
    label: "Break-even",
    value: r.breakEvenYears != null ? `${fmtNum(r.breakEvenYears, 1)} J.` : "—",
    font,
    bold,
    color: rgb(0.22, 0.48, 0.78),
  });

  drawKpi({
    page,
    x: 219,
    y: 685,
    w: 155,
    h: 48,
    label: "Investition",
    value: fmtChf(r.totalInvestmentChf ?? offer?.pricing?.totalInvestmentChf),
    font,
    bold,
  });

  drawKpi({
    page,
    x: 396,
    y: 685,
    w: 155,
    h: 48,
    label: "Rendite",
    value: r.roiPct != null ? fmtPct(r.roiPct) : "—",
    font,
    bold,
    color: C.green,
  });

  page.drawRectangle({
    x: 44,
    y: 625,
    width: 507,
    height: 36,
    color: rgb(0.95, 0.98, 0.97),
    borderColor: C.border,
    borderWidth: 0.6,
  });

  txt(page, "PV Einmalvergütung", 58, 646, 8, font, C.muted);
  txt(page, fmtChf(r.automaticPvSubsidyChf), 165, 646, 8.5, bold, C.dark);

  txt(page, "Weitere Förderungen", 270, 646, 8, font, C.muted);
  txt(page, fmtChf(r.manualAdditionalSubsidyChf), 385, 646, 8.5, bold, C.dark);

  rightTxt(page, `Total ${fmtChf(r.subsidyChf)}`, 535, 646, 8.5, bold, C.green);

  drawSectionTitle(page, "Kumulierter Cashflow über 25 Jahre", 44, 585, bold);

  const investment = n(r.totalInvestmentChf ?? offer?.pricing?.totalInvestmentChf);
  const annual = n(r.annualBenefitChf);
  const cashflow = Array.from({ length: 26 }, (_, i) => Math.round(-investment + annual * i));

  drawBarChart({
    page,
    values: cashflow,
    labels: Array.from({ length: 26 }, (_, i) => String(i)),
    x: 44,
    y: 330,
    w: 507,
    h: 225,
    font,
    mode: "cashflow",
  });

  drawSectionTitle(page, "Bewertung", 44, 275, bold);

  const text =
    `Die Investition amortisiert sich rechnerisch nach etwa ${r.breakEvenYears != null ? fmtNum(r.breakEvenYears, 1) : "—"} Jahren. ` +
    `Über die Nutzungsdauer entsteht der wirtschaftliche Vorteil vor allem durch reduzierten Netzstrombezug, Einspeisevergütung und verfügbare Förderbeiträge. ` +
    `Die ausgewiesenen Werte dienen als Entscheidungsgrundlage und basieren auf den aktuell hinterlegten Annahmen.`;

  drawParagraph(page, text, 44, 245, 105, 13, font, 8.8, C.dark);

  footer(page, font, data.companyName);
}

function addProduktionErsparnisPage(pdf: PDFDocument, data: ReportPagesData, font: PDFFont, bold: PDFFont) {
  const r = data.reportSummary || {};
  const page = pdf.addPage([PAGE_W, PAGE_H]);

  header(page, font, bold, "Produktion & Ersparnis", data.planningNumber);

  txt(
    page,
    "Technische Kennzahlen der geplanten Anlage und erwarteter finanzieller Nutzen.",
    44,
    748,
    9.5,
    font,
    C.muted
  );

  drawSectionTitle(page, "Produktion", 44, 715, bold);

  const leftX = 44;
  const rightX = 315;
  const y0 = 680;
  const rowH = 24;

  const rows = [
    ["Jahresproduktion", `${fmtNum(r.annualProductionKwh)} kWh`, "Spez. Ertrag", `${fmtNum(r.yearlyYieldKwhPerKwp)} kWh/kWp`],
    ["Modulleistung", `${fmtNum(r.selectedPanelWp)} Wp`, "Anzahl Module", `${fmtNum(r.moduleCount)} Stk.`],
    ["Dachflächen", `${fmtNum(r.roofCount)} Fläche${n(r.roofCount) === 1 ? "" : "n"}`, "Belegte Fläche", `${fmtNum(r.moduleAreaM2, 1)} m²`],
  ];

  rows.forEach((row, i) => {
    const yy = y0 - i * rowH;
    txt(page, row[0], leftX, yy, 8, font, C.muted);
    rightTxt(page, row[1], 260, yy, 8.8, bold, C.dark);
    txt(page, row[2], rightX, yy, 8, font, C.muted);
    rightTxt(page, row[3], 551, yy, 8.8, bold, C.dark);

    page.drawLine({
      start: { x: leftX, y: yy - 8 },
      end: { x: 551, y: yy - 8 },
      thickness: 0.45,
      color: C.border,
    });
  });

  page.drawRectangle({
    x: 44,
    y: 455,
    width: 230,
    height: 130,
    color: C.light,
    borderColor: C.border,
    borderWidth: 0.6,
  });

  txt(page, "Eigenverbrauch / Einspeisung", 58, 560, 10, bold, C.dark);
  drawDonut({
    page,
    x: 135,
    y: 510,
    size: 38,
    pct: n(r.selfUseSharePct),
    font,
    bold,
  });

  txt(page, "Eigenverbrauch", 190, 520, 8, font, C.muted);
  txt(page, fmtPct(r.selfUseSharePct), 190, 506, 10, bold, C.dark);
  txt(page, "Einspeisung", 190, 488, 8, font, C.muted);
  txt(page, fmtPct(100 - n(r.selfUseSharePct)), 190, 474, 10, bold, C.dark);

  page.drawRectangle({
    x: 296,
    y: 455,
    width: 255,
    height: 130,
    color: C.light,
    borderColor: C.border,
    borderWidth: 0.6,
  });

  txt(page, "Nutzen", 310, 560, 10, bold, C.dark);

  const annual = n(r.annualBenefitChf);
  txt(page, "Pro Monat", 310, 535, 8, font, C.muted);
  txt(page, fmtChf(Math.round(annual / 12)), 310, 518, 13, bold, C.dark);

  txt(page, "Pro Jahr", 420, 535, 8, font, C.muted);
  txt(page, fmtChf(annual), 420, 518, 13, bold, C.dark);

  txt(page, "In 20 Jahren", 310, 490, 8, font, C.muted);
  txt(page, fmtChf(annual * 20), 310, 472, 15, bold, C.green);

  drawSectionTitle(page, "Monatliche Ersparnis", 44, 410, bold);

  const factors = [0.04, 0.05, 0.08, 0.1, 0.12, 0.13, 0.13, 0.12, 0.09, 0.07, 0.04, 0.03];
  const labels = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
  const values = factors.map((f) => Math.round(annual * f));

  drawBarChart({
    page,
    values,
    labels,
    x: 44,
    y: 170,
    w: 507,
    h: 205,
    font,
    mode: "saving",
  });

  page.drawRectangle({
    x: 44,
    y: 88,
    width: 507,
    height: 52,
    color: rgb(0.95, 0.98, 0.97),
    borderColor: C.border,
    borderWidth: 0.6,
  });

  txt(page, "Zusammenfassung", 58, 119, 8.5, bold, C.teal);
  drawParagraph(
    page,
    `Die Anlage kombiniert eine erwartete Jahresproduktion von ${fmtNum(r.annualProductionKwh)} kWh mit einem jährlichen Nutzen von rund ${fmtChf(annual)}.`,
    58,
    104,
    105,
    12,
    font,
    8,
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
  addWirtschaftlichkeitPage(pdf, data, font, bold);
  addProduktionErsparnisPage(pdf, data, font, bold);
}