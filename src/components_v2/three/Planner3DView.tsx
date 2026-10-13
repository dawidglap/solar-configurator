"use client";

import dynamic from "next/dynamic";
import React, { Component, useState, type ErrorInfo, type ReactNode } from "react";
import type { Planner3DSceneModel } from "@/lib/planning-3d/types";

const Planner3DCanvas = dynamic(() => import("./Planner3DCanvas"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      3D-Ansicht wird geladen…
    </div>
  ),
});

class Planner3DErrorBoundary extends Component<
  { children: ReactNode; onReturnTo2D: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Planner3D] Renderer failed", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-background text-foreground">
        <p className="text-sm">3D-Ansicht konnte nicht geladen werden</p>
        <button
          type="button"
          onClick={this.props.onReturnTo2D}
          className="rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-muted"
        >
          Zurück zu 2D
        </button>
      </div>
    );
  }
}

export default function Planner3DView({
  scene,
  onReturnTo2D,
}: {
  scene: Readonly<Planner3DSceneModel>;
  onReturnTo2D: () => void;
}) {
  const [resetVersion, setResetVersion] = useState(0);
  return (
    <Planner3DErrorBoundary onReturnTo2D={onReturnTo2D}>
      <div className="relative h-full w-full bg-[#e8eceb]">
        <Planner3DCanvas scene={scene} resetVersion={resetVersion} />
        <div className="pointer-events-none absolute bottom-5 right-5 flex items-center gap-2">
          <span className="hidden rounded-md border border-black/10 bg-white/85 px-2 py-1 text-[11px] text-slate-600 shadow-sm backdrop-blur sm:inline">
            Ziehen: Drehen · Rechts: Verschieben · Scrollen: Zoomen
          </span>
          <button
            type="button"
            onClick={() => setResetVersion((version) => version + 1)}
            className="pointer-events-auto rounded-md border border-black/10 bg-white/90 px-3 py-2 text-xs font-medium text-slate-800 shadow-sm hover:bg-white"
          >
            Ansicht zurücksetzen
          </button>
        </div>
      </div>
    </Planner3DErrorBoundary>
  );
}
