"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ManualSnowProtectionSegment } from "@/lib/planning/snowProtectionSummary";
import {
  formatSnowLengthInput,
  parseSnowLengthInput,
} from "./snowGuardLengthInput";

export type SnowSegment = ManualSnowProtectionSegment;

type Props = {
  open: boolean;
  onClose: () => void;
  onCommit: (segments: SnowSegment[]) => Promise<void>;
  segments: SnowSegment[];
  pricePerM: number;
};

type SegmentDraft = SnowSegment & {
  inputValue: string;
};

function createDrafts(segments: SnowSegment[]): SegmentDraft[] {
  return segments.map((segment) => ({
    ...segment,
    inputValue: formatSnowLengthInput(segment.lengthM),
  }));
}

function draftSignature(drafts: SegmentDraft[]) {
  return JSON.stringify(
    drafts.map(({ id, roofId, inputValue }) => ({ id, roofId, inputValue })),
  );
}

export function SnowGuardCostDialog({
  open,
  onClose,
  onCommit,
  segments,
  pricePerM,
}: Props) {
  const [drafts, setDrafts] = useState<SegmentDraft[]>(() => createDrafts(segments));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const segmentsRef = useRef(segments);
  const baselineSignatureRef = useRef(draftSignature(createDrafts(segments)));
  const segmentCounterRef = useRef(0);
  segmentsRef.current = segments;

  useEffect(() => {
    if (!open) return;
    const nextDrafts = createDrafts(segmentsRef.current);
    setDrafts(nextDrafts);
    baselineSignatureRef.current = draftSignature(nextDrafts);
    setFieldErrors({});
    setSubmitError("");
    setIsSaving(false);
  }, [open]);

  const validateDrafts = useCallback(() => {
    const nextErrors: Record<string, string> = {};
    const normalizedDrafts = drafts.map((draft) => {
      const parsed = parseSnowLengthInput(draft.inputValue);
      if (!parsed.ok) {
        nextErrors[draft.id] = parsed.error;
        return draft;
      }
      return {
        ...draft,
        lengthM: parsed.value,
        inputValue: parsed.normalized,
      };
    });

    setFieldErrors(nextErrors);
    setDrafts(normalizedDrafts);
    if (Object.keys(nextErrors).length > 0) {
      setSubmitError("Bitte korrigiere die markierten Längen.");
      return null;
    }

    setSubmitError("");
    return normalizedDrafts.map(({ inputValue: _inputValue, ...segment }) => segment);
  }, [drafts]);

  const commitAndClose = useCallback(async () => {
    if (isSaving) return;
    const nextSegments = validateDrafts();
    if (!nextSegments) return;

    setIsSaving(true);
    try {
      await onCommit(nextSegments);
      baselineSignatureRef.current = draftSignature(createDrafts(nextSegments));
      onClose();
    } catch (error) {
      setSubmitError(
        error instanceof Error && error.message
          ? error.message
          : "Speichern fehlgeschlagen. Bitte erneut versuchen.",
      );
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, onClose, onCommit, validateDrafts]);

  const requestDismiss = useCallback(() => {
    if (isSaving) return;
    if (draftSignature(drafts) === baselineSignatureRef.current) {
      onClose();
      return;
    }
    void commitAndClose();
  }, [commitAndClose, drafts, isSaving, onClose]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      requestDismiss();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, requestDismiss]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const handleLengthChange = (id: string, inputValue: string) => {
    setDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, inputValue } : draft)),
    );
    setFieldErrors((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    setSubmitError("");
  };

  const handleLengthBlur = (id: string) => {
    const draft = drafts.find((candidate) => candidate.id === id);
    if (!draft) return;
    const parsed = parseSnowLengthInput(draft.inputValue);
    if (!parsed.ok) {
      setFieldErrors((errors) => ({ ...errors, [id]: parsed.error }));
      return;
    }
    setFieldErrors((errors) => {
      if (!errors[id]) return errors;
      const next = { ...errors };
      delete next[id];
      return next;
    });
    setDrafts((current) =>
      current.map((candidate) =>
        candidate.id === id
          ? {
              ...candidate,
              lengthM: parsed.value,
              inputValue: parsed.normalized,
            }
          : candidate,
      ),
    );
  };

  const handleAddSegment = () => {
    segmentCounterRef.current += 1;
    setDrafts((current) => [
      ...current,
      {
        id: `sg_${Date.now().toString(36)}_${segmentCounterRef.current}`,
        lengthM: 0,
        inputValue: "",
      },
    ]);
    setSubmitError("");
  };

  const handleRemoveSegment = (id: string) => {
    setDrafts((current) => current.filter((draft) => draft.id !== id));
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setSubmitError("");
  };

  const totalM = drafts.reduce((sum, draft) => sum + draft.lengthM, 0);
  const totalChf = totalM * pricePerM;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 px-3 py-3 sm:py-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="snow-guard-dialog-title"
        className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-md flex-col rounded-2xl border border-neutral-700/70 bg-neutral-900 text-white shadow-2xl sm:max-h-[calc(100dvh-3rem)]"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-neutral-700/60 px-4 py-3">
          <div>
            <h2 id="snow-guard-dialog-title" className="text-sm font-semibold">
              Schneefang – Kalkulation
            </h2>
            <p className="mt-0.5 text-[11px] text-neutral-300">
              Trage hier die laufenden Meter der Schneefang-Elemente ein.
            </p>
          </div>
          <button
            type="button"
            onClick={requestDismiss}
            disabled={isSaving}
            aria-label="Dialog schließen"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-neutral-800 text-xs text-neutral-200 hover:bg-neutral-700 disabled:cursor-wait disabled:opacity-60"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          <div className="flex items-center justify-between text-[11px] text-neutral-300">
            <span>Preis pro Meter</span>
            <span className="font-medium">{pricePerM.toFixed(2)} CHF/m</span>
          </div>

          <div className="space-y-2">
            {drafts.length === 0 ? (
              <div className="rounded-md border border-dashed border-neutral-700/80 bg-neutral-900/60 px-3 py-2 text-[11px] text-neutral-300">
                Noch keine Elemente hinzugefügt. Klicke auf{" "}
                <span className="font-semibold">„Segment hinzufügen“</span>, um zu starten.
              </div>
            ) : null}

            {drafts.map((draft, idx) => {
              const subtotal = draft.lengthM * pricePerM;
              const errorId = `snow-segment-${draft.id}-error`;
              return (
                <div
                  key={draft.id}
                  className="flex items-start gap-2 rounded-md border border-neutral-700/80 bg-neutral-900/80 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <label
                      htmlFor={`snow-segment-${draft.id}`}
                      className="mb-0.5 block text-[10px] text-neutral-400"
                    >
                      Segment {idx + 1} – Länge
                    </label>
                    <div className="relative">
                      <input
                        id={`snow-segment-${draft.id}`}
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={draft.inputValue}
                        placeholder="25,46"
                        disabled={isSaving}
                        aria-invalid={Boolean(fieldErrors[draft.id])}
                        aria-describedby={fieldErrors[draft.id] ? errorId : undefined}
                        onFocus={(event) => event.currentTarget.select()}
                        onChange={(event) =>
                          handleLengthChange(draft.id, event.currentTarget.value)
                        }
                        onBlur={() => handleLengthBlur(draft.id)}
                        className="w-full rounded-md border border-neutral-700 bg-neutral-900 py-1 pl-2 pr-7 text-xs text-white placeholder:text-neutral-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/70 disabled:cursor-wait disabled:opacity-70 aria-[invalid=true]:border-red-500 aria-[invalid=true]:focus:ring-red-500/60"
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[11px] text-neutral-400">
                        m
                      </span>
                    </div>
                    {fieldErrors[draft.id] ? (
                      <p id={errorId} className="mt-1 text-[10px] leading-tight text-red-300">
                        {fieldErrors[draft.id]}
                      </p>
                    ) : null}
                  </div>
                  <div className="w-[90px] pt-4 text-right text-[11px]">
                    <div className="text-neutral-400">Zwischensumme</div>
                    <div className="font-semibold">{subtotal.toFixed(2)} CHF</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveSegment(draft.id)}
                    disabled={isSaving}
                    className="mt-4 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-[11px] text-neutral-300 hover:bg-red-600 hover:text-white disabled:cursor-wait disabled:opacity-60"
                    aria-label={`Segment ${idx + 1} entfernen`}
                  >
                    −
                  </button>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={handleAddSegment}
            disabled={isSaving}
            className="inline-flex items-center justify-center rounded-full bg-emerald-600 px-3 py-1.5 text-[11px] font-medium hover:bg-emerald-500 disabled:cursor-wait disabled:opacity-60"
          >
            + Segment hinzufügen
          </button>
        </div>

        <div className="flex shrink-0 flex-col gap-3 border-t border-neutral-700/60 bg-neutral-900 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start justify-between gap-6 text-[11px] sm:justify-start">
            <div>
              <div className="text-neutral-400">Gesamt</div>
              <div className="font-semibold">{totalM.toFixed(1)} m</div>
            </div>
            <div>
              <div className="text-neutral-400">Gesamtpreis Schneefang</div>
              <div className="font-semibold">{totalChf.toFixed(2)} CHF</div>
            </div>
          </div>
          <div className="sm:text-right">
            {submitError ? (
              <p role="alert" className="mb-2 max-w-[220px] text-[10px] leading-tight text-red-300">
                {submitError}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => void commitAndClose()}
              disabled={isSaving}
              className="inline-flex w-full items-center justify-center rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:cursor-wait disabled:opacity-60 sm:w-auto"
            >
              {isSaving ? "Wird gespeichert…" : "Bestätigen"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
