import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export async function addVollmachtPage(pdf: PDFDocument) {
  const page = pdf.addPage([595.28, 841.89]); // A4

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const x = 48;
  let y = 800;

  page.drawText("Vollmacht", {
    x,
    y,
    size: 20,
    font: bold,
    color: rgb(0.1, 0.1, 0.1),
  });

  y -= 30;

  page.drawText(
    "Hiermit erteile ich die Vollmacht für die Abwicklung der Anmeldung und Installation der Photovoltaikanlage.",
    {
      x,
      y,
      size: 11,
      font,
      color: rgb(0.2, 0.2, 0.2),
      maxWidth: 500,
      lineHeight: 14,
    }
  );

  y -= 40;

  const fields = [
    "Name / Vorname",
    "Adresse",
    "PLZ / Ort",
    "Geburtsdatum",
    "Telefon",
    "E-Mail",
    "Ort / Datum",
    "Unterschrift",
  ];

  for (const label of fields) {
    page.drawText(label, {
      x,
      y,
      size: 10,
      font,
      color: rgb(0.35, 0.35, 0.35),
    });

    y -= 14;

    page.drawLine({
      start: { x, y },
      end: { x: x + 420, y },
      thickness: 1,
      color: rgb(0.7, 0.7, 0.7),
    });

    y -= 26;
  }
}
