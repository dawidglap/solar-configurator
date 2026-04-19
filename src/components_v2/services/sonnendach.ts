'use client';

import type { Pt } from '@/components_v2/utils/geo';
import {
  merc3857ToLonLat,
  lonLatToImagePx,
  lonLatTo3857,
  type GeoSnapshot,
} from '@/components_v2/utils/geo';

// ─────────────────────────────────────────────────────────────
// TIPI
// ─────────────────────────────────────────────────────────────

export type SonnRoofPoly = {
  id: string;
  pointsPx: Pt[]; // coordinate in PX immagine
  tiltDeg?: number; // neigung
  azimuthDeg?: number; // ausrichtung
  eignung?: string; // idoneità

  // nuovi campi utili per report realistici
  areaM2?: number; // area falda se disponibile da API
  irradiationKwhM2?: number; // irraggiamento annuo stimato
  yearlyPvYieldKwh?: number; // resa PV annuale stimata se disponibile
  specificYieldKwhKw?: number; // opzionale se API la restituisce già

  raw?: any;
};

// ─────────────────────────────────────────────────────────────
// MANOPOLE DI SENSIBILITÀ
// ─────────────────────────────────────────────────────────────

export const ROOF_FILTERS = {
  MIN_AREA_M2: 0.5,
  SIMPLIFY_EPS_M: 0.15,
  MIN_COMPACTNESS: 0.02,
  CLUSTER_DIST_M: 2.5,
  MERGE_ANGLE_DEG: 35,
  MERGE_STRATEGY: 'largest',
} as const;

const DEBUG_COUNTS = false;
const DEBUG_ATTRS = false;

// ─────────────────────────────────────────────────────────────
// HELPERS GENERICI
// ─────────────────────────────────────────────────────────────

function safeNumber(v: any): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function safeString(v: any): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function lowerKeys(obj: Record<string, any> | undefined | null) {
  if (!obj || typeof obj !== 'object') return {} as Record<string, any>;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k.toLowerCase()] = v;
  }
  return out;
}

