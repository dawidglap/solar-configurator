"use client";

import { useEffect, useRef } from "react";
import { usePlannerV2Store } from "./state/plannerV2Store";

function isTypingInField() {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea") return true;
  const ce = el.getAttribute("contenteditable");
  return ce === "" || ce === "true";
}

export default function RoofHotkeys() {
  const step = usePlannerV2Store((s) => s.step);
  const selectedId = usePlannerV2Store((s) => s.selectedId);
  const duplicateRoof = usePlannerV2Store((s) => s.duplicateRoof);
  const select = usePlannerV2Store((s) => s.select);

  const copiedRoofIdRef = useRef<string | undefined>(undefined);
  const selectedRef = useRef<string | undefined>(selectedId);

  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      // non interferire se stiamo scrivendo in un input/textarea
      if (isTypingInField()) return;

      // duplichiamo solo nello step "building" (modalità Gebäude)
      if (step !== "building") return;

      const key = ev.key.toLowerCase();
      const meta = ev.metaKey || ev.ctrlKey;

      if (!meta) return;

      // CTRL/CMD + C → copia falda selezionata
      if (key === "c") {
        const id = selectedRef.current;
        if (!id) return;
        ev.preventDefault();
        copiedRoofIdRef.current = id;
        return;
      }

      // CTRL/CMD + V → duplica falda copiata
      if (key === "v") {
        const srcId = copiedRoofIdRef.current;
        if (!srcId) return;
        ev.preventDefault();
        const newId = duplicateRoof(srcId);
        if (newId) {
          select(newId);
        }
        return;
      }
    };

    document.addEventListener("keydown", onKey, { capture: true });
    return () =>
      document.removeEventListener("keydown", onKey, { capture: true } as any);
  }, [step, duplicateRoof, select]);

  return null;
}
