// src/components_v2/canvas/panels/PanelHotkeys.tsx
'use client';

import { useEffect, useMemo } from 'react';
import { usePlannerV2Store } from '../../state/plannerV2Store';
// ⬇️ NUOVO: helpers per orientamento falda + zone riservate
import { longestEdgeAngle, angleDiffDeg } from './math';
import { isInReservedZone } from '../../zones/utils';

type Pt = { x: number; y: number };

const deg2rad = (d: number) => (d * Math.PI) / 180;


type Props = {
  disabled: any;
  /** Modalità controllata (singolo pannello): se presente, usa queste props */
  selectedPanelId?: string;
  onDelete?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  /**
   * Converte un delta in coordinate SCHERMO (stage)
   * in un delta nelle coordinate IMMAGINE (cx, cy) dei pannelli.
   * Passata da CanvasStage e basata su toImgCoords.
   */
  nudgeFromScreenDelta?: (sx: number, sy: number) => { dx: number; dy: number };
};

/** Clipboard interna (ids dei pannelli copiati) */
let PANEL_CLIPBOARD: string[] = [];

// ⬇️ NUOVO: geometria falda + vincoli Randabstand / overlap

type RoofGeom = {
  roofId: string;
  poly: Pt[];
  defaultAngleDeg: number;
  project: (p: Pt) => { u: number; v: number };
  uvBounds: { minU: number; maxU: number; minV: number; maxV: number };
  edgeMarginPx: number;
  gapPx: number;
};

function buildRoofGeom(roofId: string, st: any): RoofGeom | null {
  const layers = st.layers as any[];
  const roof = layers.find((l) => l.id === roofId);
  if (!roof || !Array.isArray(roof.points) || roof.points.length < 3) return null;

  const poly: Pt[] = roof.points;

  // orientamento come in PanelsKonva
  const polyAngleDeg = (longestEdgeAngle(poly) * 180) / Math.PI;
  const roofAz: number | undefined = roof.azimuthDeg;
  let defaultAngleDeg = polyAngleDeg;
  if (typeof roofAz === 'number') {
    const eavesCanvasDeg = -roofAz + 90;
    if (angleDiffDeg(eavesCanvasDeg, polyAngleDeg) <= 5) {
      defaultAngleDeg = eavesCanvasDeg;
    }
  }

  const theta = deg2rad(defaultAngleDeg);
  const ex = { x: Math.cos(theta), y: Math.sin(theta) };   // u axis
  const ey = { x: -Math.sin(theta), y: Math.cos(theta) };  // v axis

  const project = (pt: Pt) => ({
    u: pt.x * ex.x + pt.y * ex.y,
    v: pt.x * ey.x + pt.y * ey.y,
  });

  // bounds UV falda
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const p of poly) {
    const uv = project(p);
    if (uv.u < minU) minU = uv.u;
    if (uv.u > maxU) maxU = uv.u;
    if (uv.v < minV) minV = uv.v;
    if (uv.v > maxV) maxV = uv.v;
  }

  const mpp = st.snapshot?.mppImage ?? 1;
  const marginM = st.modules?.marginM ?? 0;
  const spacingM = st.modules?.spacingM ?? 0;

  const edgeMarginPx = mpp ? marginM / mpp : 0;
  const gapPx = mpp ? spacingM / mpp : 0;

  return {
    roofId,
    poly,
    defaultAngleDeg,
    project,
    uvBounds: { minU, maxU, minV, maxV },
    edgeMarginPx,
    gapPx,
  };
}

function isInsideBoundsWithZones(
  cx: number,
  cy: number,
  geom: RoofGeom
): boolean {
  const { uvBounds, project, edgeMarginPx, roofId } = geom;
  const uv = project({ x: cx, y: cy });

  if (uv.u < uvBounds.minU + edgeMarginPx) return false;
  if (uv.u > uvBounds.maxU - edgeMarginPx) return false;
  if (uv.v < uvBounds.minV + edgeMarginPx) return false;
  if (uv.v > uvBounds.maxV - edgeMarginPx) return false;

  if (isInReservedZone({ x: cx, y: cy }, roofId)) return false;

  return true;
}

