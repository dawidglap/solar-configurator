import { PDFDocument, PDFPage, PDFFont, rgb } from "pdf-lib";

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
  return {
    width: srcW * scale,
    height: srcH * scale,
  };
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
  const muted = rgb(0.43, 0.49, 0.52);
  const dark = rgb(0.14, 0.22, 0.27);

  drawText(page, label, x, y, 7.5, font, muted);
  drawRightText(page, truncate(value, 30), x + width, y, 8, bold, dark);

  page.drawLine({
    start: { x, y: y - 7 },
    end: { x: x + width, y: y - 7 },
    thickness: 0.45,
    color: rgb(0.86, 0.87, 0.88),
  });
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

  drawText(page, label, x + 8, y + h - 15, 7, font, rgb(0.43, 0.49, 0.52));
  drawText(page, value, x + 8, y + 12, 12.5, bold, rgb(0.13, 0.22, 0.27));
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
    const image =
      mime.includes("png") ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);

    const dims = fitCover(image.width, image.height, w, h);

    page.drawImage(image, {
      x: x + (w - dims.width) / 2,
      y: y + (h - dims.height) / 2,
      width: dims.width,
      height: dims.height,
    });

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

export async function addProjectOverviewPage(
  pdf: PDFDocument,
  data: ProjectOverviewData
) {
  const page = pdf.addPage([595.28, 841.89]);

  const font = await pdf.embedFont("Helvetica");
  const bold = await pdf.embedFont("Helvetica-Bold");

  const dark = rgb(0.13, 0.22, 0.27);
  const muted = rgb(0.38, 0.45, 0.49);
  const teal = rgb(0.12, 0.32, 0.37);

  page.drawRectangle({
    x: 0,
    y: 0,
    width: 595.28,
    height: 841.89,
    color: rgb(1, 1, 1),
  });

  drawHeader({
    page,
    font,
    bold,
    title: "Projektübersicht",
    planningNumber: data.planningNumber,
  });

  drawText(
    page,
    "Übersicht der geplanten Photovoltaikanlage auf Basis der aktuellen Modulplanung.",
    44,
    748,
    9.2,
    font,
    muted
  );

  const address = safeString(data.projectAddress) || "—";

  // Top info — sopra immagine, senza overlap
  drawText(page, "Projektadresse", 44, 718, 7.5, font, muted);
  drawText(page, truncate(address, 48), 44, 703, 10.5, bold, dark);

  drawText(page, "Kunde", 335, 718, 7.5, font, muted);
  drawText(page, truncate(data.customerName || "—", 34), 335, 703, 10.5, bold, dark);

  // Snapshot grande ma più basso e più compatto
  const imageX = 44;
  const imageY = 382;
  const imageW = 507;
  const imageH = 285;

  await drawSnapshot({
    pdf,
    page,
    dataUrl: data.projectSnapshotDataUrl,
    x: imageX,
    y: imageY,
    w: imageW,
    h: imageH,
    font,
    bold,
  });

  // Overlay dentro immagine, senza coprire header
  page.drawRectangle({
    x: imageX,
    y: imageY + imageH - 34,
    width: 158,
    height: 34,
    color: rgb(1, 1, 1),
    opacity: 0.86,
  });

  drawText(page, "Modulbelegung", imageX + 12, imageY + imageH - 20, 8.8, bold, dark);
  drawText(page, "aktueller Planungsstand", imageX + 12, imageY + imageH - 30, 6.3, font, muted);

  // KPI cards — subito sotto immagine, con spazio corretto
  const kpiY = 314;
  const cardW = 121;
  const cardH = 48;
  const gap = 7;

  drawKpiCard({
    page,
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
    page,
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
    page,
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
    page,
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

  // Technische Eckdaten
  drawText(page, "Technische Eckdaten", 44, 266, 13, bold, dark);
  page.drawLine({
    start: { x: 44, y: 254 },
    end: { x: 551, y: 254 },
    thickness: 1,
    color: rgb(0.84, 0.86, 0.87),
  });

  const leftX = 44;
  const rightX = 315;
  const rowW = 220;

  let y = 233;

  drawInfoRow({
    page,
    label: "Modultyp",
    value: data.selectedPanelLabel || "—",
    x: leftX,
    y,
    width: rowW,
    font,
    bold,
  });

  drawInfoRow({
    page,
    label: "Wechselrichter",
    value: data.inverterLabel || "—",
    x: rightX,
    y,
    width: rowW,
    font,
    bold,
  });

  y -= 24;

  drawInfoRow({
    page,
    label: "Dachtyp",
    value: data.roofType || "—",
    x: leftX,
    y,
    width: rowW,
    font,
    bold,
  });

  drawInfoRow({
    page,
    label: "Dacheindeckung",
    value: data.roofCovering || "—",
    x: rightX,
    y,
    width: rowW,
    font,
    bold,
  });

  y -= 24;

  drawInfoRow({
    page,
    label: "Batteriespeicher",
    value: data.batteryLabel || "Nicht vorgesehen",
    x: leftX,
    y,
    width: rowW,
    font,
    bold,
  });

  drawInfoRow({
    page,
    label: "Ladestation",
    value: data.wallboxLabel || "Nicht vorgesehen",
    x: rightX,
    y,
    width: rowW,
    font,
    bold,
  });

  // Hinweis box — più basso, senza collisioni
  page.drawRectangle({
    x: 44,
    y: 86,
    width: 507,
    height: 52,
    color: rgb(0.95, 0.97, 0.97),
    borderColor: rgb(0.84, 0.87, 0.87),
    borderWidth: 0.5,
  });

  drawText(page, "Hinweis", 58, 119, 8, bold, teal);
  drawText(
    page,
    "Die Projektübersicht basiert auf dem aktuellen Planungsstand und dient der visuellen Orientierung.",
    58,
    104,
    7.7,
    font,
    dark
  );
  drawText(
    page,
    "Technische Details können sich im Rahmen der Ausführungsplanung und Netzabklärung noch ändern.",
    58,
    91,
    7.7,
    font,
    dark
  );

  drawFooter({
    page,
    font,
    companyName: data.companyName,
  });
}