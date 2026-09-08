import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PanelInstance, Pt, RoofArea } from "@/types/planner";
import {
  buildThermalBreakDisplays,
  type ThermalFieldDisplay,
} from "./thermalFieldDisplay";
import {
  computeUsableRoof,
  imagePolygonToMetric,
  metricPolygonToImage,
} from "@/lib/planning-core/geometry-v2";
import { getCanonicalRoofEdges } from "@/lib/planning-core/geometry-v2/roofEdges";
import {
  HINDERNIS_HATCH_OPACITY,
  HINDERNIS_HATCH_SPACING,
  HINDERNIS_HATCH_STROKE_WIDTH,
} from "@/lib/planning/presentation/hindernisHatch";

export type ThermalFieldPdfInput = {
  roof: RoofArea;
  panels: readonly PanelInstance[];
  obstacles: readonly { points: Pt[] }[];
  fields: readonly ThermalFieldDisplay[];
  separationGapM?: number;
  backgroundImageUrl?: string;
  backgroundImageSize?: { width: number; height: number };
  mppImage?: number;
  marginM?: number;
  module?: {
    label: string;
    widthM?: number;
    heightM?: number;
    orientation?: "portrait" | "landscape";
  };
};

const A4_LANDSCAPE: [number, number] = [841.89, 595.28];
const PRINT = {
  white: rgb(1, 1, 1),
  planBackground: rgb(0.97, 0.98, 0.985),
  text: rgb(0.067, 0.094, 0.153),
  secondary: rgb(0.31, 0.35, 0.41),
  muted: rgb(0.44, 0.48, 0.54),
  border: rgb(0.84, 0.86, 0.89),
  panelFill: rgb(0.76, 0.82, 0.87),
  panelStroke: rgb(0.20, 0.25, 0.31),
  obstacle: rgb(0.72, 0.15, 0.12),
  success: rgb(0.08, 0.42, 0.27),
  warning: rgb(0.66, 0.18, 0.14),
} as const;
const hex = (value: string) => {
  const clean = value.replace("#", "");
  return rgb(parseInt(clean.slice(0, 2), 16) / 255, parseInt(clean.slice(2, 4), 16) / 255, parseInt(clean.slice(4, 6), 16) / 255);
};

function rotatePoint(point: Pt, center: Pt, angleDeg: number): Pt {
  const radians = angleDeg * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cosine - dy * sine,
    y: center.y + dx * sine + dy * cosine,
  };
}

function panelPolygon(panel: PanelInstance): Pt[] {
  const center = { x: panel.cx, y: panel.cy };
  return [
    { x: panel.cx - panel.wPx / 2, y: panel.cy - panel.hPx / 2 },
    { x: panel.cx + panel.wPx / 2, y: panel.cy - panel.hPx / 2 },
    { x: panel.cx + panel.wPx / 2, y: panel.cy + panel.hPx / 2 },
    { x: panel.cx - panel.wPx / 2, y: panel.cy + panel.hPx / 2 },
  ].map((point) => rotatePoint(point, center, panel.angleDeg ?? 0));
}

