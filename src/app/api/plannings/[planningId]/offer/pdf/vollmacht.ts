import type { PDFDocument } from "pdf-lib";
import {
  addCompanyVollmachtPage,
  type VollmachtPageValues,
} from "@/lib/vollmachtPdf";

export async function addVollmachtPage(
  pdf: PDFDocument,
  company: any = null,
  values: VollmachtPageValues = {},
) {
  return addCompanyVollmachtPage(pdf, { company, values });
}
