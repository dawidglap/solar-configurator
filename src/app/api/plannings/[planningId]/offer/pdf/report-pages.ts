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
  light: rgb(1, 1, 1),
  soft: rgb(0.97, 0.985, 0.98),
  border: rgb(0.84, 0.87, 0.88),
  teal: rgb(0.12, 0.32, 0.37),
  green: rgb(0.22, 0.72, 0.56),
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

function drawCard(args: {
  page: PDFPage;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  bold: PDFFont;
}) {
  const { page, x, y, w, h, title, bold } = args;

  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    color: C.white,
    borderColor: C.border,
    borderWidth: 0.7,
  });

  txt(page, title, x + 12, y + h - 22, 11.5, bold, C.dark);

  page.drawLine({
    start: { x: x + 12, y: y + h - 31 },
    end: { x: x + w - 12, y: y + h - 31 },
    thickness: 0.5,
    color: C.border,
  });
}

function drawMiniKpi(args: {
  page: PDFPage;
  x: number;
  y: number;
  w: number;
  label: string;
  value: string;
  font: PDFFont;
  bold: PDFFont;
  color?: any;
}) {
  const { page, x, y, w, label, value, font, bold, color = C.dark } = args;

  page.drawRectangle({
    x,
    y,
    width: w,
    height: 35,
    color: C.soft,
    borderColor: C.border,
    borderWidth: 0.45,
  });

  txt(page, label, x + 8, y + 21, 6.2, font, C.muted);
  txt(page, value, x + 8, y + 8, 8.7, bold, color);
}

