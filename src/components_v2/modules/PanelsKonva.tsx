'use client';

import React from 'react';
import { Group, Image as KonvaImage, Rect } from 'react-konva';
import { usePlannerV2Store } from '../state/plannerV2Store';

type Pt = { x: number; y: number };

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

  // 1) store (prendi tutto e filtra fuori dal selector)
  const allPanels  = usePlannerV2Store((s) => s.panels);
  const updatePanel = usePlannerV2Store((s) => s.updatePanel);
  const panels = React.useMemo(() => allPanels.filter(p => p.roofId === roofId), [allPanels, roofId]);

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

  // 4) DRAG MANUALE (come RoofHandlesKonva)
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
    // se non abbiamo il converter, non partiamo
    if (!stageToImg) return;
    e.cancelBubble = true;           // non propagare
    onSelect?.(panelId);
    onDragStart?.();

    const st = e.target.getStage();
    stageRef.current = st;

    const pos = st.getPointerPosition();
    if (!pos) return;
    const mouseImg = stageToImg(pos.x, pos.y);

    const p = allPanels.find(x => x.id === panelId);
    if (!p) return;

    // offset tra centro pannello e puntatore (in immagine)
    startOffsetRef.current = { dx: p.cx - mouseImg.x, dy: p.cy - mouseImg.y };
    draggingIdRef.current = panelId;

    const ns = '.paneldrag';
    st.off(ns); // safety

    st.on('mousemove' + ns + ' touchmove' + ns, () => {
      const id = draggingIdRef.current;
      const off = startOffsetRef.current;
      if (!id || !off) return;
      const mp = st.getPointerPosition();
      if (!mp) return;
      const q = stageToImg(mp.x, mp.y);
      // aggiorna SEMPRE in coordinate immagine
      updatePanel(id, { cx: q.x + off.dx, cy: q.y + off.dy });
    });

    st.on('mouseup' + ns + ' touchend' + ns + ' pointerup' + ns, endDrag);
    st.on('mouseleave' + ns, endDrag);
  }, [allPanels, onSelect, onDragStart, endDrag, stageToImg, updatePanel]);

  return (
    <Group clipFunc={clipFunc} listening>
      {panels.map((p) => {
        const sel = p.id === selectedPanelId;

        // niente draggable: drag manuale con onMouseDown
        const base = {
          key: p.id,
          x: p.cx,
          y: p.cy,
          width: p.wPx,
          height: p.hPx,
          offsetX: p.wPx / 2,
          offsetY: p.hPx / 2,
          rotation: p.angleDeg,
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
              <Rect fill="#2b4b7c" opacity={0.9} {...(base as any)} />
            )}

            {sel && (
              <Rect
                x={p.cx}
                y={p.cy}
                width={p.wPx}
                height={p.hPx}
                offsetX={p.wPx / 2}
                offsetY={p.hPx / 2}
                rotation={p.angleDeg}
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