function readAttrNumber(attrs: Record<string, any>, keys: string[]): number | undefined {
  const map = lowerKeys(attrs);
  for (const key of keys) {
    const value = map[key.toLowerCase()];
    const parsed = safeNumber(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function readAttrString(attrs: Record<string, any>, keys: string[]): string | undefined {
  const map = lowerKeys(attrs);
  for (const key of keys) {
    const value = map[key.toLowerCase()];
    const parsed = safeString(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// ─────────────────────────────────────────────────────────────
// HELPERS GEO / FILTRI
// ─────────────────────────────────────────────────────────────

function polygonAreaPx2(pts: Pt[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  }
  return Math.abs(a / 2);
}

function toM2(areaPx2: number, mpp?: number) {
  return mpp ? areaPx2 * mpp * mpp : 0;
}

function perimeterPx(pts: Pt[]): number {
  let p = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    p += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return p;
}

function compactness(pts: Pt[], mpp?: number) {
  const A = toM2(polygonAreaPx2(pts), mpp);
  const Pm = perimeterPx(pts) * (mpp ?? 0);
  if (!A || !Pm) return 0;
  return (4 * Math.PI * A) / (Pm * Pm);
}

function simplifyDP(pts: Pt[], epsPx: number): Pt[] {
  if (pts.length < 3 || epsPx <= 0) return pts;

  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;

  const stack: [number, number][] = [[0, pts.length - 1]];

  const dist = (p: Pt, a: Pt, b: Pt) => {
    const A = { x: p.x - a.x, y: p.y - a.y };
    const B = { x: b.x - a.x, y: b.y - a.y };
    const len2 = B.x * B.x + B.y * B.y || 1e-9;
    const t = Math.max(0, Math.min(1, (A.x * B.x + A.y * B.y) / len2));
    const proj = { x: a.x + t * B.x, y: a.y + t * B.y };
    return Math.hypot(p.x - proj.x, p.y - proj.y);
  };

  while (stack.length) {
    const [i, j] = stack.pop()!;
    let idx = -1;
    let maxd = 0;

    for (let k = i + 1; k < j; k++) {
      const d = dist(pts[k], pts[i], pts[j]);
      if (d > maxd) {
        maxd = d;
        idx = k;
      }
    }

    if (maxd > epsPx && idx !== -1) {
      keep[idx] = true;
      stack.push([i, idx], [idx, j]);
    }
  }

  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (keep[i]) out.push(pts[i]);
  }
  return out;
}

function centroidPx(pts: Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  const n = pts.length || 1;
  return { x: x / n, y: y / n };
}

function degDiff(a?: number, b?: number) {
  if (typeof a !== 'number' || typeof b !== 'number') return 0;
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

function distPx(a: Pt, b: Pt) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ─────────────────────────────────────────────────────────────
// CONVEX HULL
// ─────────────────────────────────────────────────────────────

function convexHull(points: Pt[]): Pt[] {
  if (points.length <= 3) return points.slice();

  const pts = points.slice().sort((A, B) => A.x - B.x || A.y - B.y);
  const cross = (o: Pt, a: Pt, b: Pt) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Pt[] = [];
  for (const p of pts) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }

  upper.pop();
  lower.pop();

  return lower.concat(upper);
}

// ─────────────────────────────────────────────────────────────
// CLUSTER POLIGONI
// ─────────────────────────────────────────────────────────────

function clusterRoofPolys(
  polys: SonnRoofPoly[],
  mpp?: number,
  distM = 0.8,
  angleDeg = 12
): SonnRoofPoly[][] {
  if (!mpp || polys.length === 0) return polys.map((p) => [p]);

  const distPxThr = distM / mpp;
  const cents = polys.map((p) => centroidPx(p.pointsPx));
  const used = new Array(polys.length).fill(false);
  const groups: SonnRoofPoly[][] = [];

  for (let i = 0; i < polys.length; i++) {
    if (used[i]) continue;

    used[i] = true;
    const group = [polys[i]];
    const queue = [i];

    while (queue.length) {
      const u = queue.pop()!;
      for (let v = 0; v < polys.length; v++) {
        if (used[v]) continue;
        if (distPx(cents[u], cents[v]) > distPxThr) continue;
        if (degDiff(polys[u].azimuthDeg, polys[v].azimuthDeg) > angleDeg) continue;

        used[v] = true;
        group.push(polys[v]);
        queue.push(v);
      }
    }

    groups.push(group);
  }

  return groups;
}

// ─────────────────────────────────────────────────────────────
// MERGE
// ─────────────────────────────────────────────────────────────

function mergeGroup(
  polys: SonnRoofPoly[],
  strategy: 'hull' | 'largest' = 'hull'
): SonnRoofPoly {
  if (polys.length === 1) return polys[0];

  if (strategy === 'largest') {
    let best = polys[0];
    let bestA = polygonAreaPx2(polys[0].pointsPx);

    for (let i = 1; i < polys.length; i++) {
      const a = polygonAreaPx2(polys[i].pointsPx);
      if (a > bestA) {
        best = polys[i];
        bestA = a;
      }
    }

    return best;
  }

  const pts: Pt[] = [];
  for (const p of polys) pts.push(...p.pointsPx);

  const hull = convexHull(pts);

  let sumA = 0;
  let sumTilt = 0;
  let sumAz = 0;
  let sumIrr = 0;
  let sumYield = 0;
  let sumSpec = 0;

  let cntTilt = 0;
  let cntAz = 0;
  let cntIrr = 0;
  let cntYield = 0;
  let cntSpec = 0;

  for (const p of polys) {
    const a = polygonAreaPx2(p.pointsPx);
    sumA += a;

    if (typeof p.tiltDeg === 'number') {
      sumTilt += p.tiltDeg * a;
      cntTilt++;
    }
    if (typeof p.azimuthDeg === 'number') {
      sumAz += p.azimuthDeg * a;
      cntAz++;
    }
    if (typeof p.irradiationKwhM2 === 'number') {
      sumIrr += p.irradiationKwhM2 * a;
      cntIrr++;
    }
    if (typeof p.yearlyPvYieldKwh === 'number') {
      sumYield += p.yearlyPvYieldKwh;
      cntYield++;
    }
    if (typeof p.specificYieldKwhKw === 'number') {
      sumSpec += p.specificYieldKwhKw * a;
      cntSpec++;
    }
  }

  return {
    id: polys.map((p) => p.id).join('+'),
    pointsPx: hull,
    tiltDeg: cntTilt ? sumTilt / sumA : undefined,
    azimuthDeg: cntAz ? sumAz / sumA : undefined,
    eignung: polys[0].eignung,
    areaM2:
      polys.reduce((acc, p) => acc + (typeof p.areaM2 === 'number' ? p.areaM2 : 0), 0) || undefined,
    irradiationKwhM2: cntIrr ? sumIrr / sumA : undefined,
    yearlyPvYieldKwh: cntYield ? sumYield : undefined,
    specificYieldKwhKw: cntSpec ? sumSpec / sumA : undefined,
    raw: { merged: polys.map((p) => p.raw) },
  };
}

// ─────────────────────────────────────────────────────────────
// SNAPSHOT → EXTENT
// ─────────────────────────────────────────────────────────────

function extent4326FromSnapshot(snap: GeoSnapshot): [number, number, number, number] {
  if (snap.bbox3857) {
    const { minX, minY, maxX, maxY } = snap.bbox3857;
    const sw = merc3857ToLonLat(minX, minY);
    const ne = merc3857ToLonLat(maxX, maxY);
    return [sw.lon, sw.lat, ne.lon, ne.lat];
  }

  if (snap.center && snap.width && snap.height && snap.mppImage) {
    const hw_m = (snap.width * snap.mppImage) / 2;
    const hh_m = (snap.height * snap.mppImage) / 2;
    const c = lonLatTo3857(snap.center.lon, snap.center.lat);
    const sw = merc3857ToLonLat(c.x - hw_m, c.y - hh_m);
    const ne = merc3857ToLonLat(c.x + hw_m, c.y + hh_m);
    return [sw.lon, sw.lat, ne.lon, ne.lat];
  }

  const lon = snap.center?.lon ?? 8.55;
  const lat = snap.center?.lat ?? 47.37;
  const d = 0.002;
  return [lon - d, lat - d, lon + d, lat + d];
}

// ─────────────────────────────────────────────────────────────
// LOGICA DATI SONNENDACH
// ─────────────────────────────────────────────────────────────

function estimateSpecificYieldFromRoofData(args: {
  irradiationKwhM2?: number;
  eignung?: string;
  tiltDeg?: number;
  azimuthDeg?: number;
}): number | undefined {
  const { irradiationKwhM2, eignung, tiltDeg, azimuthDeg } = args;

  // 1) priorità all'irraggiamento reale
  if (typeof irradiationKwhM2 === 'number' && irradiationKwhM2 > 0) {
    // conversione prudente irraggiamento → specific yield
    // volutamente conservativa per preventivi rapidi
    return round1(Math.max(650, Math.min(1250, irradiationKwhM2 * 0.72)));
  }

  // 2) fallback su classe sonnendach
  const e = (eignung || '').toLowerCase();

  if (e.includes('sehr gut') || e.includes('sehrgut')) return 1120;
  if (e.includes('gut')) return 1020;
  if (e.includes('mittel')) return 900;
  if (e.includes('genügend') || e.includes('genuegend')) return 800;
  if (e.includes('schlecht')) return 720;

  // 3) fallback finale su tilt + azimuth
  if (typeof tiltDeg === 'number' || typeof azimuthDeg === 'number') {
    const tilt = typeof tiltDeg === 'number' ? tiltDeg : 20;
    const az = typeof azimuthDeg === 'number' ? azimuthDeg : 0;

    const normalizedAz = ((((az + 180) % 360) + 360) % 360) - 180;
    const absAz = Math.abs(normalizedAz);

    let base = 950;
    if (absAz <= 30) base = 1120;
    else if (absAz <= 60) base = 1060;
    else if (absAz <= 100) base = 980;
    else if (absAz <= 140) base = 860;
    else base = 720;

    if (tilt >= 15 && tilt <= 35) base += 40;
    else if (tilt >= 5 && tilt < 15) base += 10;
    else if (tilt > 35 && tilt <= 50) base -= 20;
    else if (tilt > 50) base -= 60;

    return round1(Math.max(650, Math.min(1250, base)));
  }

  return undefined;
}

// ─────────────────────────────────────────────────────────────
// FETCH + POST-FETCH
// ─────────────────────────────────────────────────────────────

export async function fetchRoofPolysForSnapshot(
  snap: GeoSnapshot,
  lang: 'de' | 'it' | 'fr' | 'en' = 'de',
  filters: Partial<typeof ROOF_FILTERS> = {}
): Promise<SonnRoofPoly[]> {
  if (!snap.width || !snap.height) return [];

  const F = { ...ROOF_FILTERS, ...filters };
  const [minLon, minLat, maxLon, maxLat] = extent4326FromSnapshot(snap);

  const base = 'https://api3.geo.admin.ch/rest/services/energie/MapServer/identify';
  const params: Record<string, string | number> = {
    geometryType: 'esriGeometryEnvelope',
    geometry: `${minLon},${minLat},${maxLon},${maxLat}`,
    sr: 4326,
    layers: 'all:ch.bfe.solarenergie-eignung-daecher',
    tolerance: 0,
    mapExtent: `${minLon},${minLat},${maxLon},${maxLat}`,
    imageDisplay: `${snap.width},${snap.height},96`,
    lang,
    returnGeometry: 'true',
    returnFieldName: 'true',
    returnUnformattedValues: 'true',
  };

  const url = `${base}?${new URLSearchParams(params as any).toString()}`;
  const resp = await fetch(url);

  if (!resp.ok) return [];

  const data = await resp.json();
  const results: any[] = data?.results ?? [];
  if (!Array.isArray(results) || results.length === 0) return [];

  const rawPolys: SonnRoofPoly[] = [];

  for (const res of results) {
    const rings: number[][][] | undefined = res?.geometry?.rings;
    if (!rings) continue;

    const attrs = res?.attributes ?? {};

    if (DEBUG_ATTRS) {
      console.log('SONNENDACH ATTRS', attrs);
    }

    for (const ring of rings) {
      const pointsPx: Pt[] = ring.map(([lon, lat]) => lonLatToImagePx(snap, lon, lat));

      const id = String(
        attrs.id ??
          attrs.objectid ??
          attrs.OBJECTID ??
          `${Date.now()}_${rawPolys.length}`
      );

      const tiltDeg = readAttrNumber(attrs, ['neigung', 'tilt', 'dachneigung']);
      const azimuthDeg = readAttrNumber(attrs, ['ausrichtung', 'azimuth', 'orientation']);
      const eignung = readAttrString(attrs, [
        'dach_eignung',
        'eignung',
        'klasse',
        'qualitaet',
        'quality',
      ]);

      const areaM2 =
        readAttrNumber(attrs, ['flaeche', 'fläche', 'area', 'shape_area']) ??
        toM2(polygonAreaPx2(pointsPx), snap.mppImage);

      const irradiationKwhM2 = readAttrNumber(attrs, [
        'strahlung',
        'globalstrahlung',
        'solarstrahlung',
        'irradiation',
        'gstrahlung',
      ]);

      const yearlyPvYieldKwh = readAttrNumber(attrs, [
        'pv_energie',
        'pvenergie',
        'ertrag',
        'yield',
        'jahresertrag',
        'stromertrag',
      ]);

      const apiSpecificYield = readAttrNumber(attrs, [
        'spez_ertrag',
        'spezertrag',
        'specific_yield',
        'specificyield',
      ]);

      const specificYieldKwhKw =
        apiSpecificYield ??
        estimateSpecificYieldFromRoofData({
          irradiationKwhM2,
          eignung,
          tiltDeg,
          azimuthDeg,
        });

      rawPolys.push({
        id,
        pointsPx,
        tiltDeg,
        azimuthDeg,
        eignung,
        areaM2,
        irradiationKwhM2,
        yearlyPvYieldKwh,
        specificYieldKwhKw,
        raw: res,
      });
    }
  }

  const epsPx = snap.mppImage ? F.SIMPLIFY_EPS_M / snap.mppImage : 0;

  const simplified =
    epsPx > 0
      ? rawPolys.map((r) => ({ ...r, pointsPx: simplifyDP(r.pointsPx, epsPx) }))
      : rawPolys;

  const afterArea = simplified.filter((r) => {
    const aM2 = typeof r.areaM2 === 'number' ? r.areaM2 : toM2(polygonAreaPx2(r.pointsPx), snap.mppImage);
    return aM2 >= F.MIN_AREA_M2;
  });

  const afterCompact = afterArea.filter(
    (r) => compactness(r.pointsPx, snap.mppImage) >= F.MIN_COMPACTNESS
  );

  const groups = clusterRoofPolys(
    afterCompact,
    snap.mppImage,
    F.CLUSTER_DIST_M,
    F.MERGE_ANGLE_DEG
  );

  const merged = groups.map((g) =>
    mergeGroup(g, F.MERGE_STRATEGY as 'hull' | 'largest')
  );

  if (DEBUG_COUNTS) {
    console.log('sonnendach count:', {
      raw: rawPolys.length,
      simplified: simplified.length,
      afterArea: afterArea.length,
      afterCompact: afterCompact.length,
      groups: groups.length,
      merged: merged.length,
    });
  }

  return merged;
}

// ─────────────────────────────────────────────────────────────
// HELPERS REPORT / BERICHT
// ─────────────────────────────────────────────────────────────

export function computeWeightedSpecificYieldForRoofs(
  roofs: Array<Pick<SonnRoofPoly, 'areaM2' | 'specificYieldKwhKw'>>
): number | undefined {
  const valid = roofs.filter(
    (r) =>
      typeof r.areaM2 === 'number' &&
      r.areaM2 > 0 &&
      typeof r.specificYieldKwhKw === 'number' &&
      r.specificYieldKwhKw > 0
  );

  if (!valid.length) return undefined;

  const weightedSum = valid.reduce(
    (sum, r) => sum + (r.areaM2 as number) * (r.specificYieldKwhKw as number),
    0
  );

  const totalArea = valid.reduce((sum, r) => sum + (r.areaM2 as number), 0);
  if (!totalArea) return undefined;

  return round1(weightedSum / totalArea);
}

export function computeWeightedIrradiationForRoofs(
  roofs: Array<Pick<SonnRoofPoly, 'areaM2' | 'irradiationKwhM2'>>
): number | undefined {
  const valid = roofs.filter(
    (r) =>
      typeof r.areaM2 === 'number' &&
      r.areaM2 > 0 &&
      typeof r.irradiationKwhM2 === 'number' &&
      r.irradiationKwhM2 > 0
  );

  if (!valid.length) return undefined;

  const weightedSum = valid.reduce(
    (sum, r) => sum + (r.areaM2 as number) * (r.irradiationKwhM2 as number),
    0
  );

  const totalArea = valid.reduce((sum, r) => sum + (r.areaM2 as number), 0);
  if (!totalArea) return undefined;

  return round1(weightedSum / totalArea);
}

/**
 * Da usare nel Bericht:
 * - passi solo le falde effettivamente usate nella pianificazione
 * - ottieni il valore globale realistico da mostrare come "Spez. Ertrag"
 */
export function computeReportSpecificYieldFromUsedRoofs(
  usedRoofs: SonnRoofPoly[]
): number {
  const fromWeighted = computeWeightedSpecificYieldForRoofs(usedRoofs);
  if (typeof fromWeighted === 'number' && fromWeighted > 0) return fromWeighted;

  const fallbackValues = usedRoofs
    .map((r) => r.specificYieldKwhKw)
    .filter((v): v is number => typeof v === 'number' && v > 0);

  if (fallbackValues.length) {
    return round1(
      fallbackValues.reduce((a, b) => a + b, 0) / fallbackValues.length
    );
  }

  return 950;
}