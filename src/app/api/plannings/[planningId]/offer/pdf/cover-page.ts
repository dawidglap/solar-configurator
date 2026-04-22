import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fs from "fs/promises";
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
  const page = pdf.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const heroPath = path.join(process.cwd(), "public", "hero-pdf.jpg");
  const logoPath = path.join(process.cwd(), "public", "logo-demo.jpg");

  const heroBytes = await fs.readFile(heroPath);
  const logoBytes = await fs.readFile(logoPath);

  const heroImage = await pdf.embedJpg(heroBytes);
  const logoImage = await pdf.embedJpg(logoBytes);

  const COLOR_TEXT = rgb(0.16, 0.24, 0.28);
  const COLOR_MUTED = rgb(0.34, 0.38, 0.42);
  const COLOR_LINE = rgb(0.12, 0.26, 0.30);
  const COLOR_LIGHT = rgb(0.95, 0.95, 0.95);

  /* ------------------ HERO ------------------ */

  const heroHeight = 300;

  page.drawImage(heroImage, {
    x: 0,
    y: height - heroHeight,
    width,
    height: heroHeight,
  });

  page.drawRectangle({
    x: 0,
    y: height - heroHeight,
    width,
    height: heroHeight,
    color: rgb(0, 0, 0),
    opacity: 0.1,
  });

  /* ------------------ LOGO BOX ------------------ */

  const logoBoxX = 40;
  const logoBoxY = height - 118;
  const logoBoxWidth = 150;
  const logoBoxHeight = 62;

  page.drawRectangle({
    x: logoBoxX,
    y: logoBoxY,
    width: logoBoxWidth,
    height: logoBoxHeight,
    color: rgb(1, 1, 1),
  });

  page.drawImage(logoImage, {
    x: logoBoxX + 12,
    y: logoBoxY + 12,
    width: 126,
    height: 38,
  });

  /* ------------------ TITLE BLOCK ------------------ */

  const titleBoxX = 40;
  const titleBoxWidth = width - 80;
  const titleBoxHeight = 112;
  const titleBoxY = height - heroHeight + 18;

  page.drawRectangle({
    x: titleBoxX,
    y: titleBoxY,
    width: titleBoxWidth,
    height: titleBoxHeight,
    color: COLOR_LIGHT,
  });

  const title = data.title || "Photovoltaik-Anlage";
  const kwpText = `${Number(data.kWp || 0).toFixed(2)} kWp`;

  page.drawText(title, {
    x: titleBoxX + 16,
    y: titleBoxY + 66,
    size: 17,
    font: font,
    color: COLOR_TEXT,
    maxWidth: titleBoxWidth - 32,
  });

  page.drawText(kwpText, {
    x: titleBoxX + 16,
    y: titleBoxY + 26,
    size: 26,
    font: bold,
    color: COLOR_TEXT,
  });

  page.drawRectangle({
    x: titleBoxX + 16,
    y: titleBoxY + 12,
    width: titleBoxWidth - 32,
    height: 3,
    color: COLOR_LINE,
  });

  page.drawText(`Offerte Nr.  ${data.planningNumber || "—"}`, {
    x: titleBoxX + 16,
    y: titleBoxY - 16,
    size: 10,
    font,
    color: COLOR_MUTED,
  });

  /* ------------------ GREETING ------------------ */

  let y = titleBoxY - 78;

  page.drawText(data.customerName || "Kunde", {
    x: 50,
    y,
    size: 15,
    font: bold,
    color: COLOR_TEXT,
  });

  y -= 24;

  const paragraph =
    "Vielen Dank für Ihr Interesse an einer Zusammenarbeit mit uns. Mit Helionic haben Sie einen erfahrenen und verlässlichen Partner für innovative Photovoltaik-Lösungen an Ihrer Seite.";

  page.drawText(paragraph, {
    x: 50,
    y,
    size: 10,
    font,
    maxWidth: width - 100,
    lineHeight: 14,
    color: COLOR_MUTED,
  });

  y -= 72;

  /* ------------------ INVEST BLOCK ------------------ */

  page.drawText("Ihre Investition", {
    x: 50,
    y,
    size: 13,
    font: bold,
    color: COLOR_TEXT,
  });

  y -= 20;

  page.drawText("Gesamtpreis netto", {
    x: 50,
    y,
    size: 11,
    font,
    color: COLOR_TEXT,
  });

  page.drawText("— CHF", {
    x: 400,
    y,
    size: 11,
    font: bold,
    color: COLOR_TEXT,
  });

  y -= 40;

  page.drawText("Offerte gültig bis: —", {
    x: 50,
    y,
    size: 10,
    font,
    color: COLOR_MUTED,
  });
}