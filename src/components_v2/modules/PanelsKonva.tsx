'use client';

import React from 'react';
import { Group, Image as KonvaImage, Rect } from 'react-konva';
import { usePlannerV2Store } from '../state/plannerV2Store';

type Pt = { x: number; y: number };

// ---------- SNAP ----------
const SNAP_PX = 8; // tolleranza magnetismo (px immagine). Aumenta per più “tiro”.

// ---------- helpers ----------
function longestEdgeAngle(poly: Pt[]) {
  let bestLen = -1, bestTheta = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const vx = b.x - a.x, vy = b.y - a.y;
    const len = Math.hypot(vx, vy);
    if (len > bestLen) { bestLen = len; bestTheta = Math.atan2(vy, vx); }
  }
  return bestTheta; // rad
}
function angleDiffDeg(a: number, b: number) {
  let d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export default function PanelsKonva(props: {
  roofId: string;
  roofPolygon: Pt[];
  textureUrl?: string;
  selectedPanelId?: string;
  onSelect?: (id?: string) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  stageToImg?: (x: number, y: number) => Pt; // Stage → Img
}) {
  const {
    roofId, roofPolygon, textureUrl,
    selectedPanelId, onSelect, onDragStart, onDragEnd,
    stageToImg
  } = props;

  // 1) store
  const allPanels   = usePlannerV2Store((s) => s.panels);
  const updatePanel = usePlannerV2Store((s) => s.updatePanel);
  const panels = React.useMemo(
    () => allPanels.filter(p => p.roofId === roofId),
    [allPanels, roofId]
  );

  // 2) texture
  const [img, setImg] = React.useState<HTMLImageElement | null>(null);
  React.useEffect(() => {
    if (!textureUrl) { setImg(null); return; }
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => setImg(i);
    i.src = textureUrl;
    return () => setImg(null);
  }, [textureUrl]);

  // 3) clip memoizzato
  const clipFunc = React.useCallback((ctx: any) => {
    if (!roofPolygon.length) return;
    ctx.beginPath();
    ctx.moveTo(roofPolygon[0].x, roofPolygon[0].y);
    for (let i = 1; i < roofPolygon.length; i++) ctx.lineTo(roofPolygon[i].x, roofPolygon[i].y);
    ctx.closePath();
  }, [roofPolygon]);

  // 4) angolo falda: pannelli PARALLELI alla gronda ⇒ -azimuth + 90
  const roofAzimuthDeg = usePlannerV2Store(
    (s) => s.layers.find((l) => l.id === roofId)?.azimuthDeg
  );
  const polyAngleDeg = React.useMemo(
    () => (longestEdgeAngle(roofPolygon) * 180) / Math.PI,
    [roofPolygon]
  );
  const defaultAngleDeg = React.useMemo(() => {
    if (typeof roofAzimuthDeg === 'number') {
      const eavesCanvasDeg = -roofAzimuthDeg + 90;
      return angleDiffDeg(eavesCanvasDeg, polyAngleDeg) > 5 ? polyAngleDeg : eavesCanvasDeg;
    }
    return polyAngleDeg;
  }, [roofAzimuthDeg, polyAngleDeg]);

  // 5) assi locali della falda (u // gronda, v ⟂)
  const theta = (defaultAngleDeg * Math.PI) / 180;
  const ex = { x: Math.cos(theta),  y: Math.sin(theta)  }; // u axis
  const ey = { x: -Math.sin(theta), y: Math.cos(theta)  }; // v axis
  const project = (pt: Pt) => ({ u: pt.x * ex.x + pt.y * ex.y, v: pt.x * ey.x + pt.y * ey.y });
  const fromUV  = (u: number, v: number): Pt => ({ x: u * ex.x + v * ey.x, y: u * ex.y + v * ey.y });

  // 6) DRAG MANUALE (stile RoofHandlesKonva)
  const stageRef = React.useRef<import('konva/lib/Stage').Stage | null>(null);
  const draggingIdRef = React.useRef<string | null>(null);
  const startOffsetRef = React.useRef<{ dx: number; dy: number } | null>(null);
  const dragSizeHalfRef = React.useRef<{ hw: number; hh: number } | null>(null);

  // guide per SNAP
  const guidesRef = React.useRef<{ uCenters: number[]; uEdges: number[]; vCenters: number[]; vEdges: number[] }>({
    uCenters: [], uEdges: [], vCenters: [], vEdges: []
  });

  // costruisci guide dagli altri pannelli della stessa falda (stessa orientazione ~)
  const buildGuides = React.useCallback((excludeId?: string) => {
    const uCenters: number[] = [], uEdges: number[] = [];
    const vCenters: number[] = [], vEdges: number[] = [];
    for (const t of allPanels) {
      if (t.roofId !== roofId || t.id === excludeId) continue;

      const tAngle = (typeof t.angleDeg === 'number' ? t.angleDeg : defaultAngleDeg) || 0;
      // differenza angolare rispetto all’asse falda: se >5° salta (non vogliamo snap tra orientazioni diverse)
      if (angleDiffDeg(tAngle, defaultAngleDeg) > 5) continue;

      const { u, v } = project({ x: t.cx, y: t.cy });
      uCenters.push(u);
      uEdges.push(u - t.wPx / 2, u + t.wPx / 2);
      vCenters.push(v);
      vEdges.push(v - t.hPx / 2, v + t.hPx / 2);
    }
    return { uCenters, uEdges, vCenters, vEdges };
  }, [allPanels, roofId, defaultAngleDeg, project]);

  const endDrag = React.useCallback(() => {
    const st = stageRef.current;
    if (st) st.off('.paneldrag');
    draggingIdRef.current = null;
    startOffsetRef.current = null;
    dragSizeHalfRef.current = null;
    onDragEnd?.();
  }, [onDragEnd]);

  const startDrag = React.useCallback((panelId: string, e: any) => {
    if (!stageToImg) return;
    e.cancelBubble = true;
    onSelect?.(panelId);
    onDragStart?.();

    const st = e.target.getStage();
    stageRef.current = st;

    const pos = st.getPointerPosition();
    if (!pos) return;
    const mouseImg = stageToImg(pos.x, pos.y);

    const p = allPanels.find((x) => x.id === panelId);
    if (!p) return;

    startOffsetRef.current = { dx: p.cx - mouseImg.x, dy: p.cy - mouseImg.y };
    draggingIdRef.current = panelId;
    dragSizeHalfRef.current = { hw: p.wPx / 2, hh: p.hPx / 2 };

    // precalcola guide
    guidesRef.current = buildGuides(panelId);

    const ns = '.paneldrag';
    st.off(ns);

    st.on('mousemove' + ns + ' touchmove' + ns, () => {
      const id  = draggingIdRef.current;
      const off = startOffsetRef.current;
      const sz  = dragSizeHalfRef.current;
      if (!id || !off || !sz) return;

      const mp = st.getPointerPosition();
      if (!mp) return;
      const q = stageToImg(mp.x, mp.y);

      // posizione candidata in px immagine
      const cand = { x: q.x + off.dx, y: q.y + off.dy };
      const cur  = project(cand);

      // --- SNAP 1D su u ---
      let bestU = cur.u;
      let bestDU = SNAP_PX + 1;

      // centri u
      for (const g of guidesRef.current.uCenters) {
        const du = Math.abs(cur.u - g);
        if (du <= SNAP_PX && du < bestDU) { bestDU = du; bestU = g; }
      }
      // bordi u: target = edge ± halfWidth (porta il centro del pannello in modo che il suo bordo coincida)
      for (const ePos of guidesRef.current.uEdges) {
        const cand1 = ePos - sz.hw; // far coincidere il bordo destro del pannello con ePos
        const cand2 = ePos + sz.hw; // far coincidere il bordo sinistro con ePos
        const du1 = Math.abs(cur.u - cand1);
        const du2 = Math.abs(cur.u - cand2);
        if (du1 <= SNAP_PX && du1 < bestDU) { bestDU = du1; bestU = cand1; }
        if (du2 <= SNAP_PX && du2 < bestDU) { bestDU = du2; bestU = cand2; }
      }

      // --- SNAP 1D su v ---
      let bestV = cur.v;
      let bestDV = SNAP_PX + 1;

      for (const g of guidesRef.current.vCenters) {
        const dv = Math.abs(cur.v - g);
        if (dv <= SNAP_PX && dv < bestDV) { bestDV = dv; bestV = g; }
      }
      for (const ePos of guidesRef.current.vEdges) {
        const cand1 = ePos - sz.hh;
        const cand2 = ePos + sz.hh;
        const dv1 = Math.abs(cur.v - cand1);
        const dv2 = Math.abs(cur.v - cand2);
        if (dv1 <= SNAP_PX && dv1 < bestDV) { bestDV = dv1; bestV = cand1; }
        if (dv2 <= SNAP_PX && dv2 < bestDV) { bestDV = dv2; bestV = cand2; }
      }

      const snapped = fromUV(bestU, bestV);
      updatePanel(id, { cx: snapped.x, cy: snapped.y });
    });

    st.on('mouseup' + ns + ' touchend' + ns + ' pointerup' + ns, endDrag);
    st.on('mouseleave' + ns, endDrag);
  }, [allPanels, onSelect, onDragStart, endDrag, stageToImg, updatePanel, buildGuides, project, fromUV]);

  return (
    <Group clipFunc={clipFunc} listening>
      {panels.map((p) => {
        const sel = p.id === selectedPanelId;

        // se l'istanza ha un angolo valido, lo uso; altrimenti angolo falda
        const hasAngle = typeof p.angleDeg === 'number' && Math.abs(p.angleDeg) > 1e-6;
        const rotationDeg = hasAngle ? (p.angleDeg as number) : defaultAngleDeg;

        const base = {
          key: p.id,
          x: p.cx,
          y: p.cy,
          width: p.wPx,
          height: p.hPx,
          offsetX: p.wPx / 2,
          offsetY: p.hPx / 2,
          rotation: rotationDeg,
          onMouseDown: (e: any) => startDrag(p.id, e),
          onTouchStart: (e: any) => startDrag(p.id, e),
          onClick: () => onSelect?.(p.id),
          onTap: () => onSelect?.(p.id),
        } as const;

        return (
          <React.Fragment key={p.id}>
            {img ? (
              <KonvaImage image={img} opacity={1} {...(base as any)} />
            ) : (
              <Rect fill="#0f172a" opacity={0.95} {...(base as any)} />
            )}

            {sel && (
              <Rect
                x={p.cx}
                y={p.cy}
                width={p.wPx}
                height={p.hPx}
                offsetX={p.wPx / 2}
                offsetY={p.hPx / 2}
                rotation={rotationDeg}
                stroke="#60a5fa"
                strokeWidth={1}
                dash={[6, 4]}
                listening={false}
              />
            )}
          </React.Fragment>
        );
      })}
    </Group>
  );
}
