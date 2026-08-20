import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { safeString } from "@/lib/api-session";

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const FONT_DIRECTORY = path.join(process.cwd(), "node_modules", "dejavu-fonts-ttf", "ttf");
const REGULAR_FONT_PATH = path.join(FONT_DIRECTORY, "DejaVuSans.ttf");
const BOLD_FONT_PATH = path.join(FONT_DIRECTORY, "DejaVuSans-Bold.ttf");

let fontBytesPromise: Promise<[Buffer, Buffer]> | null = null;

export type VollmachtPageValues = {
  propertyAddress?: string | null;
  parcelNumber?: string | null;
  landRegisterNumber?: string | null;
  buildingNumber?: string | null;
  ownerCompanyName?: string | null;
  ownerFirstName?: string | null;
  ownerLastName?: string | null;
  ownerStreet?: string | null;
  ownerZip?: string | null;
  ownerCity?: string | null;
  ownerBirthDate?: string | null;
  ownerPhone?: string | null;
  ownerEmail?: string | null;
  bankAccountHolder?: string | null;
  bankName?: string | null;
  bankIban?: string | null;
  signatureDate?: string | null;
  signaturePng?: Buffer | Uint8Array | null;
  signatureMethod?: string | null;
};

export type AddCompanyVollmachtPageArgs = {
  company: any;
  values?: VollmachtPageValues;
};

function pdfText(value: unknown) {
  return safeString(value)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[—–]/g, "-")
    .replace(/…/g, "...")
    .replace(/\u00a0/g, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .normalize("NFC");
}

function formatLocalDate(value: unknown) {
  const normalized = safeString(value);
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : normalized;
}

function formatIban(value: unknown) {
  return safeString(value)
    .replace(/\s+/g, "")
    .toUpperCase()
    .replace(/(.{4})(?=.)/g, "$1 ")
    .trim();
}

