'use client';

import { useCallback, useMemo } from 'react';

type Size = { w: number; h: number };
type View = { scale?: number; fitScale?: number; offsetX?: number; offsetY?: number };

export function useStagePanZoom({
    img,
    size,
    view,
    setView,
}: {
    img: HTMLImageElement | null;
    size: Size;
    view: View;
    setView: (patch: Partial<View>) => void;
}) {
    const clampOffset = useCallback(
        (scale: number, ox: number, oy: number) => {
            if (!img) return { x: 0, y: 0 };
            const sw = img.naturalWidth * scale;
            const sh = img.naturalHeight * scale;

            if (sw <= size.w) ox = (size.w - sw) / 2;
            if (sh <= size.h) oy = (size.h - sh) / 2;

            const minX = Math.min(0, size.w - sw);
            const maxX = 0;
            const minY = Math.min(0, size.h - sh);
            const maxY = 0;

            ox = Math.max(minX, Math.min(maxX, ox));
            oy = Math.max(minY, Math.min(maxY, oy));
            return { x: ox, y: oy };
        },
        [img, size.w, size.h]
    );

    const clampScale = useCallback(
        (s: number) => {
            const min = view.fitScale || 1;
            const max = (view.fitScale || 1) * 8;
            return Math.max(min, Math.min(max, s));
        },
        [view.fitScale]
    );

    const canDrag = useMemo(() => {
        const s = view.scale || view.fitScale || 1;
        if (!img) return false;
        return img.naturalWidth * s > size.w || img.naturalHeight * s > size.h;
    }, [img, size.w, size.h, view.scale, view.fitScale]);

    const onWheel = useCallback(
        (e: any) => {
            e.evt.preventDefault();
            if (!img) return;

            const stage = e.target.getStage();
            const pointer = stage.getPointerPosition();
            const oldScale = view.scale || view.fitScale || 1;
            const raw = e.evt.deltaY > 0 ? oldScale / 1.1 : oldScale * 1.1;
            const newScale = clampScale(raw);

            const worldX = (pointer.x - (view.offsetX || 0)) / oldScale;
            const worldY = (pointer.y - (view.offsetY || 0)) / oldScale;

            let newOX = pointer.x - worldX * newScale;
            let newOY = pointer.y - worldY * newScale;

            const cl = clampOffset(newScale, newOX, newOY);
            setView({ scale: newScale, offsetX: cl.x, offsetY: cl.y });
        },
        [img, view.scale, view.fitScale, view.offsetX, view.offsetY, clampScale, clampOffset, setView]
    );

    const onDragMove = useCallback(
        (e: any) => {
            const ox = e.target.x();
            const oy = e.target.y();
            const s = view.scale || view.fitScale || 1;
            const cl = clampOffset(s, ox, oy);
            e.target.position({ x: cl.x, y: cl.y });
            setView({ offsetX: cl.x, offsetY: cl.y });
        },
        [view.scale, view.fitScale, clampOffset, setView]
    );

    return { canDrag, onWheel, onDragMove };
}
