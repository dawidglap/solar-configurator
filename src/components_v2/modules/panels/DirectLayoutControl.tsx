"use client";

import React from "react";

import { K2_D_DOME_SYSTEM_ID } from "@/lib/planning-core/advanced";
import { resolveRoofEdgeMarginM } from "@/lib/planning/roofProperties";
import type { PanelInstance } from "@/types/planner";
import { getCurrentCanvasRotationDeg } from "../../canvas/canvasRotationState";
import { history as plannerHistory } from "../../state/history";
import { usePlannerV2Store } from "../../state/plannerV2Store";
import { validateExistingPanelPlacement } from "../manualPlacement";
import {
  type DirectLayoutDirection,
  resolveDirectLayoutPivot,
  resolveDirectLayoutTargets,
  rotateDirectPanels,
  screenNudgeToImageDelta,
  translateDirectPanels,
} from "./directLayoutGeometry";
import {
  clearTransientPanelGeometry,
  setTransientPanelGeometry,
} from "./transientPanelGeometry";

const HOLD_DELAY_MS = 300;
const HOLD_REPEAT_MS = 80;

type GestureAction =
  | { kind: "move"; direction: DirectLayoutDirection; fast: boolean }
  | { kind: "rotate"; deltaSign: -1 | 1; fast: boolean };

type Gesture = {
  action: GestureAction;
  initial: PanelInstance[];
  current: PanelInstance[];
  pivot?: { x: number; y: number };
  changed: boolean;
  delayTimer?: ReturnType<typeof setTimeout>;
  repeatTimer?: ReturnType<typeof setInterval>;
};

function isInteractiveFormTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(element?.closest("input, textarea, select, [contenteditable='true'], [role='slider']"));
}

function transientMap(panels: readonly PanelInstance[]) {
  return new Map(panels.map((panel) => [panel.id, {
    cx: panel.cx,
    cy: panel.cy,
    angleDeg: panel.angleDeg,
  }]));
}

function sameGeometry(first: PanelInstance, second: PanelInstance): boolean {
  return first.cx === second.cx && first.cy === second.cy && first.angleDeg === second.angleDeg;
}

