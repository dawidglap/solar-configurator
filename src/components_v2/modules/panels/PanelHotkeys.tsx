// src/components_v2/canvas/panels/PanelHotkeys.tsx
'use client';

import { useEffect, useMemo } from 'react';
import { nanoid } from 'nanoid';
import toast from 'react-hot-toast';

import { resolveRoofEdgeMarginM } from '@/lib/planning/roofProperties';
import {
  copyPanelsToPlannerClipboard,
  markPanelClipboardPaste,
  readPlannerObjectClipboard,
} from '../../canvas/plannerObjectClipboard';
import { usePlannerV2Store } from '../../state/plannerV2Store';
import { history as plannerHistory } from '../../state/history';
import { validateExistingPanelPlacement } from '../manualPlacement';
import { resolveDirectLayoutTargets } from './directLayoutGeometry';
import {
  createPanelPasteGroup,
  offsetPanelPasteGroup,
  panelPasteOffsetCandidates,
} from './panelClipboardGeometry';

type Props = {
  disabled: any;
  /** Modalità controllata (singolo pannello): se presente, usa queste props */
  selectedPanelId?: string;
  onDelete?: (id: string) => void;
  onDuplicate?: (id: string) => void;
};

/**
 * Registra hotkeys per pannelli.
 * - Senza props: usa la selezione dallo store (multi-select).
 * - Con props: gestisce Delete / Duplica / Copy/Paste sul singolo `selectedPanelId`.
 *
 * In più: intercetta anche la S per il tool “snow guard” quando siamo nello step building.
 */
