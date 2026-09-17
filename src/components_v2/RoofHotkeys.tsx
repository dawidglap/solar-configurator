"use client";

import { useEffect } from "react";
import { nanoid } from "nanoid";
import toast from "react-hot-toast";
import { usePlannerV2Store } from "./state/plannerV2Store";
import {
  copyObstacleToPlannerClipboard,
  copyRoofToPlannerClipboard,
  markObstacleClipboardPaste,
  readPlannerObjectClipboard,
  resolvePlannerClipboardTarget,
} from "./canvas/plannerObjectClipboard";
import { createContainedObstaclePaste } from "./zones/zoneClipboardGeometry";
import { history as plannerHistory } from "./state/history";

function isTypingInField() {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (el.closest('[contenteditable], [data-stop-hotkeys="true"]')) return true;
  const ce = el.getAttribute("contenteditable");
  return ce === "" || ce === "true";
}

export default function RoofHotkeys() {
  const step = usePlannerV2Store((s) => s.step);
  const duplicateRoof = usePlannerV2Store((s) => s.duplicateRoof);
  const select = usePlannerV2Store((s) => s.select);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      // non interferire se stiamo scrivendo in un input/textarea
      if (isTypingInField()) return;

      // duplichiamo solo nello step "building" (modalità Gebäude)
      if (step !== "building") return;

      const key = ev.key.toLowerCase();
      const meta = ev.metaKey || ev.ctrlKey;

      if (!meta) return;

      const stopPlannerClipboardEvent = () => {
        ev.preventDefault();
        ev.stopPropagation();
        ev.stopImmediatePropagation();
      };

      // CTRL/CMD + C → copia l'oggetto editabile attivo, non il parent context.
      if (key === "c") {
        const state = usePlannerV2Store.getState();
        const target = resolvePlannerClipboardTarget({
          step: state.step,
          tool: state.tool,
          selectedRoofId: state.selectedId,
          selectedZoneId: state.selectedZoneId,
          selectedSnowGuardId: state.selectedSnowGuardId,
          selectedPanelCount: state.selectedPanelIds.length,
        });
        if (target === "obstacle") {
          const obstacle = state.zones.find((zone) => zone.id === state.selectedZoneId);
          if (!obstacle) return;
          stopPlannerClipboardEvent();
          copyObstacleToPlannerClipboard(obstacle);
          return;
        }
        if (target !== "roof" || !state.selectedId) return;
        stopPlannerClipboardEvent();
        copyRoofToPlannerClipboard(state.selectedId);
        return;
      }

      // CTRL/CMD + V → il discriminante copiato resta autoritativo anche se
      // nel frattempo cambia la selezione contestuale.
      if (key === "v") {
        const clipboard = readPlannerObjectClipboard();
        if (!clipboard) return;
        if (clipboard.type === "obstacle") {
          stopPlannerClipboardEvent();
          const state = usePlannerV2Store.getState();
          const ownerRoof = state.layers.find((roof) => roof.id === clipboard.sourceRoofId);
          const pasted = ownerRoof ? createContainedObstaclePaste({
            source: clipboard.obstacle,
            ownerRoofPoints: ownerRoof.points,
            mppImage: state.snapshot.mppImage ?? 0,
            pasteCount: clipboard.pasteCount,
            createId: () => `zone-copy-${nanoid()}`,
          }) : undefined;
          if (!ownerRoof || !pasted) {
            toast("Hindernis kann auf dieser Dachfläche nicht eingefügt werden.");
            return;
          }
          plannerHistory.push("paste obstacle");
          state.addZone(pasted);
          markObstacleClipboardPaste();
          return;
        }
        if (clipboard.type !== "roof") return;
        stopPlannerClipboardEvent();
        const newId = duplicateRoof(clipboard.sourceRoofId);
        if (newId) select(newId);
        return;
      }
    };

    document.addEventListener("keydown", onKey, { capture: true });
    return () =>
      document.removeEventListener("keydown", onKey, { capture: true } as any);
  }, [step, duplicateRoof, select]);

  return null;
}