function overlapsOtherPanels(
  meId: string,
  cx: number,
  cy: number,
  geom: RoofGeom,
  st: any,
  ignoreIds: Set<string> = new Set()
): boolean {
  const panels = st.panels as any[];
  const me = panels.find((p) => p.id === meId);
  if (!me) return false;

  const meUV = geom.project({ x: cx, y: cy });
  const meHW = me.wPx / 2;
  const meHH = me.hPx / 2;
  const meAngle = typeof me.angleDeg === 'number' ? me.angleDeg : geom.defaultAngleDeg;

  const others = panels.filter(
    (p) => p.roofId === geom.roofId && p.id !== meId && !ignoreIds.has(p.id)
  );

  for (const t of others) {
    const tAngle = typeof t.angleDeg === 'number' ? t.angleDeg : geom.defaultAngleDeg;
    const diff = Math.min(
      angleDiffDeg(tAngle, meAngle),
      Math.abs(angleDiffDeg(tAngle, meAngle) - 180)
    );
    // considera solo pannelli (quasi) paralleli
    if (diff > 5) continue;

    const tUV = geom.project({ x: t.cx, y: t.cy });
    const thw = t.wPx / 2;
    const thh = t.hPx / 2;

    const minUdist = meHW + thw + geom.gapPx;
    const minVdist = meHH + thh + geom.gapPx;

    const du = Math.abs(meUV.u - tUV.u);
    const dv = Math.abs(meUV.v - tUV.v);

    if (du < minUdist && dv < minVdist) {
      return true;
    }
  }

  return false;
}

/** Nudge di UN pannello (branch controllato) con vincoli */
function tryNudgeSinglePanel(panelId: string, dx: number, dy: number) {
  const st = usePlannerV2Store.getState();
  const panels = st.panels as any[];
  const panel = panels.find((p) => p.id === panelId);
  if (!panel) return;

  const roofId: string | undefined = panel.roofId;
  if (!roofId) return;

  const geom = buildRoofGeom(roofId, st);
  if (!geom) return;

  const newCx = (panel.cx ?? 0) + dx;
  const newCy = (panel.cy ?? 0) + dy;

  if (!isInsideBoundsWithZones(newCx, newCy, geom)) return;
  if (overlapsOtherPanels(panelId, newCx, newCy, geom, st)) return;

  st.updatePanel?.(panelId, { cx: newCx, cy: newCy });
}

/** Nudge MULTI-selezione con vincoli (usa stesso dx,dy per tutti) */
function tryNudgeMultiPanels(ids: string[], dx: number, dy: number) {
  if (!ids.length) return;
  const st = usePlannerV2Store.getState();
  const panels = st.panels as any[];

  // cache geometrie falde per questa mossa
  const geomCache = new Map<string, RoofGeom>();

  const getGeom = (roofId: string): RoofGeom | null => {
    if (geomCache.has(roofId)) return geomCache.get(roofId)!;
    const g = buildRoofGeom(roofId, st);
    if (g) geomCache.set(roofId, g);
    return g;
  };

  type Cand = { id: string; roofId: string; cx: number; cy: number };
  const candidates: Cand[] = [];

  for (const id of ids) {
    const p = panels.find((pp) => pp.id === id);
    if (!p) continue;
    if (!p.roofId) continue;
    const newCx = (p.cx ?? 0) + dx;
    const newCy = (p.cy ?? 0) + dy;
    candidates.push({ id, roofId: p.roofId, cx: newCx, cy: newCy });
  }

  if (!candidates.length) return;

  const ignoreSet = new Set(ids);

  // 1) validità bounds + zone
  for (const c of candidates) {
    const geom = getGeom(c.roofId);
    if (!geom) return;

    if (!isInsideBoundsWithZones(c.cx, c.cy, geom)) {
      return; // blocca l'intero movimento
    }
  }

  // 2) overlap con pannelli non selezionati
  for (const c of candidates) {
    const geom = getGeom(c.roofId);
    if (!geom) return;
    if (overlapsOtherPanels(c.id, c.cx, c.cy, geom, st, ignoreSet)) {
      return; // blocca tutto se uno collide
    }
  }

  // 3) applica spostamento
  for (const c of candidates) {
    st.updatePanel?.(c.id, { cx: c.cx, cy: c.cy });
  }
}


/**
 * Registra hotkeys per pannelli.
 * - Senza props: usa la selezione dallo store (multi-select).
 * - Con props: gestisce Delete / Duplica / Copy/Paste sul singolo `selectedPanelId`.
 *
 * In più: intercetta anche la S per il tool “snow guard” quando siamo nello step building.
 */
