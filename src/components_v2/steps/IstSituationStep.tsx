// src/components_v2/profile/IstSituationStep.tsx
"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  Circle,
  Home,
  Building2,
  Factory,
  Battery,
  Flame,
  Car,
  Calendar,
  Zap,
  Shield,
  Wifi,
  Camera,
  Plug,
  FileText,
} from "lucide-react";
import { usePlannerV2Store } from "../state/plannerV2Store";

export default function IstSituationStep() {
  const router = useRouter();
  const sp = useSearchParams();
  const planningId = sp.get("planningId");

  const setStep = usePlannerV2Store((s) => s.setStep);

  // ✅ IST dallo store (non più useState locali)
  const ist = usePlannerV2Store((s) => s.ist);
  const setIst = usePlannerV2Store((s) => s.setIst);

  const [saving, setSaving] = useState(false);

  const toggleChecklist = (key: keyof typeof ist.checklist) => {
    setIst({
      checklist: {
        ...ist.checklist,
        [key]: !ist.checklist[key],
      },
    });
  };

  const onNext = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!planningId) {
      alert("Fehler: planningId fehlt in der URL.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/plannings/${planningId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ist: {
            ...ist,
            completed: true,
          },
        }),
      });

      if (res.status === 401) {
        router.push("/login");
        return;
      }

      const json = await res.json().catch(() => null);
      if (!json?.ok) {
        console.error("IST save failed:", json);
        alert("Fehler: IST-Situation konnte nicht gespeichert werden.");
        return;
      }

      // ✅ dopo IST si passa a building (come nel backend)
      setStep("building");
    } finally {
      setSaving(false);
    }
  };

  const onBack = () => setStep("profile");

  return (
    <div className="w-full rounded-2xl bg-neutral-900/55 text-neutral-50 shadow-xl border border-white/10 backdrop-blur-md px-5 py-5 lg:px-7 lg:py-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <h1 className="text-base lg:text-lg font-semibold tracking-wide">
            IST-Situation
          </h1>
          <p className="text-[11px] lg:text-xs text-neutral-300 max-w-2xl">
            Erfasse die aktuelle Situation des Gebäudes, damit die Planung
            möglichst realistisch wird.
          </p>
        </div>
      </div>

      <form onSubmit={onNext} className="space-y-5">
        {/* MAIN GRID: CHECKLISTE + CARDS */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
          {/* ───────────── LEFT: CHECKLISTE ───────────── */}
          <aside className="rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md px-4 py-4 flex flex-col gap-4">
            <div>
              <h2 className="text-sm font-semibold">Checkliste</h2>
            </div>

            <div className="space-y-2.5 text-[11px]">
              {[
                {
                  key: "inverterPhoto" as const,
                  label: "Foto Ort Wechselrichter?",
                  icon: Plug,
                },
                {
                  key: "meterPhoto" as const,
                  label: "Foto Zähler?",
                  icon: Zap,
                },
                {
                  key: "cabinetPhoto" as const,
                  label: "Foto Elektrokasten?",
                  icon: Camera,
                },
                {
                  key: "lightning" as const,
                  label: "Blitzschutz vorhanden?",
                  icon: Shield,
                },
                {
                  key: "internet" as const,
                  label: "Internet vorhanden?",
                  icon: Wifi,
                },
                {
                  key: "naProtection" as const,
                  label: "NA Schutz?",
                  icon: Shield,
                },
                { key: "evg" as const, label: "EVG?", icon: Battery },
                { key: "zev" as const, label: "ZEV?", icon: FileText },
              ].map(({ key, label, icon: Icon }) => {
                const active = ist.checklist[key];
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleChecklist(key)}
                    className="w-full flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 hover:bg-white/5 transition"
                  >
                    <span className="flex items-center gap-2">
                      <Icon className="w-3.5 h-3.5 text-neutral-300" />
                      <span>{label}</span>
                    </span>
                    {active ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Circle className="w-4 h-4 text-neutral-500" />
                    )}
                  </button>
                );
              })}

              {/* Anzahl Wohnung */}
              <div className="mt-2 space-y-1.5">
                <span className="block text-[11px] text-neutral-200">
                  Anzahl Wohnung?
                </span>
                <input
                  type="number"
                  min={0}
                  className="w-20 rounded-full bg-white/5 border border-white/20 px-3 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-emerald-500/70"
                  value={ist.unitsCount}
                  onChange={(e) => setIst({ unitsCount: e.target.value })}
                />
              </div>
            </div>
          </aside>

          {/* ───────────── RIGHT: CARDS GRID ───────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 lg:gap-5 text-[11px] lg:text-[12px]">
            {/* 1: Gebäudetyp */}
            <Card number={1} title="Ihr Gebäudetyp wählen.">
              <div className="grid grid-cols-3 gap-3">
                {[
                  {
                    value: "ein" as const,
                    label: "Einfamilienhaus",
                    icon: Home,
                  },
                  {
                    value: "mehr" as const,
                    label: "Mehrfamilienhaus",
                    icon: Building2,
                  },
                  {
                    value: "industrie" as const,
                    label: "Industrie",
                    icon: Factory,
                  },
                ].map(({ value, label, icon: Icon }) => {
                  const active = ist.buildingType === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setIst({ buildingType: value })}
                      className={`flex flex-col items-center gap-2 rounded-xl border px-2 py-3 transition ${
                        active
                          ? "border-emerald-400/80 bg-emerald-500/10"
                          : "border-white/10 bg-white/0 hover:bg-white/5"
                      }`}
                    >
                      <Icon className="w-7 h-7" />
                      <span className="text-[10px] text-center leading-tight">
                        {label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </Card>

            {/* 2: Dachform */}
            <Card number={2} title="Ihr Dachform wählen.">
              <div className="flex gap-3">
                {[
                  { value: "satteldach" as const, label: "Satteldach" },
                  { value: "flachdach" as const, label: "Flachdach" },
                  { value: "pultdach" as const, label: "Pultdach" },
                ].map(({ value, label }) => {
                  const active = ist.roofShape === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setIst({ roofShape: value })}
                      className={`flex-1 rounded-full border px-3 py-1.5 transition ${
                        active
                          ? "border-emerald-400/80 bg-emerald-500/10"
                          : "border-white/15 hover:bg-white/5"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </Card>

            {/* 3: Dacheindeckung */}
            <Card number={3} title="Ihre Dacheindeckung wählen.">
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: "tonziegel", label: "Tonziegel" },
                  { value: "flachziegel", label: "Flachziegel" },
                  { value: "flach_begruent", label: "Flachdach begrünt" },
                  { value: "flach_bekiest", label: "Flachdach bekiesst" },
                  { value: "flacheternit", label: "Flacheternit" },
                  { value: "bitumen", label: "Bitumen" },
                  { value: "trapezblech", label: "Trapezblech" },
                  { value: "betonziegel", label: "Betondachziegel" },
                ].map(({ value, label }) => {
                  const active = ist.roofCover === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setIst({ roofCover: value as any })}
                      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 transition ${
                        active
                          ? "border-emerald-400/80 bg-emerald-500/10"
                          : "border-white/15 hover:bg-white/5"
                      }`}
                    >
                      <span
                        className={`w-2.5 h-2.5 rounded-full border ${
                          active
                            ? "border-emerald-400 bg-emerald-400"
                            : "border-neutral-400"
                        }`}
                      />
                      <span className="truncate">{label}</span>
                    </button>
                  );
                })}
              </div>
            </Card>

            {/* 4: Stromverbrauch */}
            <Card number={4} title="Stromverbrauch pro Jahr?">
              <div className="flex items-center gap-3">
                <Battery className="w-7 h-7 opacity-80" />
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      className="flex-1 rounded-full bg-white/5 border border-white/20 px-3 py-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-emerald-500/70"
                      value={ist.consumption}
                      onChange={(e) => setIst({ consumption: e.target.value })}
                      placeholder="z.B. 8'500"
                    />
                    <span className="text-[10px] uppercase tracking-wide text-neutral-300">
                      kWh
                    </span>
                  </div>
                  <p className="text-[10px] text-neutral-400">
                    Falls unbekannt: Stromrechnung hochladen oder schätzen.
                  </p>
                </div>
              </div>
            </Card>

            {/* 5: Heizung */}
            <Card number={5} title="Aktuelle Heizung?">
              <div className="flex gap-4">
                <Flame className="w-7 h-7 opacity-80" />
                <div className="flex-1 space-y-2">
                  <select
                    className="w-full rounded-full bg-white/5 border border-white/20 px-3 py-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-emerald-500/70"
                    value={ist.heating}
                    onChange={(e) => setIst({ heating: e.target.value as any })}
                  >
                    <option value="">Auswählen</option>
                    <option value="oel">Ölheizung</option>
                    <option value="gas">Gasheizung</option>
                    <option value="wp">Wärmepumpe</option>
                    <option value="fernwaerme">Fernwärme</option>
                    <option value="andere">Andere</option>
                  </select>

                  <button
                    type="button"
                    onClick={() => setIst({ heatingCombo: !ist.heatingCombo })}
                    className={`w-full rounded-full border px-3 py-1.5 text-left text-[11px] transition ${
                      ist.heatingCombo
                        ? "border-emerald-400/80 bg-emerald-500/10"
                        : "border-white/15 hover:bg-white/5"
                    }`}
                  >
                    Kombination
                  </button>
                </div>
              </div>
            </Card>

            {/* 6: HAK Grösse */}
            <Card number={6} title="HAK Grösse?">
              <div className="flex items-center gap-4">
                <Zap className="w-7 h-7 opacity-80" />
                <div className="flex-1 flex items-center gap-2">
                  <input
                    type="text"
                    className="flex-1 rounded-full bg-white/5 border border-white/20 px-3 py-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-emerald-500/70"
                    value={ist.hakSize}
                    onChange={(e) => setIst({ hakSize: e.target.value })}
                    placeholder="z.B. 40"
                  />
                  <span className="text-[10px] uppercase tracking-wide text-neutral-300">
                    Ampère
                  </span>
                </div>
              </div>
            </Card>

            {/* 7: Elektro Auto */}
            <Card number={7} title="Elektro Auto ein Thema?">
              <div className="flex gap-4">
                <Car className="w-7 h-7 opacity-80" />
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="text-[11px]">Ja</span>
                    <button
                      type="button"
                      onClick={() => setIst({ evTopic: "yes" })}
                      className={`w-3.5 h-3.5 rounded-full border ${
                        ist.evTopic === "yes"
                          ? "border-emerald-400 bg-emerald-400"
                          : "border-neutral-400"
                      }`}
                    />
                    <span className="ml-4 text-[11px]">Nein</span>
                    <button
                      type="button"
                      onClick={() => setIst({ evTopic: "no" })}
                      className={`w-3.5 h-3.5 rounded-full border ${
                        ist.evTopic === "no"
                          ? "border-emerald-400 bg-emerald-400"
                          : "border-neutral-400"
                      }`}
                    />
                  </div>

                  <div className="space-y-1">
                    <span className="block text-[10px] text-neutral-300">
                      Welches Auto?
                    </span>
                    <input
                      type="text"
                      className="w-full rounded-full bg-white/5 border border-white/20 px-3 py-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-emerald-500/70"
                      value={ist.evCar}
                      onChange={(e) => setIst({ evCar: e.target.value })}
                      placeholder="z.B. Tesla Model 3"
                    />
                  </div>
                </div>
              </div>
            </Card>

            {/* 8: Montagezeit */}
            <Card number={8} title="Wann soll die Montage erfolgen?">
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: "4" as const, label: "4 Monate" },
                  { value: "6" as const, label: "6 Monate" },
                  { value: "12" as const, label: "12 Monate" },
                ].map(({ value, label }) => {
                  const active = ist.montageTime === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setIst({ montageTime: value })}
                      className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-2 text-[10px] transition ${
                        active
                          ? "border-emerald-400/80 bg-emerald-500/10"
                          : "border-white/15 hover:bg-white/5"
                      }`}
                    >
                      <Calendar className="w-5 h-5" />
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>
            </Card>

            {/* 9: Demontage */}
            <Card number={9} title="Demontage?">
              <div className="space-y-2">
                <input
                  type="text"
                  className="w-full rounded-full bg-white/5 border border-white/20 px-3 py-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-emerald-500/70"
                  value={ist.dismantling}
                  onChange={(e) => setIst({ dismantling: e.target.value })}
                  placeholder="Demontage bestehender Anlage / Dach?"
                />
                <textarea
                  className="w-full min-h-[48px] rounded-2xl bg-white/5 border border-white/20 px-3 py-1.5 text-[11px] resize-none focus:outline-none focus:ring-1 focus:ring-emerald-500/70"
                  value={ist.dismantlingNote}
                  onChange={(e) => setIst({ dismantlingNote: e.target.value })}
                  placeholder="Notiz"
                />
              </div>
            </Card>
          </div>
        </div>

        {/* BOTTOM ACTIONS */}
        <div className="flex justify-between pt-2">
          <button
            type="button"
            onClick={onBack}
            disabled={saving}
            className="inline-flex items-center rounded-full border border-white/20 text-[11px] lg:text-xs px-4 py-2 text-neutral-100 hover:bg-white/5 transition disabled:opacity-60"
          >
            Zurück zum Profil
          </button>

          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center rounded-full bg-emerald-500/90 hover:bg-emerald-400 text-[11px] lg:text-xs px-4 py-2 text-white shadow-lg shadow-emerald-500/30 transition disabled:opacity-60"
          >
            {saving ? "Speichern…" : "Weiter zur Gebäudeplanung"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ───────────────── Helper Card component ───────────────── */

type CardProps = {
  number: number;
  title: string;
  children: React.ReactNode;
};

function Card({ number, title, children }: CardProps) {
  return (
    <section className="relative rounded-2xl bg-white/5 border border-white/12 backdrop-blur-md px-4 py-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-[11px] font-semibold">
            {number}
          </div>
          <h3 className="text-[11px] lg:text-xs font-semibold">{title}</h3>
        </div>
      </div>
      {children}
    </section>
  );
}
