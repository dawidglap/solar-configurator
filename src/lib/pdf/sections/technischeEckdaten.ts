import { PDFDocument } from "pdf-lib";
import { addDetailPages } from "@/app/api/plannings/[planningId]/offer/pdf/detail-pages";

type RenderTechnischeEckdatenArgs = Parameters<typeof addDetailPages>[1];

export async function renderTechnischeEckdaten(
  pdf: PDFDocument,
  args: RenderTechnischeEckdatenArgs,
) {
  await addDetailPages(pdf, args);
}
