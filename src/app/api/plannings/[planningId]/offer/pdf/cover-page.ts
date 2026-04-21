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

  /* ------------------ ASSETS FROM /public ------------------ */

  const heroPath = path.join(process.cwd(), "public", "hero-pdf.jpg");
  const logoPath = path.join(process.cwd(), "public", "logo-demo.jpg");

  const heroBytes = await fs.readFile(heroPath);
  const logoBytes = await fs.readFile(logoPath);

  const heroImage = await pdf.embedJpg(heroBytes);
  const logoImage = await pdf.embedJpg(logoBytes);

  /* ------------------ HERO ------------------ */

  const heroHeight = 300;

  page.drawImage(heroImage, {
    x: 0,
    y: height - heroHeight,
    width,
    height: heroHeight,
  });

  /* leggero overlay per dare più contrasto */
  page.drawRectangle({
    x: 0,
    y: height - heroHeight,
    width,
    height: heroHeight,
    color: rgb(0, 0, 0),
    opacity: 0.12,
  });

  /* ------------------ LOGO BOX ------------------ */

  const logoBoxX = 40;
  const logoBoxY = height - 120;
  const logoBoxWidth = 180;
  const logoBoxHeight = 70;

  page.drawRectangle({
    x: logoBoxX,
    y: logoBoxY,
    width: logoBoxWidth,
    height: logoBoxHeight,
    color: rgb(1, 1, 1),
  });

  page.drawImage(logoImage, {
    x: logoBoxX + 10,
    y: logoBoxY + 10,
    width: 160,
    height: 50,
  });

  /* ------------------ TITLE BLOCK ------------------ */
  /* ORA ENTRA SOPRA LA HERO, come nel layout Gama */

  const titleBoxX = 40;
  const titleBoxWidth = width - 80;
  const titleBoxHeight = 100;

  // prima era sotto la hero; adesso lo alziamo
  const titleBoxY = height - heroHeight + 28;

  page.drawRectangle({
    x: titleBoxX,
    y: titleBoxY,
    width: titleBoxWidth,
    height: titleBoxHeight,
    color: rgb(0.95, 0.95, 0.95),
  });

  page.drawText(data.title || "Photovoltaik-Anlage", {
    x: titleBoxX + 14,
    y: titleBoxY + 58,
    size: 18,
    font: bold,
    color: rgb(0.12, 0.12, 0.12),
  });

  page.drawText(`${Number(data.kWp || 0).toFixed(1)} kWp`, {
    x: titleBoxX + 14,
    y: titleBoxY + 28,
    size: 14,
    font: bold,
    color: rgb(0.2, 0.2, 0.2),
  });

  /* linea scura in basso stile Gama */
  page.drawRectangle({
    x: titleBoxX + 14,
    y: titleBoxY + 12,
    width: titleBoxWidth - 28,
    height: 3,
    color: rgb(0.12, 0.26, 0.30),
  });

  page.drawText(`Offerte Nr. ${data.planningNumber || "—"}`, {
    x: titleBoxX + 14,
    y: titleBoxY - 16,
    size: 10,
    font,
    color: rgb(15, 170, 162),
  });

  /* ------------------ GREETING / INTRO ------------------ */

  let y = titleBoxY - 80;

  page.drawText(data.customerName || "Kunde", {
    x: 50,
    y,
    size: 14,
    font: bold,
    color: rgb(0.12, 0.12, 0.12),
  });

  y -= 24;

  const paragraph =
    "Vielen Dank für Ihr Interesse an einer Zusammenarbeit mit uns. Mit Helionic haben Sie einen erfahrenen und verlässlichen Partner für innovative Photovoltaik-Lösungen.";

  page.drawText(paragraph, {
    x: 50,
    y,
    size: 10,
    font,
    maxWidth: width - 100,
    lineHeight: 14,
    color: rgb(0.3, 0.3, 0.3),
  });

  y -= 70;

  /* ------------------ SIMPLE INVEST BLOCK ------------------ */

  page.drawText("Ihre Investition", {
    x: 50,
    y,
    size: 13,
    font: bold,
    color: rgb(0.12, 0.12, 0.12),
  });

  y -= 20;

  page.drawText("Gesamtpreis netto", {
    x: 50,
    y,
    size: 11,
    font,
    color: rgb(0.2, 0.2, 0.2),
  });

  page.drawText("— CHF", {
    x: 400,
    y,
    size: 11,
    font: bold,
    color: rgb(0.12, 0.12, 0.12),
  });

  y -= 40;

  page.drawText("Offerte gültig bis: —", {
    x: 50,
    y,
    size: 10,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });
}