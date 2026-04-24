import {
  PDFDocument,
  PDFPage,
  PDFFont,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  rectangle,
  clip,
  endPath,
} from "pdf-lib";

type ProjectOverviewData = {
  title?: string;
  planningNumber?: string;
  projectSnapshotDataUrl?: string;

  customerName?: string;
  projectAddress?: string;

  dcPowerKw?: number;
  moduleCount?: number;
  roofCount?: number;
  selectedPanelLabel?: string;
  inverterLabel?: string;
  batteryLabel?: string;
  wallboxLabel?: string;

  roofType?: string;
  roofCovering?: string;
  electricityUsageKwh?: number;

  companyName?: string;
};

function safeString(v: unknown) {
  return typeof v === "string" ? v.trim() : "";
}

function safeNumber(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function formatNumber(n?: number, digits = 2) {
  return new Intl.NumberFormat("de-CH", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(safeNumber(n, 0));
}

function formatInt(n?: number) {
  return new Intl.NumberFormat("de-CH", {
    maximumFractionDigits: 0,
  }).format(safeNumber(n, 0));
}

function truncate(text: string, max = 70) {
  if (!text) return "—";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function drawText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  size: number,
  font: PDFFont,
  color = rgb(0.16, 0.24, 0.28)
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
  color = rgb(0.16, 0.24, 0.28)
) {
  const w = font.widthOfTextAtSize(text, size);
  drawText(page, text, rightX - w, y, size, font, color);
}

function dataUrlToBytes(dataUrl?: string | null) {
  const s = safeString(dataUrl);
  if (!s.startsWith("data:image/")) return null;

  const comma = s.indexOf(",");
  if (comma < 0) return null;

  try {
    return Buffer.from(s.slice(comma + 1), "base64");
  } catch {
    return null;
  }
}

function dataUrlMime(dataUrl?: string | null) {
  const s = safeString(dataUrl);
  const m = s.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
  return m?.[1] || "";
}

function fitCover(srcW: number, srcH: number, boxW: number, boxH: number) {
  const scale = Math.max(boxW / srcW, boxH / srcH);
  return { width: srcW * scale, height: srcH * scale };
}

function drawHeader(args: {
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  title: string;
  planningNumber?: string;
}) {
  const { page, font, bold, title, planningNumber } = args;

  const dark = rgb(0.13, 0.22, 0.27);
  const muted = rgb(0.38, 0.45, 0.49);
  const teal = rgb(0.12, 0.32, 0.37);

  drawText(page, title, 44, 792, 19, bold, dark);

  if (planningNumber) {
    drawRightText(page, `Offerte Nr. ${planningNumber}`, 551, 797, 8.8, font, muted);
  }

  page.drawLine({
    start: { x: 44, y: 778 },
    end: { x: 551, y: 778 },
    thickness: 2,
    color: teal,
  });
}

function drawFooter(args: {
  page: PDFPage;
  font: PDFFont;
  pageNumber?: string;
  companyName?: string;
}) {
  const { page, font, pageNumber, companyName } = args;
  const muted = rgb(0.48, 0.54, 0.57);

  page.drawLine({
    start: { x: 44, y: 42 },
    end: { x: 551, y: 42 },
    thickness: 0.6,
    color: rgb(0.83, 0.85, 0.86),
  });

  drawText(page, companyName || "HELIONIC", 44, 27, 7.5, font, muted);

  if (pageNumber) {
    drawRightText(page, pageNumber, 551, 27, 7.5, font, muted);
  }
}

function drawKpiCard(args: {
  page: PDFPage;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  value: string;
  font: PDFFont;
  bold: PDFFont;
}) {
  const { page, x, y, w, h, label, value, font, bold } = args;

  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    color: rgb(0.96, 0.97, 0.97),
    borderColor: rgb(0.86, 0.88, 0.89),
    borderWidth: 0.5,
  });

  drawText(page, label, x + 10, y + h - 17, 7.3, font, rgb(0.43, 0.49, 0.52));
  drawText(page, value, x + 10, y + 14, 14, bold, rgb(0.13, 0.22, 0.27));
}

function drawInfoRow(args: {
  page: PDFPage;
  label: string;
  value: string;
  x: number;
  y: number;
  width: number;
  font: PDFFont;
  bold: PDFFont;
}) {
  const { page, label, value, x, y, width, font, bold } = args;

  drawText(page, label, x, y, 8, font, rgb(0.43, 0.49, 0.52));
  drawRightText(
    page,
    truncate(value, 34),
    x + width,
    y,
    8.5,
    bold,
    rgb(0.14, 0.22, 0.27)
  );

  page.drawLine({
    start: { x, y: y - 7 },
    end: { x: x + width, y: y - 7 },
    thickness: 0.45,
    color: rgb(0.86, 0.87, 0.88),
  });
}

