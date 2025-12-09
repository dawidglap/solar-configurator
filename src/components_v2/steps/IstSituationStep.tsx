"use client";

import { useState } from "react";
import { usePlannerV2Store } from "../state/plannerV2Store";

export default function IstSituationStep() {
  const setStep = usePlannerV2Store((s) => s.setStep);

  const [address, setAddress] = useState("");
  const [roofType, setRoofType] = useState<
    "satteldach" | "pultdach" | "flachdach" | "unbekannt" | ""
  >("");
  const [hasExistingPv, setHasExistingPv] = useState<"yes" | "no" | "">("");
  const [consumption, setConsumption] = useState("");
  const [notes, setNotes] = useState("");

  const onNext = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: salva nello store
    setStep("building"); // 👉 da qui entriamo in Gebäudeplanung normale
  };

  const onBack = () => setStep("profile");

  return (
    <div className="w-full max-w-2xl bg-white border border-neutral-200 rounded-2xl shadow-sm p-6 sm:p-8">
      <h1 className="text-lg font-semibold text-neutral-900 mb-1">
        IST-Situation
      </h1>
      <p className="text-sm text-neutral-600 mb-6">
        Erfasse die aktuelle Situation des Gebäudes, damit die Planung möglichst
        realistisch wird.
      </p>

      <form className="space-y-4" onSubmit={onNext}>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-neutral-700">
            Objektadresse
          </label>
          <input
            type="text"
            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900/60"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Strasse, PLZ, Ort"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-neutral-700">
            Dachtyp
          </label>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {[
              { value: "satteldach", label: "Satteldach" },
              { value: "pultdach", label: "Pultdach" },
              { value: "flachdach", label: "Flachdach" },
              { value: "unbekannt", label: "Unbekannt / gemischt" },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setRoofType(opt.value as any)}
                className={`rounded-full border px-3 py-1.5 text-left ${
                  roofType === opt.value
                    ? "border-neutral-900 bg-neutral-900 text-white"
                    : "border-neutral-200 text-neutral-700 hover:border-neutral-400"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-neutral-700">
            Bestehende PV-Anlage?
          </label>
          <div className="flex gap-2 text-xs">
            <button
              type="button"
              onClick={() => setHasExistingPv("yes")}
              className={`flex-1 rounded-full border px-3 py-1.5 ${
                hasExistingPv === "yes"
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-200 text-neutral-700 hover:border-neutral-400"
              }`}
            >
              Ja, bereits vorhanden
            </button>
            <button
              type="button"
              onClick={() => setHasExistingPv("no")}
              className={`flex-1 rounded-full border px-3 py-1.5 ${
                hasExistingPv === "no"
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-200 text-neutral-700 hover:border-neutral-400"
              }`}
            >
              Nein, noch keine
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-neutral-700">
            Jahresverbrauch Strom (falls bekannt)
          </label>
          <input
            type="text"
            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900/60"
            value={consumption}
            onChange={(e) => setConsumption(e.target.value)}
            placeholder="z.B. 8'500 kWh/Jahr"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-neutral-700">
            Bemerkungen / Besonderheiten
          </label>
          <textarea
            className="w-full min-h-[80px] rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900/60"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Schatten, Denkmalschutz, Sanierung geplant, etc."
          />
        </div>

        <div className="flex justify-between pt-2">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center rounded-full border border-neutral-300 text-sm px-4 py-2.5 text-neutral-700 hover:bg-neutral-50"
          >
            Zurück zum Profil
          </button>

          <button
            type="submit"
            className="inline-flex items-center rounded-full bg-neutral-900 text-white text-sm px-4 py-2.5 hover:bg-neutral-800 transition"
          >
            Weiter zur Gebäudeplanung
          </button>
        </div>
      </form>
    </div>
  );
}
