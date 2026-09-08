"use client";

import { Eye, EyeOff } from "lucide-react";

import { usePlannerV2Store } from "../state/plannerV2Store";

export default function ModulePreviewVisibilityToggle() {
  const visible = usePlannerV2Store((state) => state.ui.showModulePreview);
  const setUI = usePlannerV2Store((state) => state.setUI);
  const label = visible ? "Vorschau ausblenden" : "Vorschau anzeigen";

  return (
    <button
      type="button"
      aria-pressed={visible}
      aria-label={label}
      title={label}
      onClick={() => setUI({ showModulePreview: !visible })}
      className={`flex h-9 w-full items-center justify-between rounded-lg border px-3 text-[10px] font-medium transition ${
        visible
          ? "border-primary/45 bg-primary/10 text-primary"
          : "border-border/70 bg-muted/10 text-muted-foreground hover:border-primary/35"
      }`}
    >
      <span>Vorschau</span>
      <span className="flex items-center gap-1.5">
        {visible ? (
          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {visible ? "Sichtbar" : "Ausgeblendet"}
      </span>
    </button>
  );
}
