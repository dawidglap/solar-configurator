'use client';

import { useCallback, useMemo, useRef, useState } from 'react';

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
    const [isRightPanning, setIsRightPanning] = useState(false);
    const viewRef = useRef(view);
    viewRef.current = view;
    const activeStageRef = useRef<any>(null);
    const finalOffsetRef = useRef<{ x: number; y: number } | null>(null);
    const rightPanRef = useRef<{
        clientX: number;
        clientY: number;
        offsetX: number;
        offsetY: number;
    } | null>(null);

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
            finalOffsetRef.current = cl;
        },
        [view.scale, view.fitScale, clampOffset]
    );

    const onDragEnd = useCallback(() => {
        const final = finalOffsetRef.current;
        finalOffsetRef.current = null;
        if (final) setView({ offsetX: final.x, offsetY: final.y });
    }, [setView]);

    const beginRightPan = useCallback(
        (event: MouseEvent, stage?: any) => {
            if (event.button !== 2) return false;

            activeStageRef.current = stage ?? null;

            rightPanRef.current = {
                clientX: event.clientX,
                clientY: event.clientY,
                offsetX: viewRef.current.offsetX || 0,
                offsetY: viewRef.current.offsetY || 0,
            };
            setIsRightPanning(true);
            return true;
        },
        []
    );

    const moveRightPan = useCallback(
        (event: MouseEvent) => {
            const start = rightPanRef.current;
            if (!start) return false;

            const currentView = viewRef.current;
            const scale = currentView.scale || currentView.fitScale || 1;
            const clamped = clampOffset(
                scale,
                start.offsetX + event.clientX - start.clientX,
                start.offsetY + event.clientY - start.clientY,
            );
            finalOffsetRef.current = clamped;
            const stage = activeStageRef.current;
            if (stage) {
                stage.position({ x: clamped.x, y: clamped.y });
                stage.batchDraw();
            }
            return true;
        },
        [clampOffset, setView]
    );

    const endRightPan = useCallback(() => {
        if (!rightPanRef.current) return false;
        rightPanRef.current = null;
        const final = finalOffsetRef.current;
        finalOffsetRef.current = null;
        activeStageRef.current = null;
        if (final) setView({ offsetX: final.x, offsetY: final.y });
        setIsRightPanning(false);
        return true;
    }, [setView]);

    return {
        canDrag,
        isRightPanning,
        onWheel,
        onDragMove,
        onDragEnd,
        beginRightPan,
        moveRightPan,
        endRightPan,
    };
}
