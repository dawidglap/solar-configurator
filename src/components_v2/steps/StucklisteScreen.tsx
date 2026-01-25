"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { usePlannerV2Store } from "../state/plannerV2Store";
import { PANEL_CATALOG } from "@/constants/panels";
import { Pencil, Plus } from "lucide-react";

type LineItem = {
  id: string;
  kategorie: string;
  marke: string;
  beschreibung: string;
  einzelpreis: number; // CHF
  stk: number;
  einheit?: string; // "Stk.", "m", "h" ecc. (colonna M.)
  optional?: boolean;
};

const fmt2 = new Intl.NumberFormat("de-CH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fmt0 = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 0 });

export default function StucklisteScreen() {
  const placedPanels = usePlannerV2Store((s) => s.panels);

  /**
   * ✅ 1) FIX: La riga "Modul" è SOLO la realtà dei pannelli piazzati.
   * Nessun click a sinistra può modificarla.
   */
  const placedModulesRow = useMemo(() => {
    const qty = placedPanels.length;
    const panelId = placedPanels[0]?.panelId;

    const spec = panelId
      ? PANEL_CATALOG.find((p) => p.id === panelId)
      : undefined;

    const wp = spec?.wp ?? 0;
    const priceChf = spec?.priceChf ?? 0;
    const kWp = (qty * wp) / 1000;
    const total = qty * priceChf;

    return { qty, panelId, spec, wp, priceChf, kWp, total };
  }, [placedPanels]);

  /**
   * ✅ 2) Altre voci (manuali) — per ora esempi
   * (Queste sono cose che l’utente aggiunge nella Stückliste, NON moduli piazzati in planimetria)
   */
  const [items, setItems] = useState<LineItem[]>([
    {
      id: "sample-substructure",
      kategorie: "Unterkonstruktion",
      marke: "K2 Systems",
      beschreibung: "Schienenset (Beispiel)",
      einzelpreis: 45,
      stk: 10,
      einheit: "Stk.",
    },
    {
      id: "sample-montage",
      kategorie: "Montage",
      marke: "Service",
      beschreibung: "Montagepauschale (Beispiel)",
      einzelpreis: 850,
      stk: 1,
      einheit: "Pausch.",
    },
  ]);

  /**
   * ✅ 3) Dropdown Modules: scegli un modello dal catalogo e aggiungi una riga MANUALE.
   * IMPORTANTISSIMO: questa NON cambia i "placed panels".
   */
  const [selectedCatalogPanelId, setSelectedCatalogPanelId] = useState<string>(
    PANEL_CATALOG[0]?.id ?? "",
  );

  const addManualModuleLineFromCatalog = () => {
    const spec = PANEL_CATALOG.find((p) => p.id === selectedCatalogPanelId);
    if (!spec) return;

    setItems((prev) => [
      {
        id: `manual-module-${Date.now()}`,
        kategorie: "Modul (manuell)",
        marke: spec.brand,
        beschreibung: `${spec.model} (${fmt0.format(spec.wp)} Wp) – manuell hinzugefügt`,
        einzelpreis: spec.priceChf ?? 0,
        stk: 1,
        einheit: "Stk.",
      },
      ...prev,
    ]);
  };

  const addSample = (kategorie: string) => {
    const map: Record<string, LineItem> = {
      Unterkonstruktion: {
        id: `sample-${Date.now()}`,
        kategorie: "Unterkonstruktion",
        marke: "K2 Systems",
        beschreibung: "K2 Metalldach-Kit (Beispiel)",
        einzelpreis: 60,
        stk: 6,
        einheit: "Stk.",
      },
      Optimierer: {
        id: `sample-${Date.now()}`,
        kategorie: "Optimierer",
        marke: "Tigo",
        beschreibung: "TS4-A-O (Beispiel)",
        einzelpreis: 35,
        stk: 10,
        einheit: "Stk.",
      },
      Montage: {
        id: `sample-${Date.now()}`,
        kategorie: "Montage",
        marke: "Service",
        beschreibung: "Montagepauschale (Beispiel)",
        einzelpreis: 850,
        stk: 1,
        einheit: "Pausch.",
      },
      AC: {
        id: `sample-${Date.now()}`,
        kategorie: "AC Elektrisch",
        marke: "Install",
        beschreibung: "AC Anschluss / Schutz (Beispiel)",
        einzelpreis: 320,
        stk: 1,
        einheit: "Pausch.",
      },
      DC: {
        id: `sample-${Date.now()}`,
        kategorie: "DC Elektrisch",
        marke: "Install",
        beschreibung: "DC Verkabelung (Beispiel)",
        einzelpreis: 280,
        stk: 1,
        einheit: "Pausch.",
      },
      Vollmacht: {
        id: `sample-${Date.now()}`,
        kategorie: "Vollmacht",
        marke: "Dokument",
        beschreibung: "Vollmacht & Anmeldung (Beispiel)",
        einzelpreis: 120,
        stk: 1,
        einheit: "Stk.",
      },
    };

    const li =
      map[kategorie] ??
      ({
        id: `sample-${Date.now()}`,
        kategorie,
        marke: "—",
        beschreibung: "Neuer Posten (Beispiel)",
        einzelpreis: 0,
        stk: 1,
        einheit: "Stk.",
      } as LineItem);

    setItems((prev) => [li, ...prev]);
  };

  const rowTotal = (r: LineItem) => r.einzelpreis * r.stk;

  /**
   * ✅ Totali (solo per preview a destra — per ora placeholder)
   * Sommiamo: moduli piazzati + items manuali
   */
  const totals = useMemo(() => {
    const placed = placedModulesRow.total;
    const extras = items.reduce((acc, r) => acc + rowTotal(r), 0);
    return {
      placedModulesTotal: placed,
      extrasTotal: extras,
      grandTotal: placed + extras,
    };
  }, [placedModulesRow.total, items]);

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* BACKGROUND come PlannerEmptyState */}
      <div className="absolute inset-0 z-0">
        <Image
          src="/images/hero.webp"
          alt=""
          fill
          priority
          className="object-cover object-bottom-right"
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white to-transparent" />
      </div>

      {/* CONTENUTO sopra al background */}
      <div className="relative z-10 w-full h-full grid grid-cols-12 gap-0 pt-10">
        {/* LEFT */}
        <aside className="col-span-3 border-r border-white/10 bg-neutral-900/35 backdrop-blur-xl overflow-y-auto">
          <div className="p-4 min-h-full">
            <div className="flex items-center gap-2 text-white/80">
              <div className="h-7 w-7 rounded-full border border-white/20 grid place-items-center">
                <Plus className="h-4 w-4" />
              </div>
              <div className="text-sm font-medium">Neue Leistung erstellen</div>
            </div>

            <div className="mt-4 space-y-4 text-sm">
              {/* MODULE dropdown reale: prende da PANEL_CATALOG */}
              <div className="space-y-2">
                <div className="text-white/70">Module:</div>

                <select
                  value={selectedCatalogPanelId}
                  onChange={(e) => setSelectedCatalogPanelId(e.target.value)}
                  className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-left text-white/80 focus:outline-none"
                >
                  {PANEL_CATALOG.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.brand} – {p.model} ({fmt0.format(p.wp)}Wp)
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={addManualModuleLineFromCatalog}
                  className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-left text-white/80 hover:bg-white/10 transition"
                >
                  Als Zusatzposten hinzufügen (manuell)
                </button>

                <div className="text-[11px] text-white/40 leading-snug">
                  Wichtig: Diese Aktion verändert NICHT die geplanten Module auf
                  dem Dach. Sie fügt nur einen Posten zur Stückliste hinzu.
                </div>
              </div>

              <LeftButton
                label="Unterkonstruktion"
                onAdd={() => addSample("Unterkonstruktion")}
              />
              <LeftButton
                label="Optimierer"
                onAdd={() => addSample("Optimierer")}
              />
              <LeftButton label="Montage" onAdd={() => addSample("Montage")} />
              <LeftButton label="AC Elektrisch" onAdd={() => addSample("AC")} />
              <LeftButton label="DC Elektrisch" onAdd={() => addSample("DC")} />
              <LeftButton
                label="Vollmacht"
                onAdd={() => addSample("Vollmacht")}
              />
            </div>

            <div className="mt-6 text-[11px] text-white/40 leading-snug">
              TODO (später): Das Modul-/Produkt-Katalog wird pro Firma aus der
              Datenbank geladen. Aktuell nutzen wir PANEL_CATALOG als MVP.
            </div>
          </div>
        </aside>

        {/* CENTER */}
        <main className="col-span-6 bg-neutral-900/25 backdrop-blur-xl overflow-y-auto">
          <div className="p-4 min-h-full">
            {/* header row */}
            <div className="text-[11px] uppercase tracking-wide text-white/45 grid grid-cols-12 gap-2 pb-2 border-b border-white/10">
              <div className="col-span-2">Kategorie</div>
              <div className="col-span-2">Marke</div>
              <div className="col-span-3">Beschreibung</div>
              <div className="col-span-2 text-right">Einzelpreis</div>
              <div className="col-span-1 text-right">Stk.</div>
              <div className="col-span-1 text-center">M.</div>
              <div className="col-span-1 text-right">Preis in CHF</div>
            </div>

            {/* ✅ PLACED MODULES (AUTOMATISCH) */}
            <RowCard
              kategorie="Modul"
              marke={placedModulesRow.spec?.brand ?? "—"}
              beschreibung={
                placedModulesRow.spec
                  ? `${placedModulesRow.spec.model} (${fmt0.format(
                      placedModulesRow.wp,
                    )} Wp) – ${fmt2.format(placedModulesRow.kWp)} kWp`
                  : "Keine Module platziert"
              }
              einzelpreis={placedModulesRow.spec?.priceChf ?? 0}
              stk={placedModulesRow.qty}
              einheit="—"
              total={placedModulesRow.total}
              editable={false}
            />

            {/* Other items (manual examples) */}
            <div className="mt-3 space-y-2">
              {items.map((r) => (
                <RowCard
                  key={r.id}
                  kategorie={r.kategorie}
                  marke={r.marke}
                  beschreibung={r.beschreibung}
                  einzelpreis={r.einzelpreis}
                  stk={r.stk}
                  einheit={r.einheit ?? "—"}
                  total={rowTotal(r)}
                  editable
                />
              ))}
            </div>
          </div>
        </main>

        {/* RIGHT (Preview placeholder) */}
        <aside className="col-span-3 border-l border-white/10 bg-neutral-900/35 backdrop-blur-xl">
          <div className="p-4">
            <div className="text-sm font-medium text-white/80">Vorschau</div>

            {/* mini totals box (nicht PDF, nur MVP info) */}
            <div className="mt-3 rounded-lg border border-white/10 bg-white/5 p-3 text-[12px] text-white/75 space-y-1">
              <div className="flex justify-between">
                <span>Module (geplant)</span>
                <span className="tabular-nums">
                  {fmt2.format(totals.placedModulesTotal)} CHF
                </span>
              </div>
              <div className="flex justify-between">
                <span>Zusatzposten</span>
                <span className="tabular-nums">
                  {fmt2.format(totals.extrasTotal)} CHF
                </span>
              </div>
              <div className="h-px bg-white/10 my-2" />
              <div className="flex justify-between font-medium text-white">
                <span>Total</span>
                <span className="tabular-nums">
                  {fmt2.format(totals.grandTotal)} CHF
                </span>
              </div>
            </div>

            <div className="mt-3 space-y-3">
              <PreviewSkeleton />
              <PreviewSkeleton />
            </div>

            <div className="mt-4 text-[11px] text-white/45">
              Die PDF-Vorschau kommt später. Im MVP zeigen wir hier nur ein
              Platzhalter-Layout.
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function LeftButton({ label, onAdd }: { label: string; onAdd: () => void }) {
  return (
    <div className="space-y-2">
      <div className="text-white/70">{label}</div>
      <button
        type="button"
        onClick={onAdd}
        className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-left text-white/80 hover:bg-white/10 transition"
      >
        Auswahl… (Beispiel hinzufügen)
      </button>
    </div>
  );
}

function RowCard(props: {
  kategorie: string;
  marke: string;
  beschreibung: string;
  einzelpreis: number;
  stk: number;
  einheit: string;
  total: number;
  editable?: boolean;
}) {
  const {
    kategorie,
    marke,
    beschreibung,
    einzelpreis,
    stk,
    einheit,
    total,
    editable,
  } = props;

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-white/85">
      <div className="grid grid-cols-12 gap-2 items-center text-[12px]">
        <div className="col-span-2">{kategorie}</div>
        <div className="col-span-2">{marke}</div>
        <div className="col-span-3 text-white/70">{beschreibung}</div>

        <div className="col-span-2 text-right tabular-nums">
          {fmt2.format(einzelpreis)}
        </div>

        <div className="col-span-1 text-right tabular-nums">
          {fmt0.format(stk)}
        </div>

        <div className="col-span-1 text-center text-white/50">{einheit}</div>

        <div className="col-span-1 text-right tabular-nums">
          {fmt2.format(total)}
        </div>
      </div>

      {editable && (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70 hover:bg-white/10"
          >
            <Pencil className="h-3.5 w-3.5" />
            Bearbeiten
          </button>
        </div>
      )}
    </div>
  );
}

function PreviewSkeleton() {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
      <div className="h-32 w-full rounded-md bg-white/10 animate-pulse" />
      <div className="mt-3 h-3 w-2/3 rounded bg-white/10 animate-pulse" />
      <div className="mt-2 h-3 w-1/2 rounded bg-white/10 animate-pulse" />
      <div className="mt-2 h-3 w-3/4 rounded bg-white/10 animate-pulse" />
    </div>
  );
}
