import { PDFDocument } from "pdf-lib";
import { addReportPages } from "@/app/api/plannings/[planningId]/offer/pdf/report-pages";

type RenderAnalyseArgs = Parameters<typeof addReportPages>[1];

export async function renderAnalyse(
  pdf: PDFDocument,
  args: RenderAnalyseArgs,
) {
  await addReportPages(pdf, args);
}