async function embedFonts(pdf: PDFDocument) {
  pdf.registerFontkit(fontkit);
  fontBytesPromise ??= Promise.all([
    readFile(REGULAR_FONT_PATH),
    readFile(BOLD_FONT_PATH),
  ]);
  const [regularBytes, boldBytes] = await fontBytesPromise;
  const [font, bold] = await Promise.all([
    pdf.embedFont(regularBytes, { subset: true }),
    pdf.embedFont(boldBytes, { subset: true }),
  ]);
  return { font, bold };
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const words = pdfText(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (!line || font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawWrappedText(args: {
  page: PDFPage;
  text: string;
  x: number;
  y: number;
  width: number;
  font: PDFFont;
  size: number;
  lineHeight: number;
  color: ReturnType<typeof rgb>;
}) {
  let y = args.y;
  for (const line of wrapText(args.text, args.font, args.size, args.width)) {
    args.page.drawText(line, {
      x: args.x,
      y,
      size: args.size,
      font: args.font,
      color: args.color,
    });
    y -= args.lineHeight;
  }
  return y;
}

function fitTextSize(text: string, font: PDFFont, preferredSize: number, maxWidth: number, minSize = 6) {
  const normalized = pdfText(text);
  const width = font.widthOfTextAtSize(normalized, preferredSize);
  return width > maxWidth ? Math.max(minSize, preferredSize * maxWidth / width) : preferredSize;
}

async function drawCompanyLogo(args: {
  pdf: PDFDocument;
  page: PDFPage;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  if (!args.url) return false;
  try {
    const response = await fetch(args.url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Logo download failed (${response.status})`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const contentType = safeString(response.headers.get("content-type")).toLowerCase();
    const isPng = contentType.includes("png") || bytes.subarray(1, 4).toString("ascii") === "PNG";
    const image = isPng ? await args.pdf.embedPng(bytes) : await args.pdf.embedJpg(bytes);
    const scale = Math.min(args.width / image.width, args.height / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    args.page.drawImage(image, {
      x: args.x,
      y: args.y + (args.height - height) / 2,
      width,
      height,
    });
    return true;
  } catch (error) {
    console.warn("VOLLMACHT LOGO ERROR:", error);
    return false;
  }
}

export function resolveVollmachtCompanyFields(company: any) {
  return {
    name: safeString(company?.name),
    logoUrl: safeString(company?.branding?.logoUrl),
    street: safeString(company?.address?.street),
    zip: safeString(company?.address?.zip),
    city: safeString(company?.address?.city),
    uid: safeString(company?.uid),
    phone: safeString(company?.contact?.phone),
    email: safeString(company?.contact?.email),
    website: safeString(company?.contact?.website),
  };
}

export async function addCompanyVollmachtPage(
  pdf: PDFDocument,
  args: AddCompanyVollmachtPageArgs,
) {
  const { font, bold } = await embedFonts(pdf);
  const page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
  const values = args.values ?? {};
  const company = resolveVollmachtCompanyFields(args.company);
  const dark = rgb(0.11, 0.17, 0.22);
  const muted = rgb(0.34, 0.38, 0.42);
  const fieldFill = rgb(0.83, 0.84, 0.86);
  const margin = 48;
  const fieldX = 178;
  const fieldWidth = 369;

  page.drawRectangle({ x: 0, y: 0, width: A4_WIDTH, height: A4_HEIGHT, color: rgb(1, 1, 1) });
  const logoShown = await drawCompanyLogo({
    pdf,
    page,
    url: company.logoUrl,
    x: margin,
    y: 752,
    width: 132,
    height: 52,
  });
  if (!logoShown) {
    const size = fitTextSize(company.name || "Ihre Firma", bold, 17, 150, 10);
    page.drawText(pdfText(company.name || "Ihre Firma"), { x: margin, y: 775, size, font: bold, color: dark });
  }

  const headerColumns = [
    [company.street, [company.zip, company.city].filter(Boolean).join(" ")],
    [company.uid, company.phone],
    [company.email, company.website],
  ];
  [280, 380, 480].forEach((x, index) => {
    headerColumns[index].filter(Boolean).slice(0, 2).forEach((line, lineIndex) => {
      const size = fitTextSize(line, font, 6.7, index === 2 ? 68 : 92, 5.5);
      page.drawText(pdfText(line), { x, y: 782 - lineIndex * 12, size, font, color: dark });
    });
  });

  const title = "VOLLMACHT - PHOTOVOLTAIKANLAGE";
  page.drawText(title, {
    x: margin,
    y: 704,
    size: fitTextSize(title, bold, 23, 499, 18),
    font: bold,
    color: dark,
  });

  const drawFieldRow = (label: string, value: unknown, y: number) => {
    page.drawText(pdfText(label), { x: margin, y, size: 9.1, font, color: dark });
    page.drawRectangle({ x: fieldX, y: y - 5, width: fieldWidth, height: 18, color: fieldFill });
    const normalized = pdfText(value);
    if (normalized) {
      page.drawText(normalized, {
        x: fieldX + 7,
        y,
        size: fitTextSize(normalized, font, 8.2, fieldWidth - 14, 6),
        font,
        color: dark,
      });
    }
  };

  drawFieldRow("Objekt", values.propertyAddress, 650);
  drawFieldRow("Parzelle", values.parcelNumber, 627);
  drawFieldRow("Grundstück-Nr.", values.landRegisterNumber, 604);
  drawFieldRow("Gebäude Nummer", values.buildingNumber, 581);

  const companyAddress = [company.street, [company.zip, company.city].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  const grantee = [company.name || "Ihre Firma", companyAddress].filter(Boolean).join(", ");
  const legalText =
    `Hiermit erteile ich als Gesuchsteller/in der Firma ${grantee} eine umfassende Vollmacht für die Erstellung ` +
    "unserer Photovoltaikanlage und allen dazugehörigen Prozessen. Die zuständigen Mitarbeiter sind berechtigt, " +
    "die erforderlichen Genehmigungen zu unterzeichnen. Die Vollmacht gilt insbesondere für jegliche " +
    "Bewilligungsverfahren, Förderungen bei der Pronovo sowie anderen Öffentlich-Rechtlichen Institutionen. " +
    "Wir bitten die entsprechenden Ämter um die Erteilung jeglicher benötigten Unterlagen und Informationen. " +
    "Sollten zusätzliche Kosten entstehen, sind diese dem Vollmachtgeber in Rechnung zu stellen.";
  drawWrappedText({
    page,
    text: legalText,
    x: margin,
    y: 548,
    width: 499,
    font,
    size: 7.7,
    lineHeight: 9.7,
    color: dark,
  });
  drawWrappedText({
    page,
    text: "Bitte senden Sie uns einen Grundbuchauszug und die Grundrisspläne möglichst schnell zu.",
    x: margin,
    y: 454,
    width: 499,
    font: bold,
    size: 8.6,
    lineHeight: 11,
    color: dark,
  });

  page.drawText("Auftraggeber/Vollmachtgeber/Eigentümerschaft:", {
    x: margin,
    y: 419,
    size: 9.4,
    font: bold,
    color: dark,
  });
  drawFieldRow("Firma", values.ownerCompanyName, 393);
  drawFieldRow(
    "Name / Vorname",
    [safeString(values.ownerLastName), safeString(values.ownerFirstName)].filter(Boolean).join(" / "),
    370,
  );
  drawFieldRow("Strasse / Nummer", values.ownerStreet, 347);
  drawFieldRow(
    "PLZ / Ort",
    [safeString(values.ownerZip), safeString(values.ownerCity)].filter(Boolean).join(" "),
    324,
  );
  drawFieldRow("Geburtsdatum", formatLocalDate(values.ownerBirthDate), 301);
  drawFieldRow("Telefonnummer", values.ownerPhone, 278);
  drawFieldRow("E-Mail Adresse", values.ownerEmail, 255);

  page.drawText("Bankverbindung", { x: margin, y: 220, size: 9.4, font: bold, color: dark });
  drawFieldRow("Kontoinhaber", values.bankAccountHolder, 196);
  drawFieldRow("Bank", values.bankName, 173);
  drawFieldRow("IBAN", formatIban(values.bankIban), 150);

  drawFieldRow("Datum", formatLocalDate(values.signatureDate), 111);
  page.drawText("Unterschrift", { x: margin, y: 70, size: 9.1, font, color: dark });
  page.drawRectangle({ x: fieldX, y: 29, width: fieldWidth, height: 62, color: fieldFill });
  if (values.signaturePng?.length) {
    const image = await pdf.embedPng(values.signaturePng);
    const scale = Math.min(175 / image.width, 49 / image.height, 2);
    page.drawImage(image, {
      x: fieldX + 7,
      y: 35 + (49 - image.height * scale) / 2,
      width: image.width * scale,
      height: image.height * scale,
    });
  }
  const method = pdfText(values.signatureMethod);
  if (method) {
    drawWrappedText({
      page,
      text: `Methode: ${method}`,
      x: fieldX + 190,
      y: 72,
      width: fieldWidth - 198,
      font,
      size: 6.2,
      lineHeight: 7.5,
      color: muted,
    });
  }

  return page;
}
