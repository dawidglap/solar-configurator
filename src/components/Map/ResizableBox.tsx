"use client";

import { useState, useRef, useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

export default function ResizableBox() {
  const [position, setPosition] = useState({ x: 300, y: 200 });
  const [size, setSize] = useState({ width: 200, height: 200 });
  const [rotation, setRotation] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    dragStart.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging.current) return;
    setPosition({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y,
    });
  };

  const handleMouseUp = () => {
    isDragging.current = false;
  };

  useEffect(() => {
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  return (
    <div
      className="absolute z-[600]"
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
        transform: `rotate(${rotation}deg)`
      }}
    >
      <div
        ref={boxRef}
        onMouseDown={handleMouseDown}
        className="relative w-full h-full bg-black/80 border-2 border-purple-500"
      >
        {/* 8 resize handles */}
        {[
          "top-left", "top", "top-right",
          "left", "right",
          "bottom-left", "bottom", "bottom-right"
        ].map((pos) => (
          <div
            key={pos}
            data-position={pos}
            className={cn(
              "absolute w-3 h-3 bg-white rounded-full border",
              handlePosition(pos)
            )}
          />
        ))}
      </div>

      {/* rotate handle */}
      <button
        onClick={() => setRotation((r) => r + 15)}
        className="absolute left-1/2 -translate-x-1/2 mt-2"
        style={{ top: size.height + 10 }}
      >
        <RotateCcw className="w-5 h-5 text-black bg-white rounded-full p-1" />
      </button>
    </div>
  );
}

function handlePosition(pos: string) {
  switch (pos) {
    case "top-left":
      return "top-0 left-0 -translate-x-1/2 -translate-y-1/2";
    case "top":
      return "top-0 left-1/2 -translate-x-1/2 -translate-y-1/2";
    case "top-right":
      return "top-0 right-0 translate-x-1/2 -translate-y-1/2";
    case "left":
      return "top-1/2 left-0 -translate-x-1/2 -translate-y-1/2";
    case "right":
      return "top-1/2 right-0 translate-x-1/2 -translate-y-1/2";
    case "bottom-left":
      return "bottom-0 left-0 -translate-x-1/2 translate-y-1/2";
    case "bottom":
      return "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2";
    case "bottom-right":
      return "bottom-0 right-0 translate-x-1/2 translate-y-1/2";
    default:
      return "";
  }
}
