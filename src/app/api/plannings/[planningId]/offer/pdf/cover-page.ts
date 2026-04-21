import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

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

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  if (!baseUrl) {
    throw new Error("Missing NEXT_PUBLIC_BASE_URL");
  }

  /* ------------------ ASSETS ------------------ */

  const heroBytes = await fetch(new URL("/hero-pdf.jpg", baseUrl)).then((r) => {
    if (!r.ok) throw new Error("hero-pdf.jpg not found");
    return r.arrayBuffer();
  });
  const heroImage = await pdf.embedJpg(heroBytes);

  const logoBytes = await fetch(new URL("/logo-demo.jpg", baseUrl)).then((r) => {
    if (!r.ok) throw new Error("logo-demo.jpg not found");
    return r.arrayBuffer();
  });
  const logoImage = await pdf.embedJpg(logoBytes);

  /* ------------------ HERO ------------------ */

  const heroHeight = 260;

  page.drawImage(heroImage, {
    x: 0,
    y: height - heroHeight,
    width,
    height: heroHeight,
  });

  /* ------------------ LOGO BOX ------------------ */

  const logoBoxWidth = 180;
  const logoBoxHeight = 70;

  page.drawRectangle({
    x: 40,
    y: height - 120,
    width: logoBoxWidth,
    height: logoBoxHeight,
    color: rgb(1, 1, 1),
  });

  page.drawImage(logoImage, {
    x: 50,
    y: height - 110,
    width: 140,
    height: 40,
  });

  /* ------------------ TITLE BLOCK ------------------ */

  const titleY = height - heroHeight - 50;

  page.drawRectangle({
    x: 40,
    y: titleY - 60,
    width: width - 80,
    height: 80,
    color: rgb(0.95, 0.95, 0.95),
  });

  page.drawText(data.title || "Photovoltaik-Anlage", {
    x: 50,
    y: titleY,
    size: 18,
    font: bold,
    color: rgb(0.12, 0.12, 0.12),
  });

  page.drawText(`${data.kWp.toFixed(1)} kWp`, {
    x: 50,
    y: titleY - 22,
    size: 14,
    font: bold,
    color: rgb(0.2, 0.2, 0.2),
  });

  /* ------------------ META ------------------ */

  page.drawText(`Offerte Nr. ${data.planningNumber}`, {
    x: 50,
    y: titleY - 50,
    size: 10,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });

  /* ------------------ GREETING ------------------ */

  let y = titleY - 110;

  page.drawText(`Herr ${data.customerName}`, {
    x: 50,
    y,
    size: 14,
    font: bold,
    color: rgb(0.12, 0.12, 0.12),
  });

  y -= 20;

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

  y -= 60;

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
    color: rgb(0.12, 0.12, 0.12),
  });

  page.drawText("— CHF", {
    x: 400,
    y,
    size: 11,
    font: bold,
    color: rgb(0.12, 0.12, 0.12),
  });

  y -= 40;

  /* ------------------ VALIDITY ------------------ */

  page.drawText("Offerte gültig bis: —", {
    x: 50,
    y,
    size: 10,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });
}