export default function PanelHotkeys(props: Props) {
  // 🔹 destrutturiamo i props per avere deps pulite
  const {
    disabled,
    selectedPanelId,
    onDelete,
    onDuplicate,
  } = props;

  // ====== Store (fallback / multi-select) ======
  const panels = usePlannerV2Store((s) => s.panels);
  const selectedIds = usePlannerV2Store((s) => s.selectedPanelIds);

  const setSelectedPanels = usePlannerV2Store((s) => s.setSelectedPanels);

  const deletePanelFromStore = usePlannerV2Store((s) => s.deletePanel);
  const deletePanelsBulk = usePlannerV2Store((s) => s.deletePanelsBulk);
  const duplicatePanelInStore = usePlannerV2Store((s) => s.duplicatePanel);

  // step/tool globali
  const step = usePlannerV2Store((s) => (s as any).step ?? (s as any).ui?.step);
  const tool = usePlannerV2Store((s) => (s as any).tool ?? (s as any).ui?.tool);
  const setTool = usePlannerV2Store((s) => s.setTool);

  // mappa id -> panel (utile per verificare esistenza)
  const panelById = useMemo(() => {
    const map = new Map<string, (typeof panels)[number]>();
    for (const p of panels) map.set(p.id, p);
    return map;
  }, [panels]);

  const useControlled =
    !!selectedPanelId && !!onDelete && !!onDuplicate;

  useEffect(() => {
    const isTextTarget = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return Boolean(el?.closest("input, textarea, select, [contenteditable='true']"));
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // 0) se stai scrivendo, esci
      if (isTextTarget(e.target)) return;
      if (disabled) return;

      const key = e.key;

      // 1) HOTKEY TOOL: S → snow guard (solo building)
      if ((key === 's' || key === 'S') && step === 'building') {
        e.preventDefault();
        e.stopPropagation();
        setTool('draw-snow-guard' as any);
        return;
      }

      // gestione pannelli solo in step "modules" e tool "select"
      if (step && step !== 'modules') return;
      if (tool && tool !== 'select') return;

      // Copy/paste is always owned by the active planner context. In
      // Modulplanung it never delegates to roof duplication.
      if ((e.metaKey || e.ctrlKey) && key.toLowerCase() === 'c') {
        const state = usePlannerV2Store.getState();
        const roofId = state.selectedId;
        if (!roofId || state.selectedPanelIds.length === 0) return;
        const selected = resolveDirectLayoutTargets({
          panels: state.panels,
          selectedPanelIds: state.selectedPanelIds,
          roofId,
        });
        if (!selected.length) return;
        e.preventDefault();
        e.stopPropagation();
        copyPanelsToPlannerClipboard({ sourceRoofId: roofId, panels: selected });
        return;
      }

      if ((e.metaKey || e.ctrlKey) && key.toLowerCase() === 'v') {
        const clipboard = readPlannerObjectClipboard();
        const state = usePlannerV2Store.getState();
        const roofId = state.selectedId;
        // Cross-context and cross-roof paste are intentionally rejected.
        if (clipboard?.type !== 'panels' || !roofId || clipboard.sourceRoofId !== roofId) return;
        const roof = state.layers.find((candidate) => candidate.id === roofId);
        const mppImage = state.snapshot.mppImage ?? 0;
        if (!roof || !(mppImage > 0)) return;

        e.preventDefault();
        e.stopPropagation();
        const pasteGroup = createPanelPasteGroup({
          source: clipboard.panels,
          roofId,
          createPanelId: () => `panel-copy-${nanoid()}`,
          createBlockKey: () => `${roofId}:copy-block:${nanoid()}`,
          layoutRunId: `${roofId}:manual-copy:${nanoid()}`,
        });
        const marginM = resolveRoofEdgeMarginM(roof, state.modules.marginM);
        const pasted = panelPasteOffsetCandidates(clipboard.pasteCount)
          .map((offset) => offsetPanelPasteGroup({ panels: pasteGroup, offset, mppImage }))
          .find((candidates) => candidates.every((candidate) =>
            validateExistingPanelPlacement({
              panel: candidate,
              centerPx: { x: candidate.cx, y: candidate.cy },
              angleDeg: candidate.angleDeg,
              roof,
              marginM,
              mppImage,
              zones: state.zones,
              snowGuards: state.snowGuards,
              panels: state.panels,
              excludePanelIds: new Set(),
            }).valid,
          ));

        if (!pasted) {
          toast('Keine freie Position zum Einfügen gefunden.');
          return;
        }

        plannerHistory.push('paste panels');
        state.appendPanelsToRoof({ roofId, panels: pasted, selectAdded: true });
        markPanelClipboardPaste();
        return;
      }

      // ===== Modalità CONTROLLATA (singolo pannello via props) =====
      if (useControlled) {
        const id = selectedPanelId!;
        const panel = panelById.get(id);
        if (!panel) return;

        // Delete / Backspace
        if (key === 'Delete' || key === 'Backspace') {
          e.preventDefault();
          onDelete!(id);
          return;
        }

        // Cmd/Ctrl+D → duplica
        if ((e.metaKey || e.ctrlKey) && key.toLowerCase() === 'd') {
          e.preventDefault();
          onDuplicate!(id);
          return;
        }

        return;
      }

      // ===== Modalità STORE (multi-select) =====

      // Cmd/Ctrl + A → select all
      if ((key === 'a' || key === 'A') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();

        let targetRoofId: string | undefined;
        if (selectedIds.length) {
          const first = panelById.get(selectedIds[0]);
          targetRoofId = first?.roofId;
        }

        const ids = panels
          .filter((p) => (targetRoofId ? p.roofId === targetRoofId : true))
          .map((p) => p.id);

        setSelectedPanels(ids);
        return;
      }

      // DELETE / BACKSPACE → elimina selezione
      if (key === 'Delete' || key === 'Backspace') {
        if (!selectedIds?.length) return;
        e.preventDefault();
        if (deletePanelsBulk) {
          deletePanelsBulk(selectedIds);
        } else if (selectedIds.length === 1) {
          deletePanelFromStore(selectedIds[0]);
        } else {
          selectedIds.forEach((id) => deletePanelFromStore(id));
        }
        setSelectedPanels([]);
        return;
      }

      // Cmd/Ctrl + D → duplica selezione
      if ((e.metaKey || e.ctrlKey) && key.toLowerCase() === 'd') {
        if (!selectedIds?.length) return;
        e.preventDefault();
        const newIds: string[] = [];
        let k = 0;
        for (const id of selectedIds) {
          const nid = duplicatePanelInStore(id, 18 * (k + 1));
          if (nid) newIds.push(nid);
          k++;
        }
        if (newIds.length) setSelectedPanels(newIds);
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    // props destrutturati
    disabled,
    selectedPanelId,
    onDelete,
    onDuplicate,
    // altri
    useControlled,
    panels,
    selectedIds,
    step,
    tool,
    setTool,
    panelById,
    setSelectedPanels,
    deletePanelFromStore,
    deletePanelsBulk,
    duplicatePanelInStore,
  ]);

  return null;
}
