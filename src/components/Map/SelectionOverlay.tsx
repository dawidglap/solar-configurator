"use client";

import { useState, MouseEvent } from "react";

export function SelectionOverlay({
  onComplete,
}: {
  onComplete: (box: { x: number; y: number; width: number; height: number }) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [previewBox, setPreviewBox] = useState<null | {
    x: number;
    y: number;
    width: number;
    height: number;
  }>(null);

  const handleMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    const x = e.clientX;
    const y = e.clientY;
    setStartPoint({ x, y });
    setPreviewBox({ x, y, width: 0, height: 0 });
    setIsDragging(true);
  };

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!isDragging || !startPoint) return;
    const width = e.clientX - startPoint.x;
    const height = e.clientY - startPoint.y;
    setPreviewBox({ x: startPoint.x, y: startPoint.y, width, height });
  };

  const handleMouseUp = () => {
    if (previewBox) {
      onComplete(previewBox); // Passa i dati al genitore
    }
    setPreviewBox(null);
    setIsDragging(false);
    setStartPoint(null);
  };

  return (
    <div
      className="absolute top-0 left-0 w-full h-full z-[400] cursor-crosshair"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {previewBox && (
        <div
          className="absolute border-2 border-dashed border-green-500 bg-green-300/20 pointer-events-none"
          style={{
            left: Math.min(previewBox.x, previewBox.x + previewBox.width),
            top: Math.min(previewBox.y, previewBox.y + previewBox.height),
            width: Math.abs(previewBox.width),
            height: Math.abs(previewBox.height),
          }}
        />
      )}
    </div>
  );
}
