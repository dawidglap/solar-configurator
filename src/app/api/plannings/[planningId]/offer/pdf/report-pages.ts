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

  const plotLeft = x + 46;
  const plotRight = x + w - 18;
  const plotBottom = y + 34;
  const plotTop = y + h - 24;
  const plotW = plotRight - plotLeft;
  const plotH = plotTop - plotBottom;

  const maxValRaw = Math.max(0, ...values);
  const minValRaw = Math.min(0, ...values);

  const niceMax = Math.ceil(maxValRaw / 10000) * 10000 || 10000;
  const niceMin = mode === "cashflow"
    ? Math.floor(minValRaw / 10000) * 10000
    : 0;

  const range = Math.max(1, niceMax - niceMin);

  const yForValue = (v: number) => {
    return plotBottom + ((v - niceMin) / range) * plotH;
  };

  const zeroY = yForValue(0);

  const barGap = values.length > 18 ? 2 : 4;
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

  // Y-axis grid + labels
  const ticks = 5;
  for (let i = 0; i <= ticks; i++) {
    const val = niceMin + (range / ticks) * i;
    const yy = yForValue(val);

    page.drawLine({
      start: { x: plotLeft, y: yy },
      end: { x: plotRight, y: yy },
      thickness: val === 0 ? 0.7 : 0.35,
      color: val === 0 ? rgb(0.62, 0.66, 0.68) : rgb(0.86, 0.88, 0.89),
    });

    const label =
      Math.abs(val) >= 1000
        ? `${Math.round(val / 1000)}k`
        : `${Math.round(val)}`;

    rightTxt(page, label, plotLeft - 7, yy - 3, 6.5, font, C.muted);
  }

  values.forEach((v, i) => {
    const bx = plotLeft + i * (barW + barGap);
    const vy = yForValue(v);

    const by = v >= 0 ? zeroY : vy;
    const bh = Math.max(1, Math.abs(vy - zeroY));

    page.drawRectangle({
      x: bx,
      y: by,
      width: barW,
      height: bh,
      color: v >= 0 ? C.green : C.red,
    });

    if (labels[i] && (values.length <= 12 || i % 5 === 0)) {
      txt(page, labels[i], bx - 1, y + 12, 6.2, font, C.muted);
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

function addProduktionPage(pdf: PDFDocument, data: ReportPagesData, font: PDFFont, bold: PDFFont) {
  const r = data.reportSummary || {};
  const page = pdf.addPage([PAGE_W, PAGE_H]);

  header(page, font, bold, "Produktion", data.planningNumber);

  txt(page, "Technische Kennzahlen der geplanten Photovoltaikanlage.", 44, 748, 9.5, font, C.muted);

  drawKpi({ page, x: 44, y: 685, w: 155, h: 48, label: "Jahresproduktion", value: `${fmtNum(r.annualProductionKwh)} kWh`, font, bold, color: C.green });
  drawKpi({ page, x: 219, y: 685, w: 155, h: 48, label: "Spez. Ertrag", value: `${fmtNum(r.yearlyYieldKwhPerKwp)} kWh/kWp`, font, bold });
  drawKpi({ page, x: 396, y: 685, w: 155, h: 48, label: "Anlagenleistung", value: `${fmtNum(r.dcPowerKw, 2)} kWp`, font, bold });

  drawSectionTitle(page, "Anlagendaten", 44, 630, bold);

  const rows = [
    ["Modulleistung", `${fmtNum(r.selectedPanelWp)} Wp`],
    ["Anzahl Module", `${fmtNum(r.moduleCount)} Stk.`],
    ["Dachflächen", `${fmtNum(r.roofCount)} Fläche${n(r.roofCount) === 1 ? "" : "n"}`],
    ["Belegte Fläche", `${fmtNum(r.moduleAreaM2, 1)} m²`],
    ["Durchschnittliche Dachneigung", `${fmtNum(r.avgRoofTiltDeg, 1)}°`],
  ];

  let y = 595;
  rows.forEach(([label, value]) => {
    txt(page, label, 44, y, 8.5, font, C.muted);
    rightTxt(page, value, 551, y, 9.2, bold, C.dark);
    page.drawLine({
      start: { x: 44, y: y - 8 },
      end: { x: 551, y: y - 8 },
      thickness: 0.45,
      color: C.border,
    });
    y -= 28;
  });

  drawSectionTitle(page, "Eigenverbrauch / Einspeisung", 44, 420, bold);

  page.drawRectangle({
    x: 44,
    y: 230,
    width: 230,
    height: 150,
    color: C.light,
    borderColor: C.border,
    borderWidth: 0.6,
  });

  drawDonut({
    page,
    x: 159,
    y: 305,
    size: 45,
    pct: n(r.selfUseSharePct),
    font,
    bold,
  });

  page.drawRectangle({
    x: 296,
    y: 230,
    width: 255,
    height: 150,
    color: C.light,
    borderColor: C.border,
    borderWidth: 0.6,
  });

  txt(page, "Eigenverbrauch", 316, 340, 8, font, C.muted);
  txt(page, `${fmtNum(r.selfUseKwh)} kWh`, 316, 322, 14, bold, C.dark);
  txt(page, fmtPct(r.selfUseSharePct), 445, 322, 14, bold, C.green);

  txt(page, "Einspeisung", 316, 285, 8, font, C.muted);
  txt(page, `${fmtNum(r.feedInKwh)} kWh`, 316, 267, 14, bold, C.dark);
  txt(page, fmtPct(100 - n(r.selfUseSharePct)), 445, 267, 14, bold, C.gray);

  drawSectionTitle(page, "Einordnung", 44, 185, bold);

  drawParagraph(
    page,
    `Die Anlage erzeugt voraussichtlich ${fmtNum(r.annualProductionKwh)} kWh Solarstrom pro Jahr. Bei ${fmtNum(r.moduleCount)} Modulen ergibt sich eine Anlagenleistung von ${fmtNum(r.dcPowerKw, 2)} kWp. Der direkte Eigenverbrauch liegt bei rund ${fmtPct(r.selfUseSharePct)}.`,
    44,
    155,
    105,
    13,
    font,
    8.8,
    C.dark
  );

  footer(page, font, data.companyName);
}

function addErsparnisPage(pdf: PDFDocument, data: ReportPagesData, font: PDFFont, bold: PDFFont) {
  const r = data.reportSummary || {};
  const page = pdf.addPage([PAGE_W, PAGE_H]);

  const annual = n(r.annualBenefitChf);

  header(page, font, bold, "Ersparnis", data.planningNumber);

  txt(page, "Erwarteter finanzieller Nutzen durch Eigenverbrauch und Einspeisung.", 44, 748, 9.5, font, C.muted);

  drawKpi({ page, x: 44, y: 685, w: 155, h: 48, label: "Pro Monat", value: fmtChf(Math.round(annual / 12)), font, bold });
  drawKpi({ page, x: 219, y: 685, w: 155, h: 48, label: "Pro Jahr", value: fmtChf(annual), font, bold });
  drawKpi({ page, x: 396, y: 685, w: 155, h: 48, label: "In 20 Jahren", value: fmtChf(annual * 20), font, bold, color: C.green });

  drawSectionTitle(page, "Monatliche Ersparnis", 44, 630, bold);

  const factors = [0.04, 0.05, 0.08, 0.1, 0.12, 0.13, 0.13, 0.12, 0.09, 0.07, 0.04, 0.03];
  const labels = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
  const values = factors.map((f) => Math.round(annual * f));

  drawBarChart({
    page,
    values,
    labels,
    x: 44,
    y: 360,
    w: 507,
    h: 235,
    font,
    mode: "saving",
  });

  drawSectionTitle(page, "Zusammensetzung", 44, 305, bold);

  drawKpi({
    page,
    x: 44,
    y: 230,
    w: 240,
    h: 50,
    label: "Ersparnis Eigenverbrauch",
    value: fmtChf(r.annualSavingsChf),
    font,
    bold,
    color: C.green,
  });

  drawKpi({
    page,
    x: 311,
    y: 230,
    w: 240,
    h: 50,
    label: "Einspeisevergütung",
    value: fmtChf(r.annualFeedInRevenueChf),
    font,
    bold,
    color: C.orange,
  });

  drawSectionTitle(page, "Einordnung", 44, 180, bold);

  drawParagraph(
    page,
    `Der jährliche Nutzen beträgt rechnerisch rund ${fmtChf(annual)}. Dieser setzt sich aus eingespartem Netzstrom durch Eigenverbrauch und Erlösen aus der Einspeisung zusammen. Über 20 Jahre ergibt sich daraus ein potenzieller Vorteil von rund ${fmtChf(annual * 20)}.`,
    44,
    150,
    105,
    13,
    font,
    8.8,
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
  addProduktionPage(pdf, data, font, bold);
addErsparnisPage(pdf, data, font, bold);
}