function drawParagraph(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  maxChars: number,
  lineHeight: number,
  font: PDFFont,
  size = 7.3,
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

  const plotX = x + 34;
  const plotY = y + 24;
  const plotW = w - 46;
  const plotH = h - 48;

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
    page.drawLine({
      start: point(data[i].production, i),
      end: point(data[i + 1].production, i + 1),
      thickness: 1.6,
      color: C.green,
    });

    page.drawLine({
      start: point(data[i].consumption, i),
      end: point(data[i + 1].consumption, i + 1),
      thickness: 1.6,
      color: C.orange,
    });
  }

  data.forEach((d, i) => {
    const px = plotX + (plotW / (data.length - 1)) * i;
    txt(page, d.month, px - 1.5, y + 8, 5.4, font, C.muted);
  });

  page.drawCircle({ x: x + 76, y: y + h - 12, size: 2.3, color: C.green });
  txt(page, "Produktion", x + 82, y + h - 14, 5.8, font, C.muted);

  page.drawCircle({ x: x + 145, y: y + h - 12, size: 2.3, color: C.orange });
  txt(page, "Verbrauch", x + 151, y + h - 14, 5.8, font, C.muted);
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

  const plotX = x + 36;
  const plotY = y + 23;
  const plotW = w - 48;
  const plotH = h - 47;

  const valueToY = (value: number) => {
    const range = top - bottom || 1;
    return plotY + ((value - bottom) / range) * plotH;
  };

  const zeroY = valueToY(0);

  for (let i = 0; i <= 3; i++) {
    const value = bottom + ((top - bottom) / 3) * i;
    const yy = valueToY(value);

    page.drawLine({
      start: { x: plotX, y: yy },
      end: { x: plotX + plotW, y: yy },
      thickness: 0.3,
      color: rgb(0.86, 0.88, 0.89),
    });

    rightTxt(page, fmtAxis(value), plotX - 6, yy - 2, 5.2, font, C.muted);
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
    "Die wichtigsten Ergebnisse der geplanten Photovoltaikanlage auf einen Blick.",
    44,
    748,
    9,
    font,
    C.muted
  );

  const gapX = 14;
  const gapY = 18;
  const colW = (CONTENT_WIDTH - gapX) / 2;
  const leftX = 44;
  const rightX = leftX + colW + gapX;

  // ✅ usa quasi tutto lo spazio verticale disponibile
  const cardH = 321;
  const bottomY = 70;
  const topY = bottomY + cardH + gapY;

  const annual = n(r.annualBenefitChf);
  const investment = n(r.totalInvestmentChf ?? offer?.pricing?.totalInvestmentChf);
  const selfUse = n(r.selfUseSharePct);
  const feedIn = Math.max(0, 100 - selfUse);

  const savingFactors = [0.04, 0.05, 0.08, 0.1, 0.12, 0.13, 0.13, 0.12, 0.09, 0.07, 0.04, 0.03];
  const savingLabels = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
  const savingValues = savingFactors.map((f) => Math.round(annual * f));

  // ───────────────── Energiefluss ─────────────────
  drawCard({
    page,
    x: leftX,
    y: topY,
    w: colW,
    h: cardH,
    title: "Energiefluss",
    bold,
  });

  drawMiniKpi({
    page,
    x: leftX + 12,
    y: topY + 242,
    w: 103,
    label: "Eigenverbrauch",
    value: fmtPct(r.selfUseSharePct),
    font,
    bold,
    color: C.green,
  });

  drawMiniKpi({
    page,
    x: leftX + 126,
    y: topY + 242,
    w: 103,
    label: "Autarkie",
    value: fmtPct(r.autarkyPct),
    font,
    bold,
    color: C.green,
  });

  drawLineChart({
    page,
    data: monthlyEnergy(r),
    x: leftX + 12,
    y: topY + 112,
    w: colW - 24,
    h: 112,
    font,
  });

  drawParagraph(
    page,
    "Der grüne Verlauf zeigt die monatliche Solarproduktion. Die orange Linie zeigt den geschätzten Stromverbrauch. Je stärker sich beide Linien überschneiden, desto mehr Solarstrom kann direkt im Gebäude genutzt werden.",
    leftX + 12,
    topY + 84,
    72,
    8.8,
    font,
    6.8,
    C.dark
  );

  // ───────────────── Wirtschaftlichkeit ─────────────────
  drawCard({
    page,
    x: rightX,
    y: topY,
    w: colW,
    h: cardH,
    title: "Wirtschaftlichkeit",
    bold,
  });

  drawMiniKpi({
    page,
    x: rightX + 12,
    y: topY + 242,
    w: 68,
    label: "Break-even",
    value: r.breakEvenYears != null ? `${fmtNum(r.breakEvenYears, 1)} J.` : "—",
    font,
    bold,
    color: rgb(0.22, 0.48, 0.78),
  });

  drawMiniKpi({
    page,
    x: rightX + 88,
    y: topY + 242,
    w: 83,
    label: "Investition",
    value: fmtChf(investment),
    font,
    bold,
  });

  drawMiniKpi({
    page,
    x: rightX + 179,
    y: topY + 242,
    w: 50,
    label: "Rendite",
    value: r.roiPct != null ? fmtPct(r.roiPct) : "—",
    font,
    bold,
    color: C.green,
  });

  page.drawRectangle({
    x: rightX + 12,
    y: topY + 203,
    width: colW - 24,
    height: 27,
    color: C.soft,
    borderColor: C.border,
    borderWidth: 0.45,
  });

  txt(page, "Förderbeiträge total", rightX + 22, topY + 214, 6.7, font, C.muted);
  rightTxt(page, fmtChf(r.subsidyChf), rightX + colW - 22, topY + 214, 8.3, bold, C.green);

  const cashflow = Array.from({ length: 26 }, (_, i) =>
    Math.round(-investment + annual * i)
  );

  drawBarChart({
    page,
    values: cashflow,
    labels: Array.from({ length: 26 }, (_, i) => String(i)),
    x: rightX + 12,
    y: topY + 108,
    w: colW - 24,
    h: 82,
    font,
    mode: "cashflow",
  });

  drawParagraph(
    page,
    "Die Balken zeigen den kumulierten finanziellen Effekt über 25 Jahre. Am Anfang ist die Investition negativ. Sobald die jährlichen Vorteile die Investition ausgleichen, ist der rechnerische Break-even erreicht.",
    rightX + 12,
    topY + 82,
    72,
    8.8,
    font,
    6.8,
    C.dark
  );

  // ───────────────── Produktion ─────────────────
  drawCard({
    page,
    x: leftX,
    y: bottomY,
    w: colW,
    h: cardH,
    title: "Produktion",
    bold,
  });

  txt(
    page,
    `${fmtNum(r.moduleCount)} × ${r.selectedPanelName || "PV Modul"}`,
    leftX + 12,
    bottomY + 270,
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

  let py = bottomY + 245;

  prodRows.forEach((row, i) => {
    const x = i % 2 === 0 ? leftX + 12 : leftX + 132;
    if (i % 2 === 0 && i > 0) py -= 38;

    txt(page, row[0], x, py, 6.8, font, C.muted);
    txt(page, row[1], x, py - 13, 8.2, bold, C.dark);
  });

  page.drawLine({
    start: { x: leftX + 12, y: bottomY + 132 },
    end: { x: leftX + colW - 12, y: bottomY + 132 },
    thickness: 0.5,
    color: C.border,
  });

  drawDonut({
    page,
    x: leftX + 58,
    y: bottomY + 93,
    size: 24,
    pct: selfUse,
    font,
    bold,
  });

  txt(page, "Direkt genutzt", leftX + 105, bottomY + 104, 7, font, C.muted);
  txt(page, fmtPct(selfUse), leftX + 105, bottomY + 90, 9, bold, C.dark);

  txt(page, "Eingespeist", leftX + 178, bottomY + 104, 7, font, C.muted);
  txt(page, fmtPct(feedIn), leftX + 178, bottomY + 90, 9, bold, C.dark);

  drawParagraph(
    page,
    "Die Jahresproduktion zeigt die erwartete Strommenge pro Jahr. Der spezifische Ertrag zeigt, wie effizient die Anlage am Standort arbeitet.",
    leftX + 12,
    bottomY + 55,
    72,
    8.8,
    font,
    6.8,
    C.dark
  );

  drawParagraph(
    page,
    "Alle Werte sind Prognosen und können je nach Wetter, Verschattung und Verbrauchsverhalten abweichen.",
    leftX + 12,
    bottomY + 24,
    72,
    8.5,
    font,
    6.5,
    C.muted
  );

  // ───────────────── Ersparnis ─────────────────
  drawCard({
    page,
    x: rightX,
    y: bottomY,
    w: colW,
    h: cardH,
    title: "Ersparnis",
    bold,
  });

  drawMiniKpi({
    page,
    x: rightX + 12,
    y: bottomY + 242,
    w: 68,
    label: "Pro Monat",
    value: fmtChf(Math.round(annual / 12)),
    font,
    bold,
  });

  drawMiniKpi({
    page,
    x: rightX + 88,
    y: bottomY + 242,
    w: 68,
    label: "Pro Jahr",
    value: fmtChf(annual),
    font,
    bold,
  });

  drawMiniKpi({
    page,
    x: rightX + 164,
    y: bottomY + 242,
    w: 65,
    label: "20 Jahre",
    value: fmtChf(annual * 20),
    font,
    bold,
    color: C.green,
  });

  drawBarChart({
    page,
    values: savingValues,
    labels: savingLabels,
    x: rightX + 12,
    y: bottomY + 112,
    w: colW - 24,
    h: 112,
    font,
    mode: "saving",
  });

  drawParagraph(
    page,
    "Die monatliche Ersparnis entsteht durch weniger Strombezug aus dem Netz und durch die Vergütung für eingespeisten Solarstrom. In sonnenstarken Monaten ist der Nutzen typischerweise höher.",
    rightX + 12,
    bottomY + 82,
    72,
    8.8,
    font,
    6.8,
    C.dark
  );

  drawParagraph(
    page,
    "Der tatsächliche Nutzen hängt unter anderem vom Strompreis, Eigenverbrauch und der Netzvergütung ab.",
    rightX + 12,
    bottomY + 42,
    72,
    8.5,
    font,
    6.5,
    C.muted
  );

  footer(page, font, data.companyName);
}

export async function addReportPages(pdf: PDFDocument, data: ReportPagesData) {
  const report = data.reportSummary;
  if (!report) return;

  const font = await pdf.embedFont("Helvetica");
  const bold = await pdf.embedFont("Helvetica-Bold");

  addBerichtOverviewPage(pdf, data, font, bold);
}