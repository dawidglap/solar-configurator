// src/components_v2/modules/fill/FillAreaController.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { usePlannerV2Store } from '@/components_v2/state/plannerV2Store';
import type { Pt } from '@/types/planner';

type Props = {
  stageRef: React.RefObject<any>;
  toImgCoords: (sx: number, sy: number) => Pt; // stage -> image px
};

export default function FillAreaController({ stageRef, toImgCoords }: Props) {
  const step = usePlannerV2Store(s => s.step);
  const tool = usePlannerV2Store(s => s.tool);

  // stato effimero SOLO locale
  const [anchorPx, setAnchorPx] = useState<Pt | null>(null);
  const [dragPx, setDragPx] = useState<Pt | null>(null);

  // attiva solo in modules + fill-area
  const active = step === 'modules' && tool === 'fill-area';

  // handler interni
  const onMouseDown = (e: MouseEvent) => {
    const container = stageRef.current?.getStage?.()?.container?.();
    if (!container) return;

    // posizione mouse in coordinate del container
    const rect = container.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    const p = toImgCoords(sx, sy);
    if (!anchorPx) {
      setAnchorPx(p);
      setDragPx(p);
      console.log('[FillArea] anchorPx =', p);
    } else {
      // secondo click: chiudiamo il ciclo (per ora reset)
      console.log('[FillArea] confirm rectangle from', anchorPx, 'to', p);
      setAnchorPx(null);
      setDragPx(null);
    }
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!anchorPx) return;
    const container = stageRef.current?.getStage?.()?.container?.();
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    const p = toImgCoords(sx, sy);
    setDragPx(p);
    console.log('[FillArea] dragPx =', p);
  };

  // mount/unmount degli eventi SOLO quando active
  useEffect(() => {
    const container = stageRef.current?.getStage?.()?.container?.();
    if (!active || !container) return;

    container.addEventListener('mousedown', onMouseDown);
    container.addEventListener('mousemove', onMouseMove);

    return () => {
      container.removeEventListener('mousedown', onMouseDown);
      container.removeEventListener('mousemove', onMouseMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stageRef, anchorPx, toImgCoords]);

  // reset quando esci dalla modalità
  useEffect(() => {
    if (!active) {
      setAnchorPx(null);
      setDragPx(null);
    }
  }, [active]);

  return null; // nessun render per ora
}
