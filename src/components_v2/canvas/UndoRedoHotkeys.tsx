'use client';
import { useEffect } from 'react';
import { history } from '../state/history';

export default function UndoRedoHotkeys({
  isDrawingRoof,
  canPopVertex,
  onPopVertex,
  onResetDraft,
}: {
  isDrawingRoof: boolean;
  canPopVertex: boolean;
  onPopVertex: () => void;
  onResetDraft: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;

      // ESC → reset draft (riparti da zero se eri in draw-roof)
      if (e.key === 'Escape' && isDrawingRoof) {
        e.preventDefault();
        onResetDraft();
        return;
      }

      // Backspace/Delete dentro draw-roof → rimuovi ultimo punto
      if ((e.key === 'Backspace' || e.key === 'Delete') && isDrawingRoof && canPopVertex) {
        e.preventDefault();
        onPopVertex();
        return;
      }

      // ⌘/Ctrl+Z → se stai disegnando e hai almeno 1 punto, togli l'ultimo; altrimenti UNDO globale
      if (meta && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (isDrawingRoof && canPopVertex) onPopVertex();
        else history.undo();
        return;
      }

      // ⌘/Ctrl+Shift+Z → REDO globale
      if (meta && e.key.toLowerCase() === 'z' && e.shiftKey) {
        e.preventDefault();
        history.redo();
        return;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDrawingRoof, canPopVertex, onPopVertex, onResetDraft]);

  return null;
}
