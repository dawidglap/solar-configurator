// src/app/api/plannings/[planningId]/offer/pdf/cover-page.ts
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { readFile } from "fs/promises";
import path from "path";

export async function addCoverPage(
  pdf: PDFDocument,
  data: {
    title: string;
    planningNumber: string;
    kWp: number;
    customerName: string;
  }
) {
  const page = pdf.addPage([595.28, 841.89]); // A4 portrait
  const { width, height } = page.getSize();

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  /* ------------------ COLORS ------------------ */

  const white = rgb(1, 1, 1);
  const textDark = rgb(0.17, 0.26, 0.31);      // blu/grigio scuro stile Gama
  const textMuted = rgb(0.28, 0.35, 0.39);
  const lineColor = rgb(0.12, 0.29, 0.33);
  const lightBox = rgb(0.95, 0.95, 0.95);

  /* ------------------ PAGE BACKGROUND ------------------ */

  page.drawRectangle({
    x: 0,
    y: 0,
    width,
    height,
    color: white,
  });

  /* ------------------ LAYOUT ------------------ */

  const sideMargin = 32;         // bianco dx/sx
  const topMargin = 34;          // bianco sopra
  const heroWidth = width - sideMargin * 2;
  const heroHeight = 290;        // più piccola di prima
  const heroX = sideMargin;
  const heroY = height - topMargin - heroHeight;

  /* ------------------ ASSETS FROM /public ------------------ */

  const heroPath = path.join(process.cwd(), "public", "hero-pdf.jpg");
  const logoPath = path.join(process.cwd(), "public", "logo-demo.jpg");

  const heroBytes = await readFile(heroPath);
  const logoBytes = await readFile(logoPath);

  const heroImage = await pdf.embedJpg(heroBytes);
  const logoImage = await pdf.embedJpg(logoBytes);

  /* ------------------ HERO IMAGE ------------------ */

  page.drawImage(heroImage, {
    x: heroX,
    y: heroY,
    width: heroWidth,
    height: heroHeight,
  });

  /* ------------------ LOGO BOX ------------------ */

  const logoBoxX = heroX + 22;
  const logoBoxY = heroY + heroHeight - 96;
  const logoBoxW = 150;
  const logoBoxH = 66;

  page.drawRectangle({
    x: logoBoxX,
    y: logoBoxY,
    width: logoBoxW,
    height: logoBoxH,
    color: white,
  });

  page.drawImage(logoImage, {
    x: logoBoxX + 14,
    y: logoBoxY + 12,
    width: 108,
    height: 40,
  });

  /* ------------------ TITLE / META BOX ------------------ */

  // box sovrapposto alla parte bassa della hero, ma non enorme
  const infoBoxX = heroX + 26;
  const infoBoxW = heroWidth - 52;
  const infoBoxH = 128;
  const infoBoxY = heroY - 34; // sale dentro la hero come da esempio Gama

  page.drawRectangle({
    x: infoBoxX,
    y: infoBoxY,
    width: infoBoxW,
    height: infoBoxH,
    color: lightBox,
  });

  /* ------------------ TITLE ------------------ */

  const safeTitle = (data.title || "Photovoltaik-Anlage").trim();
  const safeKwp = Number.isFinite(data.kWp) ? data.kWp : 0;

  const titleTextY = infoBoxY + infoBoxH - 42;
  page.drawText(safeTitle, {
    x: infoBoxX + 18,
    y: titleTextY,
    size: 20,
    font,
    color: textDark,
  });

  page.drawText(`${safeKwp.toFixed(2)} kWp`, {
    x: infoBoxX + 18,
    y: titleTextY - 44,
    size: 24,
    font: bold,
    color: textDark,
  });

  /* ------------------ UNDERLINE ------------------ */

  const lineY = infoBoxY + 38;
  page.drawLine({
    start: { x: infoBoxX + 18, y: lineY },
    end: { x: infoBoxX + infoBoxW - 18, y: lineY },
    thickness: 4,
    color: lineColor,
  });

  /* ------------------ OFFER NUMBER INSIDE BOX ------------------ */

  page.drawText(`Offerte Nr. ${data.planningNumber || "—"}`, {
    x: infoBoxX + 18,
    y: infoBoxY + 16,
    size: 10,
    font,
    color: textMuted,
  });

  /* ------------------ CUSTOMER GREETING ------------------ */

  const contentX = heroX + 26;
  let y = infoBoxY - 68;

  const customerName = (data.customerName || "").trim();
  const greeting =
    customerName && !/^herr\s/i.test(customerName)
      ? `Herr ${customerName}`
      : customerName || "Herr Kunde";

  page.drawText(greeting, {
    x: contentX,
    y,
    size: 14,
    font: bold,
    color: textDark,
  });

  y -= 28;

  const paragraph =
    "Vielen Dank für Ihr Interesse an einer Zusammenarbeit mit uns. Mit Helionic haben Sie einen erfahrenen und verlässlichen Partner für innovative Photovoltaik-Lösungen an Ihrer Seite.";

  const lines = wrapText(paragraph, 78);
  for (const line of lines) {
    page.drawText(line, {
      x: contentX,
      y,
      size: 10.5,
      font,
      color: textMuted,
    });
    y -= 14;
  }

  y -= 34;

  /* ------------------ INVEST BLOCK ------------------ */

  page.drawText("Ihre Investition", {
    x: contentX,
    y,
    size: 13,
    font: bold,
    color: textDark,
  });

  y -= 14;

  page.drawLine({
    start: { x: contentX, y },
    end: { x: contentX + 46, y },
    thickness: 1.5,
    color: lineColor,
  });

  y -= 26;

  page.drawText("Gesamtpreis netto", {
    x: contentX,
    y,
    size: 11,
    font,
    color: textDark,
  });

  page.drawText("— CHF", {
    x: width - sideMargin - 140,
    y,
    size: 11,
    font: bold,
    color: textDark,
  });

  y -= 44;

  page.drawText("Offerte gültig bis: —", {
    x: contentX,
    y,
    size: 10.5,
    font,
    color: textMuted,
  });
}

/* ------------------ SIMPLE WRAP ------------------ */

function wrapText(text: string, maxCharsPerLine: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxCharsPerLine) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines;
}