"use client";

import { useRef, useState } from "react";

export function RotatableResizableBox({
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
  const boxRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: initialX, y: initialY });
  const [size, setSize] = useState({ width: initialWidth, height: initialHeight });
  const [rotation, setRotation] = useState(0);
  const [dragging, setDragging] = useState(false);

  // DRAG
  const handleBoxMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).dataset.handle) return;
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const startPos = { ...position };

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      setPosition({ x: startPos.x + dx, y: startPos.y + dy });
    };

    const handleMouseUp = () => {
      setDragging(false);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    setDragging(true);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // ROTATE
  const handleRotateMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const rect = boxRef.current!.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX);
    const startRotation = rotation;

    const handleMouseMove = (e: MouseEvent) => {
      const currentAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX);
      const delta = currentAngle - startAngle;
      const degrees = (delta * 180) / Math.PI;
      setRotation(startRotation + degrees);
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // RESIZE — solo se non ruotato (v1 semplice)
  const handleResizeMouseDown = (direction: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (rotation !== 0) return; // evitiamo problemi temporanei

    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = size.width;
    const startHeight = size.height;
    const startPos = { ...position };

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      let newWidth = startWidth;
      let newHeight = startHeight;
      let newX = startPos.x;
      let newY = startPos.y;

      if (direction.includes("e")) newWidth = startWidth + dx;
      if (direction.includes("s")) newHeight = startHeight + dy;
      if (direction.includes("w")) {
        newWidth = startWidth - dx;
        newX = startPos.x + dx;
      }
      if (direction.includes("n")) {
        newHeight = startHeight - dy;
        newY = startPos.y + dy;
      }

      setSize({ width: newWidth, height: newHeight });
      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const handles = [
    { dir: "n", style: "top-0 left-1/2 -translate-x-1/2" },
    { dir: "s", style: "bottom-0 left-1/2 -translate-x-1/2" },
    { dir: "e", style: "right-0 top-1/2 -translate-y-1/2" },
    { dir: "w", style: "left-0 top-1/2 -translate-y-1/2" },
    { dir: "nw", style: "top-0 left-0" },
    { dir: "ne", style: "top-0 right-0" },
    { dir: "sw", style: "bottom-0 left-0" },
    { dir: "se", style: "bottom-0 right-0" },
  ];

  return (
    <div
      ref={boxRef}
      onMouseDown={handleBoxMouseDown}
      className={`absolute border-2 border-blue-500 bg-blue-300/20 z-[600] ${dragging ? "cursor-grabbing" : "cursor-move"}`}
      style={{
        top: position.y,
        left: position.x,
        width: size.width,
        height: size.height,
        transform: `rotate(${rotation}deg)`,
        transformOrigin: "center center",
      }}
    >
      {/* Handle rotazione */}
      <div
        onMouseDown={handleRotateMouseDown}
        data-handle
        className="absolute -top-5 left-1/2 -translate-x-1/2 w-4 h-4 bg-white border border-gray-700 rounded-full cursor-pointer z-10"
        title="Trascina per ruotare"
      />

      {/* Handle resize */}
      {handles.map(({ dir, style }) => (
        <div
          key={dir}
          data-handle
          onMouseDown={handleResizeMouseDown(dir)}
          className={`w-3 h-3 bg-white border border-gray-600 absolute ${style} cursor-${dir}-resize z-10`}
        />
      ))}
    </div>
  );
}
