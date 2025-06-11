// components/MoveableBox.tsx
"use client";

import Moveable from "react-moveable";
import { useRef, useState } from "react";

export function MoveableBox({
  initialX,
  initialY,
  initialWidth = 200,
  initialHeight = 100,
}: {
  initialX: number;
  initialY: number;
  initialWidth?: number;
  initialHeight?: number;
}) {
  const targetRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState({
    translate: [initialX, initialY],
    rotate: 0,
    width: initialWidth,
    height: initialHeight,
  });

  return (
    <>
      <div
        ref={targetRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: `${frame.width}px`,
          height: `${frame.height}px`,
          transform: `translate(${frame.translate[0]}px, ${frame.translate[1]}px) rotate(${frame.rotate}deg)`,
          background: "rgba(59, 130, 246, 0.2)",
          border: "2px solid #3b82f6",
          zIndex: 600,
        }}
      />

      <Moveable
        target={targetRef}
        draggable
        resizable
        rotatable
        origin={false}
        throttleDrag={0}
        throttleResize={0}
        throttleRotate={0}
        onDrag={({ beforeTranslate }) => {
          setFrame((f) => ({ ...f, translate: beforeTranslate }));
        }}
        onResize={({ width, height, drag }) => {
          setFrame((f) => ({
            ...f,
            width,
            height,
            translate: drag.beforeTranslate,
          }));
        }}
        onRotate={({ rotate }) => {
          setFrame((f) => ({ ...f, rotate }));
        }}
      />
    </>
  );
}
