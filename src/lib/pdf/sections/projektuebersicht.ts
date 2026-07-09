import { PDFDocument } from "pdf-lib";
import { addProjectOverviewPage } from "@/app/api/plannings/[planningId]/offer/pdf/project-overview-page";

type RenderProjektuebersichtArgs = Parameters<typeof addProjectOverviewPage>[1];

export async function renderProjektuebersicht(
  pdf: PDFDocument,
  args: RenderProjektuebersichtArgs,
) {
  await addProjectOverviewPage(pdf, args);
}
