// src/components_v2/modules/fill/FillAreaController.tsx
'use client';

import { useEffect, useState } from 'react';
import { usePlannerV2Store } from '@/components_v2/state/plannerV2Store';
import type { Pt } from '@/types/planner';

type Props = {
  stageRef: React.RefObject<any>;
  toImgCoords: (sx: number, sy: number) => Pt; // stage -> image px
  onDraftChange?: (draft: { a: Pt; b: Pt } | null) => void; // ⬅️ NEW
};

export default function FillAreaController({ stageRef, toImgCoords, onDraftChange }: Props) {
  const step = usePlannerV2Store(s => s.step);
  const tool = usePlannerV2Store(s => s.tool);

  const [anchorPx, setAnchorPx] = useState<Pt | null>(null);

  const active = step === 'modules' && tool === 'fill-area';

  const getMouseImg = (e: MouseEvent): Pt | null => {
    const container = stageRef.current?.getStage?.()?.container?.();
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    return toImgCoords(sx, sy);
  };

  const onMouseDown = (e: MouseEvent) => {
    const p = getMouseImg(e);
    if (!p) return;

    if (!anchorPx) {
      setAnchorPx(p);
      onDraftChange?.({ a: p, b: p });
    } else {
      // conferma (per ora: reset)
      onDraftChange?.(null);
      setAnchorPx(null);
    }
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!anchorPx) return;
    const p = getMouseImg(e);
    if (!p) return;
    onDraftChange?.({ a: anchorPx, b: p });
  };

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

  useEffect(() => {
    if (!active) {
      onDraftChange?.(null);
      setAnchorPx(null);
    }
  }, [active, onDraftChange]);

  return null;
}