export default function DirectLayoutControl({ roofId }: { roofId: string }) {
  const panels = usePlannerV2Store((state) => state.panels);
  const selectedPanelIds = usePlannerV2Store((state) => state.selectedPanelIds);
  const hasDraft = usePlannerV2Store((state) => Boolean(state.roofPlanningDrafts[roofId]));
  const updatePanelsBulk = usePlannerV2Store((state) => state.updatePanelsBulk);
  const controllerRef = React.useRef<HTMLDivElement>(null);
  const gestureRef = React.useRef<Gesture | null>(null);
  const mountedRef = React.useRef(true);
  const [invalidPulse, setInvalidPulse] = React.useState(false);
  const [visualAngle, setVisualAngle] = React.useState<number | undefined>();

  const targets = React.useMemo(() => resolveDirectLayoutTargets({
    panels,
    selectedPanelIds,
    roofId,
  }), [panels, roofId, selectedPanelIds]);
  const targetIdsKey = targets.map((panel) => panel.id).sort().join("|");
  const firstTargetAngle = targets[0]?.angleDeg;
  const hasSelectionOnRoof = selectedPanelIds.some((id) =>
    panels.some((panel) => panel.id === id && panel.roofId === roofId),
  );
  const dDomeBlockCount = React.useMemo(() => {
    if (!targets.length || targets.some((panel) => panel.advanced?.systemId !== K2_D_DOME_SYSTEM_ID)) return undefined;
    return new Set(targets.map((panel) => panel.advanced?.blockKey).filter(Boolean)).size;
  }, [targets]);

  React.useEffect(() => {
    setVisualAngle(firstTargetAngle);
  }, [firstTargetAngle, targetIdsKey]);

  const targetLabel = !hasSelectionOnRoof
    ? "Gesamtes Layout"
    : dDomeBlockCount !== undefined
      ? `${dDomeBlockCount} ${dDomeBlockCount === 1 ? "Block" : "Blöcke"} · ${targets.length} Module ausgewählt`
      : `${targets.length} ${targets.length === 1 ? "Modul" : "Module"} ausgewählt`;

  const clearTimers = React.useCallback((gesture: Gesture) => {
    if (gesture.delayTimer) clearTimeout(gesture.delayTimer);
    if (gesture.repeatTimer) clearInterval(gesture.repeatTimer);
  }, []);

  const finishGesture = React.useCallback((commit: boolean) => {
    const gesture = gestureRef.current;
    if (!gesture) return false;
    gestureRef.current = null;
    clearTimers(gesture);
    const ids = gesture.initial.map((panel) => panel.id);
    if (commit && gesture.changed) {
      plannerHistory.push(gesture.action.kind === "move" ? "move panels precisely" : "rotate panels precisely");
      updatePanelsBulk(Object.fromEntries(gesture.current.map((panel) => [panel.id, {
        cx: panel.cx,
        cy: panel.cy,
        angleDeg: panel.angleDeg,
        ...(panel.advanced ? { advanced: panel.advanced } : {}),
      }])));
      setVisualAngle(gesture.current[0]?.angleDeg);
      requestAnimationFrame(() => clearTransientPanelGeometry(ids));
    } else {
      clearTransientPanelGeometry(ids);
      setVisualAngle(gesture.initial[0]?.angleDeg);
    }
    return true;
  }, [clearTimers, updatePanelsBulk]);

  const candidatesAreValid = React.useCallback((candidates: readonly PanelInstance[], initial: readonly PanelInstance[]) => {
    const state = usePlannerV2Store.getState();
    const roof = state.layers.find((item) => item.id === roofId);
    const mppImage = state.snapshot.mppImage ?? 0;
    if (!roof || !(mppImage > 0)) return false;
    const movingIds = new Set(initial.map((panel) => panel.id));
    const marginM = resolveRoofEdgeMarginM(roof, state.modules.marginM);
    return candidates.every((candidate) => validateExistingPanelPlacement({
      panel: candidate,
      centerPx: { x: candidate.cx, y: candidate.cy },
      angleDeg: candidate.angleDeg,
      roof,
      marginM,
      mppImage,
      zones: state.zones,
      snowGuards: state.snowGuards,
      panels: state.panels,
      excludePanelIds: movingIds,
    }).valid);
  }, [roofId]);

  const applyStep = React.useCallback(() => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    const state = usePlannerV2Store.getState();
    const next = gesture.action.kind === "move"
      ? translateDirectPanels(gesture.current, screenNudgeToImageDelta({
          direction: gesture.action.direction,
          distanceM: gesture.action.fast ? 0.1 : 0.01,
          mppImage: state.snapshot.mppImage ?? 0,
          canvasRotationDeg: getCurrentCanvasRotationDeg(),
        }))
      : rotateDirectPanels(
          gesture.current,
          gesture.pivot ?? resolveDirectLayoutPivot(gesture.initial) ?? { x: 0, y: 0 },
          gesture.action.deltaSign * (gesture.action.fast ? 5 : 1),
        );
    if (!candidatesAreValid(next, gesture.initial)) {
      setInvalidPulse(true);
      requestAnimationFrame(() => mountedRef.current && setInvalidPulse(false));
      return;
    }
    gesture.current = next;
    gesture.changed = gesture.changed || next.some((panel, index) => !sameGeometry(panel, gesture.initial[index]));
    setTransientPanelGeometry(transientMap(next));
    setVisualAngle(next[0]?.angleDeg);
  }, [candidatesAreValid]);

  const beginGesture = React.useCallback((action: GestureAction) => {
    finishGesture(false);
    const state = usePlannerV2Store.getState();
    const initial = resolveDirectLayoutTargets({
      panels: state.panels,
      selectedPanelIds: state.selectedPanelIds,
      roofId,
    }).map((panel) => ({ ...panel, ...(panel.advanced ? { advanced: { ...panel.advanced } } : {}) }));
    if (!initial.length || hasDraft) return;
    const gesture: Gesture = {
      action,
      initial,
      current: initial,
      pivot: action.kind === "rotate" ? resolveDirectLayoutPivot(initial) : undefined,
      changed: false,
    };
    gestureRef.current = gesture;
    applyStep();
    gesture.delayTimer = setTimeout(() => {
      if (gestureRef.current !== gesture) return;
      gesture.repeatTimer = setInterval(applyStep, HOLD_REPEAT_MS);
    }, HOLD_DELAY_MS);
  }, [applyStep, finishGesture, hasDraft, roofId]);

  React.useEffect(() => {
    mountedRef.current = true;
    const onPointerUp = () => finishGesture(true);
    const onPointerCancel = () => finishGesture(false);
    const onBlur = () => finishGesture(false);
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !finishGesture(false)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("blur", onBlur);
    window.addEventListener("keydown", onEscape, { capture: true });
    return () => {
      mountedRef.current = false;
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("keydown", onEscape, { capture: true });
      finishGesture(false);
    };
  }, [finishGesture]);

  const onControllerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (isInteractiveFormTarget(event.target) || event.repeat) return;
    const direction = event.key === "ArrowUp" ? "up"
      : event.key === "ArrowDown" ? "down"
        : event.key === "ArrowLeft" ? "left"
          : event.key === "ArrowRight" ? "right"
            : undefined;
    if (!direction) return;
    event.preventDefault();
    event.stopPropagation();
    beginGesture({ kind: "move", direction, fast: event.shiftKey });
  };

  const onControllerKeyUp = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!event.key.startsWith("Arrow")) return;
    event.preventDefault();
    event.stopPropagation();
    finishGesture(true);
  };

  const startPointerGesture = (event: React.PointerEvent, action: GestureAction) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    controllerRef.current?.focus({ preventScroll: true });
    beginGesture(action);
  };

  const activateFromKeyboardClick = (event: React.MouseEvent, action: GestureAction) => {
    if (event.detail !== 0) return;
    beginGesture({ ...action, fast: event.shiftKey });
    finishGesture(true);
  };

  const buttonClass = "flex h-10 min-w-10 items-center justify-center rounded-lg border border-border/70 bg-muted/20 text-[16px] font-semibold text-foreground hover:border-primary/70 hover:bg-primary/10 active:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-35";
  const disabled = hasDraft || !targets.length;
  const normalizedAngle = visualAngle === undefined ? undefined : ((visualAngle % 360) + 360) % 360;

  return (
    <div
      ref={controllerRef}
      tabIndex={disabled ? -1 : 0}
      role="group"
      aria-label="Module präzise verschieben und drehen"
      data-stop-hotkeys="true"
      onKeyDown={onControllerKeyDown}
      onKeyUp={onControllerKeyUp}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) finishGesture(false);
      }}
      className={`rounded-xl border p-3 outline-none transition focus:border-primary/80 focus:ring-1 focus:ring-primary/35 focus-within:border-primary/80 ${invalidPulse ? "border-destructive/80" : "border-border/60"}`}
    >
      <div className="mb-3 flex items-center justify-between gap-2 text-[10px]">
        <span className="font-medium text-foreground">{targets.length ? targetLabel : "Keine Module"}</span>
        <span className="text-muted-foreground">Mit Pfeiltasten verschieben</span>
      </div>

      <div className="mx-auto grid w-[136px] grid-cols-3 gap-1.5">
        <span />
        <button type="button" disabled={disabled} className={buttonClass} aria-label="10 Millimeter nach oben" onPointerDown={(event) => startPointerGesture(event, { kind: "move", direction: "up", fast: event.shiftKey })} onClick={(event) => activateFromKeyboardClick(event, { kind: "move", direction: "up", fast: false })}>↑</button>
        <span />
        <button type="button" disabled={disabled} className={buttonClass} aria-label="10 Millimeter nach links" onPointerDown={(event) => startPointerGesture(event, { kind: "move", direction: "left", fast: event.shiftKey })} onClick={(event) => activateFromKeyboardClick(event, { kind: "move", direction: "left", fast: false })}>←</button>
        <div className="flex h-10 items-center justify-center rounded-lg bg-muted/15 text-[10px] font-semibold text-muted-foreground">10 mm</div>
        <button type="button" disabled={disabled} className={buttonClass} aria-label="10 Millimeter nach rechts" onPointerDown={(event) => startPointerGesture(event, { kind: "move", direction: "right", fast: event.shiftKey })} onClick={(event) => activateFromKeyboardClick(event, { kind: "move", direction: "right", fast: false })}>→</button>
        <span />
        <button type="button" disabled={disabled} className={buttonClass} aria-label="10 Millimeter nach unten" onPointerDown={(event) => startPointerGesture(event, { kind: "move", direction: "down", fast: event.shiftKey })} onClick={(event) => activateFromKeyboardClick(event, { kind: "move", direction: "down", fast: false })}>↓</button>
        <span />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" disabled={disabled} className={`${buttonClass} gap-1 text-[13px]`} aria-label="Ein Grad gegen den Uhrzeigersinn drehen" onPointerDown={(event) => startPointerGesture(event, { kind: "rotate", deltaSign: -1, fast: event.shiftKey })} onClick={(event) => activateFromKeyboardClick(event, { kind: "rotate", deltaSign: -1, fast: false })}><span className="text-lg">↶</span> 1°</button>
        <button type="button" disabled={disabled} className={`${buttonClass} gap-1 text-[13px]`} aria-label="Ein Grad im Uhrzeigersinn drehen" onPointerDown={(event) => startPointerGesture(event, { kind: "rotate", deltaSign: 1, fast: event.shiftKey })} onClick={(event) => activateFromKeyboardClick(event, { kind: "rotate", deltaSign: 1, fast: false })}>1° <span className="text-lg">↷</span></button>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-border/50 pt-2 text-[10px]">
        <span className="text-muted-foreground">Drehung</span>
        <strong className="tabular-nums text-foreground">
          {normalizedAngle === undefined ? "—" : `${new Intl.NumberFormat("de-CH", { maximumFractionDigits: 2 }).format(normalizedAngle)}°`}
        </strong>
      </div>
      {hasDraft && <p className="mt-2 text-[9px] text-muted-foreground">Zuerst die aktuelle Layout-Konfiguration anwenden.</p>}
    </div>
  );
}
