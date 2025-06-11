"use client";

import { useRef, useState } from "react";
import Moveable from "react-moveable";

export function TransformableBox() {
  const targetRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState({
    translate: [300, 300],
    rotate: 0,
    width: 200,
    height: 100,
  });

  return (
    <>
      {/* Elemento visivo */}
      <div
        ref={targetRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: `${frame.width}px`,
          height: `${frame.height}px`,
          transform: `translate(${frame.translate[0]}px, ${frame.translate[1]}px) rotate(${frame.rotate}deg)`,
          background: "rgba(0, 123, 255, 0.2)",
          border: "2px solid #007bff",
          zIndex: 600,
        }}
      />

      {/* Componente Moveable */}
      <Moveable
        target={targetRef}
        draggable
        resizable
        rotatable
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
