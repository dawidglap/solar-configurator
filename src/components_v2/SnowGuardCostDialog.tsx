"use client";

import React from "react";

export type SnowSegment = {
  id: string;
  lengthM: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  segments: SnowSegment[];
  setSegments: (segments: SnowSegment[]) => void;
  pricePerM: number;
};

export function SnowGuardCostDialog({
  open,
  onClose,
  segments,
  setSegments,
  pricePerM,
}: Props) {
  if (!open) return null;

  const handleLengthChange = (id: string, value: string) => {
    const num = Number(value.replace(",", "."));
    if (Number.isNaN(num)) return;

    setSegments(
      segments.map((s) =>
        s.id === id ? { ...s, lengthM: num < 0 ? 0 : num } : s
      )
    );
  };

  const handleAddSegment = () => {
    const now = Date.now().toString(36);
    setSegments([
      ...segments,
      { id: `sg_${now}`, lengthM: 10 }, // default 10 m
    ]);
  };

  const handleRemoveSegment = (id: string) => {
    setSegments(segments.filter((s) => s.id !== id));
  };

  const totalM = segments.reduce((sum, s) => sum + (s.lengthM || 0), 0);
  const totalChf = totalM * pricePerM;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center top-48 justify-center bg-black/50">
      <div className="w-full max-w-md rounded-2xl bg-neutral-900 text-white shadow-2xl border border-neutral-700/70">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-700/60 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Schneefang – Kalkulation</h2>
            <p className="mt-0.5 text-[11px] text-neutral-300">
              Trage hier die laufenden Meter der Schneefang-Elemente ein.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-3 space-y-3 max-h-[60vh] overflow-auto">
          <div className="flex items-center justify-between text-[11px] text-neutral-300">
            <span>Preis pro Meter</span>
            <span className="font-medium">{pricePerM.toFixed(2)} CHF/m</span>
          </div>

          <div className="space-y-2">
            {segments.length === 0 && (
              <div className="rounded-md border border-dashed border-neutral-700/80 bg-neutral-900/60 px-3 py-2 text-[11px] text-neutral-300">
                Noch keine Elemente hinzugefügt. Klicke auf{" "}
                <span className="font-semibold">„Segment hinzufügen“</span>, um
                zu starten.
              </div>
            )}

            {segments.map((seg, idx) => {
              const subtotal = (seg.lengthM || 0) * pricePerM;
              return (
                <div
                  key={seg.id}
                  className="flex items-center gap-2 rounded-md border border-neutral-700/80 bg-neutral-900/80 px-3 py-2"
                >
                  <div className="flex-1">
                    <label className="block text-[10px] text-neutral-400 mb-0.5">
                      Segment {idx + 1} – Länge (m)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={Number.isFinite(seg.lengthM) ? seg.lengthM : ""}
                      onChange={(e) =>
                        handleLengthChange(seg.id, e.target.value)
                      }
                      className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/70"
                    />
                  </div>
                  <div className="text-right text-[11px] w-[90px]">
                    <div className="text-neutral-400">Zwischensumme</div>
                    <div className="font-semibold">
                      {subtotal.toFixed(2)} CHF
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveSegment(seg.id)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-neutral-800 text-[11px] text-neutral-300 hover:bg-red-600 hover:text-white"
                    aria-label="Segment entfernen"
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
            className="inline-flex items-center justify-center rounded-full bg-emerald-600 px-3 py-1.5 text-[11px] font-medium hover:bg-emerald-500"
          >
            + Segment hinzufügen
          </button>
        </div>

        {/* Footer */}
        <div className="border-t border-neutral-700/60 px-4 py-3 flex items-center justify-between">
          <div className="text-[11px]">
            <div className="text-neutral-400">Gesamt</div>
            <div className="font-semibold">{totalM.toFixed(1)} m</div>
          </div>
          <div className="text-[11px] text-right">
            <div className="text-neutral-400">Gesamtpreis Schneefang</div>
            <div className="font-semibold">{totalChf.toFixed(2)} CHF</div>
          </div>
        </div>
      </div>
    </div>
  );
}