async function drawSnapshot(args: {
  pdf: PDFDocument;
  page: PDFPage;
  dataUrl?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  font: PDFFont;
  bold: PDFFont;
}) {
  const { pdf, page, dataUrl, x, y, w, h, font, bold } = args;

  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    color: rgb(0.94, 0.95, 0.95),
    borderColor: rgb(0.82, 0.84, 0.85),
    borderWidth: 0.7,
  });

  const bytes = dataUrlToBytes(dataUrl);
  const mime = dataUrlMime(dataUrl);

  if (!bytes) {
    drawText(page, "Projektbild nicht verfügbar", x + 20, y + h / 2 + 8, 12, bold);
    drawText(
      page,
      "Bitte Snapshot in der Modulplanung erfassen und PDF erneut generieren.",
      x + 20,
      y + h / 2 - 9,
      8,
      font,
      rgb(0.42, 0.48, 0.52)
    );
    return;
  }

  try {
    const image = mime.includes("png")
      ? await pdf.embedPng(bytes)
      : await pdf.embedJpg(bytes);

const labelH = 36;

// area immagine: sotto la label "Modulbelegung"
const imgX = x;
const imgY = y;
const imgWBox = w;
const imgHBox = h;

// cover: riempie tutto il box, anche se deve tagliare
const dims = fitCover(image.width, image.height, imgWBox, imgHBox);

page.pushOperators(
  pushGraphicsState(),
  rectangle(imgX, imgY, imgWBox, imgHBox),
  clip(),
  endPath()
);

page.drawImage(image, {
  x: imgX + (imgWBox - dims.width) / 2,
  y: imgY + (imgHBox - dims.height) / 2,
  width: dims.width,
  height: dims.height,
});

page.pushOperators(popGraphicsState());

    page.drawRectangle({
      x,
      y,
      width: w,
      height: h,
      borderColor: rgb(0.72, 0.75, 0.77),
      borderWidth: 0.8,
    });
  } catch (e) {
    console.warn("PROJECT SNAPSHOT EMBED ERROR:", e);
    drawText(page, "Projektbild konnte nicht eingebettet werden", x + 20, y + h / 2, 10, bold);
  }
}

function drawPageBackground(page: PDFPage) {
  page.drawRectangle({
    x: 0,
    y: 0,
    width: 595.28,
    height: 841.89,
    color: rgb(1, 1, 1),
  });
}

