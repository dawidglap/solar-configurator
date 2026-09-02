export function imageVectorFromGeographicAzimuth(azimuthDeg: number): {
  x: number;
  y: number;
} {
  const radians = (azimuthDeg * Math.PI) / 180;
  return { x: Math.sin(radians), y: -Math.cos(radians) };
}

export type ModuleRowArrowCandidate = {
  id: string;
  cx: number;
  cy: number;
  hPx: number;
};

/**
 * Keeps direction arrows informative without repeating them on every module.
 * Rows are resolved in the layout-local frame, so rotated roofs remain stable.
 */
export function selectModuleSlopeArrowIds(input: {
  modules: readonly ModuleRowArrowCandidate[];
  rowAxisCanvasDeg: number;
  maxPerRow?: number;
}): Set<string> {
  const maxPerRow = Math.max(0, Math.floor(input.maxPerRow ?? 3));
  if (!maxPerRow || !input.modules.length) return new Set();
  const radians = input.rowAxisCanvasDeg * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const candidates = input.modules.map((module) => ({
    ...module,
    u: module.cx * cos + module.cy * sin,
    v: -module.cx * sin + module.cy * cos,
  })).sort((first, second) => first.v - second.v || first.u - second.u || first.id.localeCompare(second.id));
  const minimumHeight = Math.min(...candidates.map((candidate) => Math.max(1, candidate.hPx)));
  const rowTolerance = Math.max(0.75, minimumHeight * 0.3);
  const rows: Array<{ centerV: number; modules: typeof candidates }> = [];
  candidates.forEach((candidate) => {
    let row = rows.find((item) => Math.abs(item.centerV - candidate.v) <= rowTolerance);
    if (!row) {
      row = { centerV: candidate.v, modules: [] };
      rows.push(row);
    }
    row.modules.push(candidate);
    row.centerV = row.modules.reduce((sum, item) => sum + item.v, 0) / row.modules.length;
  });
  return new Set(rows.flatMap((row) =>
    row.modules.sort((first, second) => first.u - second.u || first.id.localeCompare(second.id))
      .slice(0, maxPerRow)
      .map((module) => module.id),
  ));
}