function pointInPolygon(point: Pt, polygon: readonly Pt[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index];
    const b = polygon[previous];
    if ((a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function segmentIntersectionParameter(start: Pt, end: Pt, a: Pt, b: Pt): number | undefined {
  const rx = end.x - start.x;
  const ry = end.y - start.y;
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < 1e-9) return undefined;
  const qx = a.x - start.x;
  const qy = a.y - start.y;
  const t = (qx * sy - qy * sx) / denominator;
  const u = (qx * ry - qy * rx) / denominator;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : undefined;
}

function clippedSegments(start: Pt, end: Pt, polygon: readonly Pt[]): Array<[Pt, Pt]> {
  const parameters = [0, 1];
  polygon.forEach((a, index) => {
    const value = segmentIntersectionParameter(start, end, a, polygon[(index + 1) % polygon.length]);
    if (value !== undefined) parameters.push(value);
  });
  const unique = [...new Set(parameters.map((value) => Number(value.toFixed(8))))].sort((a, b) => a - b);
  const at = (t: number): Pt => ({
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  });
  return unique.slice(0, -1).flatMap((from, index) => {
    const to = unique[index + 1];
    return pointInPolygon(at((from + to) / 2), polygon) ? [[at(from), at(to)] as [Pt, Pt]] : [];
  });
}

function drawPolygonOutline(
  page: ReturnType<PDFDocument["addPage"]>,
  points: readonly Pt[],
  options: { color: ReturnType<typeof rgb>; thickness: number; opacity?: number; dashArray?: number[] },
): void {
  points.forEach((start, index) => {
    page.drawLine({
      start,
      end: points[(index + 1) % points.length],
      color: options.color,
      thickness: options.thickness,
      opacity: options.opacity,
      dashArray: options.dashArray,
    });
  });
}

export async function buildThermalFieldPdf(input: ThermalFieldPdfInput): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const page = document.addPage(A4_LANDSCAPE);
  const { width, height } = page.getSize();
  page.drawRectangle({ x: 0, y: 0, width, height, color: PRINT.white });

  const roofPanels = input.panels.filter((panel) => panel.roofId === input.roof.id);
  const allPoints = [
    ...input.roof.points,
    ...roofPanels.flatMap(panelPolygon),
  ];
  const minX = Math.min(...allPoints.map((point) => point.x));
  const maxX = Math.max(...allPoints.map((point) => point.x));
  const minY = Math.min(...allPoints.map((point) => point.y));
  const maxY = Math.max(...allPoints.map((point) => point.y));
  const frame = { x: 42, y: 54, width: width - 84, height: height - 112 };
  const scale = Math.min(frame.width / Math.max(1, maxX - minX), frame.height / Math.max(1, maxY - minY));
  const map = (point: Pt): Pt => ({
    x: frame.x + (point.x - minX) * scale,
    y: frame.y + frame.height - (point.y - minY) * scale,
  });
  const polygonPath = (points: readonly Pt[]) => points.map((point, index) => {
    const p = map(point);
    return `${index === 0 ? "M" : "L"} ${p.x} ${p.y}`;
  }).join(" ") + " Z";

  let satelliteEmbedded = false;
  if (input.backgroundImageUrl && input.backgroundImageSize) {
    try {
      const response = await fetch(input.backgroundImageUrl);
      if (response.ok) {
        const bytes = await response.arrayBuffer();
        const image = /png/i.test(response.headers.get("content-type") ?? "")
          ? await document.embedPng(bytes)
          : await document.embedJpg(bytes);
        const imageTop = frame.y + frame.height + minY * scale;
        page.drawImage(image, {
          x: frame.x - minX * scale,
          y: imageTop - input.backgroundImageSize.height * scale,
          width: input.backgroundImageSize.width * scale,
          height: input.backgroundImageSize.height * scale,
          opacity: 0.55,
        });
        satelliteEmbedded = true;
      }
    } catch {
      satelliteEmbedded = false;
    }
  }
  if (!satelliteEmbedded) page.drawRectangle({ ...frame, color: PRINT.planBackground });
  drawPolygonOutline(page, [
    { x: frame.x, y: frame.y },
    { x: frame.x + frame.width, y: frame.y },
    { x: frame.x + frame.width, y: frame.y + frame.height },
    { x: frame.x, y: frame.y + frame.height },
  ], { color: PRINT.border, thickness: 0.6 });

  page.drawSvgPath(polygonPath(input.roof.points), {
    borderColor: rgb(0.18, 0.83, 0.75), borderWidth: 2, color: rgb(0.18, 0.83, 0.75), opacity: 0.09,
  });
  drawPolygonOutline(page, input.roof.points.map(map), { color: rgb(0.18, 0.83, 0.75), thickness: 2, opacity: 0.95 });
  input.obstacles.forEach((obstacle) => {
    page.drawSvgPath(polygonPath(obstacle.points), { borderColor: PRINT.obstacle, borderWidth: 1.4, color: PRINT.obstacle, opacity: 0.045 });
    const points = obstacle.points.map(map);
    const left = Math.min(...points.map((point) => point.x));
    const right = Math.max(...points.map((point) => point.x));
    const bottom = Math.min(...points.map((point) => point.y));
    const top = Math.max(...points.map((point) => point.y));
    drawPolygonOutline(page, points, { color: PRINT.obstacle, thickness: 1.4, opacity: 0.95 });
    for (let offset = left - (top - bottom); offset < right; offset += HINDERNIS_HATCH_SPACING) {
      const diagonals: Array<[Pt, Pt]> = [
        [{ x: offset, y: bottom }, { x: offset + top - bottom, y: top }],
        [{ x: offset, y: top }, { x: offset + top - bottom, y: bottom }],
      ];
      diagonals.forEach(([start, end], diagonalIndex) => clippedSegments(start, end, points).forEach(([clippedStart, clippedEnd]) => {
        page.drawLine({
          start: clippedStart,
          end: clippedEnd,
          color: PRINT.obstacle,
          thickness: HINDERNIS_HATCH_STROKE_WIDTH,
          opacity: diagonalIndex === 0 ? HINDERNIS_HATCH_OPACITY + 0.08 : HINDERNIS_HATCH_OPACITY,
        });
      }));
    }
  });
  roofPanels.forEach((panel) => {
    const points = panelPolygon(panel).map(map);
    page.drawSvgPath(polygonPath(panelPolygon(panel)), {
      color: PRINT.panelFill, opacity: satelliteEmbedded ? 0.78 : 0.9,
    });
    drawPolygonOutline(page, points, { color: PRINT.panelStroke, thickness: 0.45, opacity: 0.9 });
  });
  input.fields.forEach((field) => {
    drawPolygonOutline(page, field.outlinePx.map(map), { color: hex(field.color), thickness: 2.2, opacity: 0.95 });
    const center = field.outlinePx.reduce((sum, point) => ({ x: sum.x + point.x / field.outlinePx.length, y: sum.y + point.y / field.outlinePx.length }), { x: 0, y: 0 });
    const mapped = map(center);
    page.drawText(field.displayId, { x: mapped.x - 8, y: mapped.y - 5, size: 13, font: bold, color: hex(field.color) });
  });
  buildThermalBreakDisplays(input.fields).forEach((thermalBreak) => {
    const start = map(thermalBreak.start);
    const end = map(thermalBreak.end);
    const middle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    page.drawLine({ start, end, color: rgb(0.96, 0.62, 0.04), thickness: 1.1, dashArray: [3, 2] });
    page.drawRectangle({ x: middle.x - 16, y: middle.y - 5, width: 32, height: 11, color: PRINT.white, borderColor: PRINT.border, borderWidth: 0.4, opacity: 0.96 });
    page.drawText(`${Math.round(thermalBreak.gapM * 1000)} mm`, { x: middle.x - 13, y: middle.y - 2, size: 6.5, font: bold, color: PRINT.text });
  });

  if (input.mppImage && input.marginM && input.marginM > 0) {
    const adapter = { mppImage: input.mppImage, metricOriginPx: { x: 0, y: 0 } };
    const usable = computeUsableRoof({
      roofPolygonM: imagePolygonToMetric(input.roof.points, adapter),
      marginM: input.marginM,
    });
    if (usable.status === "valid") {
      usable.components.forEach((component) => {
        drawPolygonOutline(page, metricPolygonToImage(component, adapter).map(map), {
          color: rgb(0.97, 0.33, 0.33), thickness: 0.8, opacity: 0.85, dashArray: [3, 2],
        });
      });
      page.drawText(`Randabstand ${input.marginM.toFixed(2)} m`, { x: frame.x + 6, y: frame.y + 6, size: 7, font: bold, color: rgb(0.97, 0.45, 0.45) });
    }
  }

  const referenceEdge = getCanonicalRoofEdges(input.roof.points)
    .find((edge) => edge.edgeIndex === input.roof.referenceEdgeIndex);
  if (referenceEdge) {
    const start = map(referenceEdge.start);
    const end = map(referenceEdge.end);
    page.drawLine({ start, end, color: rgb(0.18, 0.83, 0.75), thickness: 3 });
    const middle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    page.drawText("REFERENZKANTE", { x: middle.x - 26, y: middle.y + 5, size: 7, font: bold, color: rgb(0.18, 0.83, 0.75) });
  }
  page.drawText("Thermische Feldaufteilung", { x: 42, y: height - 34, size: 18, font: bold, color: PRINT.text });
  page.drawText(`${input.fields.length} Felder · ${roofPanels.length} Module`, { x: 42, y: height - 50, size: 9, font: regular, color: PRINT.secondary });
  page.drawText("N", { x: width - 49, y: height - 38, size: 12, font: bold, color: rgb(0.95, 0.35, 0.35) });
  page.drawLine({ start: { x: width - 45, y: height - 65 }, end: { x: width - 45, y: height - 42 }, color: rgb(0.95, 0.35, 0.35), thickness: 1.5 });

  const details = document.addPage(A4_LANDSCAPE);
  details.drawRectangle({ x: 0, y: 0, width, height, color: PRINT.white });
  details.drawText("Feldübersicht", { x: 42, y: height - 42, size: 20, font: bold, color: PRINT.text });
  details.drawText(`Thermischer Trennabstand: ${Math.round((input.separationGapM ?? 0) * 1000)} mm`, { x: 42, y: height - 64, size: 10, font: regular, color: PRINT.secondary });
  if (input.module) {
    const dimensions = input.module.widthM && input.module.heightM
      ? ` · ${input.module.widthM.toFixed(3)} × ${input.module.heightM.toFixed(3)} m`
      : "";
    const orientation = input.module.orientation === "portrait" ? " · Hochformat" : input.module.orientation === "landscape" ? " · Querformat" : "";
    details.drawText(`Modul: ${input.module.label}${dimensions}${orientation}`, { x: 42, y: height - 79, size: 9, font: regular, color: PRINT.secondary });
  }
  const columns = { field: 42, size: 120, modules: 280, blocks: 390, limit: 470, status: 650 };
  let y = height - 112;
  details.drawLine({ start: { x: 42, y: y + 13 }, end: { x: width - 42, y: y + 13 }, color: PRINT.border, thickness: 0.7 });
  details.drawText("Feld", { x: columns.field, y, size: 8, font: bold, color: PRINT.muted });
  details.drawText("Maße", { x: columns.size, y, size: 8, font: bold, color: PRINT.muted });
  details.drawText("Module", { x: columns.modules, y, size: 8, font: bold, color: PRINT.muted });
  details.drawText("Blöcke", { x: columns.blocks, y, size: 8, font: bold, color: PRINT.muted });
  details.drawText("Grenze", { x: columns.limit, y, size: 8, font: bold, color: PRINT.muted });
  details.drawText("Status", { x: columns.status, y, size: 8, font: bold, color: PRINT.muted });
  y -= 22;
  input.fields.forEach((field) => {
    details.drawRectangle({ x: columns.field, y: y - 2, width: 8, height: 8, color: hex(field.color) });
    details.drawText(field.displayId, { x: columns.field + 15, y, size: 10, font: bold, color: PRINT.text });
    details.drawText(`${field.lengthM.toFixed(2)} × ${field.widthM.toFixed(2)} m`, { x: columns.size, y, size: 9, font: regular, color: PRINT.text });
    details.drawText(String(field.moduleCount), { x: columns.modules, y, size: 9, font: regular, color: PRINT.text });
    details.drawText(field.blockCount === undefined ? "-" : String(field.blockCount), { x: columns.blocks, y, size: 9, font: regular, color: PRINT.text });
    const limits = [field.lengthLimitM, field.widthLimitM]
      .filter((value): value is number => value !== undefined)
      .map((value) => value.toFixed(2));
    details.drawText(limits.length ? `${limits.join(" × ")} m` : "-", { x: columns.limit, y, size: 9, font: regular, color: PRINT.secondary });
    details.drawText(field.valid ? "OK" : "Grenzwert überschritten", { x: columns.status, y, size: 9, font: bold, color: field.valid ? PRINT.success : PRINT.warning });
    details.drawLine({ start: { x: 42, y: y - 9 }, end: { x: width - 42, y: y - 9 }, color: PRINT.border, thickness: 0.45 });
    y -= 26;
  });
  details.drawText("Vorplanung: Statik, Wind- und Schneelasten, Ballastierung und Befestigung wurden nicht geprüft.", { x: 42, y: 34, size: 8, font: regular, color: PRINT.muted });
  return document.save();
}

export async function downloadThermalFieldPdf(input: ThermalFieldPdfInput): Promise<void> {
  const bytes = await buildThermalFieldPdf(input);
  const blob = new Blob([new Uint8Array(bytes).buffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `thermische-felder-${input.roof.id}.pdf`;
  anchor.click();
  URL.revokeObjectURL(url);
}
