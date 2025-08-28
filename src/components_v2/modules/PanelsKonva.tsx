'use client';

import React from 'react';
import { Group, Image as KonvaImage, Rect } from 'react-konva';
import { usePlannerV2Store } from '../state/plannerV2Store';

type Pt = { x: number; y: number };

// — angolo (rad) del lato più lungo del poligono
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

// — differenza assoluta tra due angoli in gradi (0..180)
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
  stageToImg?: (x: number, y: number) => Pt; // converter Stage -> Immagine
}) {
  const {
    roofId, roofPolygon, textureUrl,
    selectedPanelId, onSelect, onDragStart, onDragEnd,
    stageToImg
  } = props;

  // 1) store (prendo tutto e filtro fuori dal selector → niente loop)
  const allPanels   = usePlannerV2Store(s => s.panels);
  const updatePanel = usePlannerV2Store(s => s.updatePanel);
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

  // 4) angoli di riferimento falda
  //    - Sonnendach azimuthDeg = direzione pendenza (0=N, 90=E)
  //    - Pannelli devono essere PARALLELI alla gronda ⇒ -azimuth + 90
  const roofAzimuthDeg = usePlannerV2Store(
    s => s.layers.find(l => l.id === roofId)?.azimuthDeg
  );
  const polyAngleDeg = React.useMemo(
    () => (longestEdgeAngle(roofPolygon) * 180) / Math.PI,
    [roofPolygon]
  );
  const defaultAngleDeg = React.useMemo(() => {
    if (typeof roofAzimuthDeg === 'number') {
      const eavesCanvasDeg = -roofAzimuthDeg + 90; // 🔧 chiave: parallelo alla gronda
      // se la geometria è stata ruotata e diverge >5°, seguiamo il poligono
      return angleDiffDeg(eavesCanvasDeg, polyAngleDeg) > 5 ? polyAngleDeg : eavesCanvasDeg;
    }
    return polyAngleDeg;
  }, [roofAzimuthDeg, polyAngleDeg]);

  // 5) DRAG MANUALE (stile RoofHandlesKonva) → niente "teletrasporti"
  const stageRef = React.useRef<import('konva/lib/Stage').Stage | null>(null);
  const draggingIdRef = React.useRef<string | null>(null);
  const startOffsetRef = React.useRef<{ dx: number; dy: number } | null>(null);

  const endDrag = React.useCallback(() => {
    const st = stageRef.current;
    if (st) st.off('.paneldrag');
    draggingIdRef.current = null;
    startOffsetRef.current = null;
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

    const p = allPanels.find(x => x.id === panelId);
    if (!p) return;

    startOffsetRef.current = { dx: p.cx - mouseImg.x, dy: p.cy - mouseImg.y };
    draggingIdRef.current = panelId;

    const ns = '.paneldrag';
    st.off(ns);

    st.on('mousemove' + ns + ' touchmove' + ns, () => {
      const id = draggingIdRef.current;
      const off = startOffsetRef.current;
      if (!id || !off) return;
      const mp = st.getPointerPosition();
      if (!mp) return;
      const q = stageToImg(mp.x, mp.y);
      updatePanel(id, { cx: q.x + off.dx, cy: q.y + off.dy });
    });

    st.on('mouseup' + ns + ' touchend' + ns + ' pointerup' + ns, endDrag);
    st.on('mouseleave' + ns, endDrag);
  }, [allPanels, onSelect, onDragStart, endDrag, stageToImg, updatePanel]);

  return (
    <Group clipFunc={clipFunc} listening>
      {panels.map((p) => {
        const sel = p.id === selectedPanelId;

        // se l'istanza ha un angolo valido lo rispettiamo; altrimenti usiamo l'angolo di falda
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