export default function PanelHotkeys(props: Props) {
  // 🔹 destrutturiamo i props per avere deps pulite
  const {
    disabled,
    nudgeFromScreenDelta,
    selectedPanelId,
    onDelete,
    onDuplicate,
  } = props;

  // ====== Store (fallback / multi-select) ======
  const panels = usePlannerV2Store((s) => s.panels);
  const selectedIds = usePlannerV2Store((s) => s.selectedPanelIds);

  const setSelectedPanels = usePlannerV2Store((s) => s.setSelectedPanels);
  const clearPanelSelection = usePlannerV2Store((s) => s.clearPanelSelection);

  const deletePanelFromStore = usePlannerV2Store((s) => s.deletePanel);
  const deletePanelsBulk = usePlannerV2Store((s) => s.deletePanelsBulk);
  const duplicatePanelInStore = usePlannerV2Store((s) => s.duplicatePanel);

  // spostamento pannelli
  const updatePanel = usePlannerV2Store((s) => s.updatePanel);

  // step/tool globali
  const step = usePlannerV2Store((s) => (s as any).step ?? (s as any).ui?.step);
  const tool = usePlannerV2Store((s) => (s as any).tool ?? (s as any).ui?.tool);
  const setTool = usePlannerV2Store((s) => s.setTool);

  // mappa id -> panel (utile per verificare esistenza)
  const panelById = useMemo(() => {
    const map = new Map<string, (typeof panels)[number]>();
    for (const p of panels) map.set(p.id, p);
    return map;
  }, [panels]);

  const useControlled =
    !!selectedPanelId && !!onDelete && !!onDuplicate;

  useEffect(() => {
    const isTextTarget = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return (
        !!el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          (el as any).isContentEditable)
      );
    };

    // converte un vettore schermata (sx,sy) in delta immagine (dx,dy)
    const computeDeltaImg = (key: string, stepImg: number) => {
      // vettore in coordinate SCHERMO:
      let sx = 0;
      let sy = 0;

      switch (key) {
        case 'ArrowUp':
          sx = 0;
          sy = -stepImg;
          break;
        case 'ArrowDown':
          sx = 0;
          sy = stepImg;
          break;
        case 'ArrowLeft':
          sx = -stepImg;
          sy = 0;
          break;
        case 'ArrowRight':
          sx = stepImg;
          sy = 0;
          break;
        default:
          return { dx: 0, dy: 0 };
      }

      if (!nudgeFromScreenDelta) {
        // fallback: nessuna trasformazione, si lavora già in img-coords
        return { dx: sx, dy: sy };
      }

      return nudgeFromScreenDelta(sx, sy);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // 0) se stai scrivendo, esci
      if (isTextTarget(e.target)) return;
      if (disabled) return;

      const key = e.key;

      // 1) HOTKEY TOOL: S → snow guard (solo building)
      if ((key === 's' || key === 'S') && step === 'building') {
        e.preventDefault();
        e.stopPropagation();
        setTool('draw-snow-guard' as any);
        return;
      }

      // gestione pannelli solo in step "modules" e tool "select"
      if (step && step !== 'modules') return;
      if (tool && tool !== 'select') return;

      const isArrowKey =
        key === 'ArrowUp' ||
        key === 'ArrowDown' ||
        key === 'ArrowLeft' ||
        key === 'ArrowRight';

      // ===== Modalità CONTROLLATA (singolo pannello via props) =====
      if (useControlled) {
        const id = selectedPanelId!;
        const panel = panelById.get(id);
        if (!panel) return;

        // Copy
        if ((e.metaKey || e.ctrlKey) && key.toLowerCase() === 'c') {
          e.preventDefault();
          PANEL_CLIPBOARD = [id];
          return;
        }

        // Paste → duplica il corrente
        if ((e.metaKey || e.ctrlKey) && key.toLowerCase() === 'v') {
          e.preventDefault();
          onDuplicate!(id);
          return;
        }

        // Delete / Backspace
        if (key === 'Delete' || key === 'Backspace') {
          e.preventDefault();
          onDelete!(id);
          return;
        }

        // Cmd/Ctrl+D → duplica
        if ((e.metaKey || e.ctrlKey) && key.toLowerCase() === 'd') {
          e.preventDefault();
          onDuplicate!(id);
          return;
        }

      
      // 🔁 NUDGE CON FRECCE (singolo pannello, rispetto allo schermo)
if (isArrowKey) {
  e.preventDefault();

  const stepImg = e.shiftKey ? 5 : 1; // px immagine
  const { dx, dy } = computeDeltaImg(key, stepImg);
  if (!dx && !dy) return;

  // ⬇️ NUOVO: applica vincoli Randabstand + no-overlap
  tryNudgeSinglePanel(id, dx, dy);
}


        return;
      }

      // ===== Modalità STORE (multi-select) =====

      // 🔁 NUDGE CON FRECCE (multi-selezione, rispetto allo schermo)
   // 🔁 NUDGE CON FRECCE (multi-selezione, rispetto allo schermo)
if (isArrowKey) {
  if (!selectedIds?.length) return;
  e.preventDefault();

  const stepImg = e.shiftKey ? 5 : 0.5; // px immagine
  const { dx, dy } = computeDeltaImg(key, stepImg);
  if (!dx && !dy) return;

  // ⬇️ NUOVO: prova a spostare TUTTI i pannelli selezionati rispettando i vincoli
  tryNudgeMultiPanels(selectedIds, dx, dy);

  return;
}


      // ESC → clear
      if (key === 'Escape') {
        if (selectedIds.length) {
          e.preventDefault();
          clearPanelSelection();
        }
        return;
      }

      // Cmd/Ctrl + A → select all
      if ((key === 'a' || key === 'A') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();

        let targetRoofId: string | undefined;
        if (selectedIds.length) {
          const first = panelById.get(selectedIds[0]);
          targetRoofId = first?.roofId;
        }

        const ids = panels
          .filter((p) => (targetRoofId ? p.roofId === targetRoofId : true))
          .map((p) => p.id);

        setSelectedPanels(ids);
        return;
      }

      // Cmd/Ctrl + C → copia
      if ((e.metaKey || e.ctrlKey) && key.toLowerCase() === 'c') {
        if (!selectedIds?.length) return;
        e.preventDefault();
        PANEL_CLIPBOARD = [...selectedIds];
        return;
      }

      // Cmd/Ctrl + V → incolla / duplica
      if ((e.metaKey || e.ctrlKey) && key.toLowerCase() === 'v') {
        e.preventDefault();
        const toPaste = (PANEL_CLIPBOARD ?? []).filter((id) => panelById.has(id));
        if (!toPaste.length && selectedIds.length) {
          toPaste.push(...selectedIds);
        }
        if (!toPaste.length) return;

        const newIds: string[] = [];
        let k = 0;
        for (const id of toPaste) {
          const nid = duplicatePanelInStore(id, 18 * (k + 1));
          if (nid) newIds.push(nid);
          k++;
        }
        if (newIds.length) setSelectedPanels(newIds);
        return;
      }

      // DELETE / BACKSPACE → elimina selezione
      if (key === 'Delete' || key === 'Backspace') {
        if (!selectedIds?.length) return;
        e.preventDefault();
        if (deletePanelsBulk) {
          deletePanelsBulk(selectedIds);
        } else if (selectedIds.length === 1) {
          deletePanelFromStore(selectedIds[0]);
        } else {
          selectedIds.forEach((id) => deletePanelFromStore(id));
        }
        setSelectedPanels([]);
        return;
      }

      // Cmd/Ctrl + D → duplica selezione
      if ((e.metaKey || e.ctrlKey) && key.toLowerCase() === 'd') {
        if (!selectedIds?.length) return;
        e.preventDefault();
        const newIds: string[] = [];
        let k = 0;
        for (const id of selectedIds) {
          const nid = duplicatePanelInStore(id, 18 * (k + 1));
          if (nid) newIds.push(nid);
          k++;
        }
        if (newIds.length) setSelectedPanels(newIds);
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    // props destrutturati
    disabled,
    nudgeFromScreenDelta,
    selectedPanelId,
    onDelete,
    onDuplicate,
    // altri
    useControlled,
    panels,
    selectedIds,
    step,
    tool,
    setTool,
    panelById,
    clearPanelSelection,
    setSelectedPanels,
    deletePanelFromStore,
    deletePanelsBulk,
    duplicatePanelInStore,
    updatePanel,
  ]);

  return null;
}
