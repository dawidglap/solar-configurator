import type { Pt } from "@/types/planner";
import {
  simplifySonnendachPolygonWithReport,
  type SonnendachSimplificationReport,
} from "./sonnendachPolygon";

export function normalizeSonnendachImportGeometry<T extends { pointsPx: Pt[] }>(
  roof: T,
  metresPerPixel: number,
): { roof: T; report: SonnendachSimplificationReport } {
  const report = simplifySonnendachPolygonWithReport(roof.pointsPx, metresPerPixel);
  return {
    roof: { ...roof, pointsPx: report.points },
    report,
  };
}
