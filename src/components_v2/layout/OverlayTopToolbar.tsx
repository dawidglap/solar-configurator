"use client";

import TopToolbar from "./TopToolbar";
import { usePlannerV2Store } from "../state/plannerV2Store";

export default function OverlayTopToolbar() {
  const step = usePlannerV2Store((s) => s.step);
  const show = step === "building" || step === "modules";

  if (!show) return null;

  return (
    <div
      className="pointer-events-none absolute left-0 right-0 z-[200] w-full px-0"
      style={{ top: "var(--tb, 48px)" }} // fallback 56px, così resta sotto la topbar
    >
      <div className="pointer-events-auto relative mx-auto max-w-full  bg-[#404F5A]/65 backdrop-blur-md shadow-sm border-l border-[#7E8B97] ">
        <TopToolbar />
      </div>
    </div>
  );
}