export async function addProjectOverviewPage(
  pdf: PDFDocument,
  data: ProjectOverviewData
) {
  const font = await pdf.embedFont("Helvetica");
  const bold = await pdf.embedFont("Helvetica-Bold");

  const dark = rgb(0.13, 0.22, 0.27);
  const muted = rgb(0.38, 0.45, 0.49);
  const teal = rgb(0.12, 0.32, 0.37);

  /**
   * PAGE 1 — big clean image + project basics
   */
  const page1 = pdf.addPage([595.28, 841.89]);
  drawPageBackground(page1);

  drawHeader({
    page: page1,
    font,
    bold,
    title: "Projektübersicht",
    planningNumber: data.planningNumber,
  });

  drawText(
    page1,
    "Übersicht der geplanten Photovoltaikanlage auf Basis der aktuellen Modulplanung.",
    44,
    748,
    9.5,
    font,
    muted
  );

  drawText(page1, "Projektadresse", 44, 720, 8, font, muted);
  drawText(page1, truncate(safeString(data.projectAddress) || "—", 64), 44, 704, 11.5, bold, dark);

  drawText(page1, "Kunde", 335, 720, 8, font, muted);
  drawText(page1, truncate(data.customerName || "—", 42), 335, 704, 11.5, bold, dark);

  await drawSnapshot({
    pdf,
    page: page1,
    dataUrl: data.projectSnapshotDataUrl,
    x: 44,
    y: 235,
    w: 507,
    h: 430,
    font,
    bold,
  });

  page1.drawRectangle({
    x: 44,
    y: 235 + 430 - 36,
    width: 175,
    height: 36,
    color: rgb(1, 1, 1),
    opacity: 0.88,
  });

  drawText(page1, "Modulbelegung", 58, 235 + 430 - 20, 10, bold, dark);
  drawText(page1, "aktueller Planungsstand", 58, 235 + 430 - 32, 6.8, font, muted);

  const kpiY = 148;
  const cardW = 120;
  const cardH = 54;
  const gap = 9;

  drawKpiCard({
    page: page1,
    x: 44,
    y: kpiY,
    w: cardW,
    h: cardH,
    label: "PV-Leistung",
    value: `${formatNumber(data.dcPowerKw, 2)} kWp`,
    font,
    bold,
  });

  drawKpiCard({
    page: page1,
    x: 44 + cardW + gap,
    y: kpiY,
    w: cardW,
    h: cardH,
    label: "PV-Module",
    value: `${formatInt(data.moduleCount)} Stk.`,
    font,
    bold,
  });

  drawKpiCard({
    page: page1,
    x: 44 + (cardW + gap) * 2,
    y: kpiY,
    w: cardW,
    h: cardH,
    label: "Dachflächen",
    value: `${formatInt(data.roofCount)} Fläche${safeNumber(data.roofCount) === 1 ? "" : "n"}`,
    font,
    bold,
  });

  drawKpiCard({
    page: page1,
    x: 44 + (cardW + gap) * 3,
    y: kpiY,
    w: cardW,
    h: cardH,
    label: "Jahresverbrauch",
    value: data.electricityUsageKwh
      ? `${formatInt(data.electricityUsageKwh)} kWh`
      : "—",
    font,
    bold,
  });

  drawFooter({
    page: page1,
    font,
    pageNumber: "Projektübersicht 1/2",
    companyName: data.companyName,
  });

  /**
   * PAGE 2 — technical data only, no overlap
   */
  const page2 = pdf.addPage([595.28, 841.89]);
  drawPageBackground(page2);

  drawHeader({
    page: page2,
    font,
    bold,
    title: "Technische Eckdaten",
    planningNumber: data.planningNumber,
  });

  drawText(
    page2,
    "Zusammenfassung der wichtigsten technischen Projektparameter.",
    44,
    748,
    9.5,
    font,
    muted
  );

  const leftX = 44;
  const rightX = 315;
  const rowW = 220;

  let y = 700;

  drawInfoRow({
    page: page2,
    label: "Modultyp",
    value: data.selectedPanelLabel || "—",
    x: leftX,
    y,
    width: rowW,
    font,
    bold,
  });

  drawInfoRow({
    page: page2,
    label: "Wechselrichter",
    value: data.inverterLabel || "—",
    x: rightX,
    y,
    width: rowW,
    font,
    bold,
  });

  y -= 34;

  drawInfoRow({
    page: page2,
    label: "Dachtyp",
    value: data.roofType || "—",
    x: leftX,
    y,
    width: rowW,
    font,
    bold,
  });

  drawInfoRow({
    page: page2,
    label: "Dacheindeckung",
    value: data.roofCovering || "—",
    x: rightX,
    y,
    width: rowW,
    font,
    bold,
  });

  y -= 34;

  drawInfoRow({
    page: page2,
    label: "Batteriespeicher",
    value: data.batteryLabel || "Nicht vorgesehen",
    x: leftX,
    y,
    width: rowW,
    font,
    bold,
  });

  drawInfoRow({
    page: page2,
    label: "Ladestation",
    value: data.wallboxLabel || "Nicht vorgesehen",
    x: rightX,
    y,
    width: rowW,
    font,
    bold,
  });

  y -= 60;

  drawText(page2, "Projektkennzahlen", 44, y, 13, bold, dark);
  page2.drawLine({
    start: { x: 44, y: y - 12 },
    end: { x: 551, y: y - 12 },
    thickness: 1,
    color: rgb(0.84, 0.86, 0.87),
  });

  y -= 44;

  drawInfoRow({
    page: page2,
    label: "Installierte DC-Leistung",
    value: `${formatNumber(data.dcPowerKw, 2)} kWp`,
    x: leftX,
    y,
    width: rowW,
    font,
    bold,
  });

  drawInfoRow({
    page: page2,
    label: "Anzahl PV-Module",
    value: `${formatInt(data.moduleCount)} Stk.`,
    x: rightX,
    y,
    width: rowW,
    font,
    bold,
  });

  y -= 34;

  drawInfoRow({
    page: page2,
    label: "Geplante Dachflächen",
    value: `${formatInt(data.roofCount)} Fläche${safeNumber(data.roofCount) === 1 ? "" : "n"}`,
    x: leftX,
    y,
    width: rowW,
    font,
    bold,
  });

  drawInfoRow({
    page: page2,
    label: "Jahresverbrauch",
    value: data.electricityUsageKwh
      ? `${formatInt(data.electricityUsageKwh)} kWh`
      : "—",
    x: rightX,
    y,
    width: rowW,
    font,
    bold,
  });

  page2.drawRectangle({
    x: 44,
    y: 130,
    width: 507,
    height: 76,
    color: rgb(0.95, 0.97, 0.97),
    borderColor: rgb(0.84, 0.87, 0.87),
    borderWidth: 0.5,
  });

  drawText(page2, "Hinweis", 58, 182, 8.5, bold, teal);
  drawText(
    page2,
    "Die Projektübersicht basiert auf dem aktuellen Planungsstand und dient der visuellen Orientierung.",
    58,
    164,
    8,
    font,
    dark
  );
  drawText(
    page2,
    "Technische Details können sich im Rahmen der Ausführungsplanung, Netzabklärung und finalen",
    58,
    150,
    8,
    font,
    dark
  );
  drawText(
    page2,
    "Projektprüfung noch ändern.",
    58,
    136,
    8,
    font,
    dark
  );

  drawFooter({
    page: page2,
    font,
    pageNumber: "Projektübersicht 2/2",
    companyName: data.companyName,
  });
}