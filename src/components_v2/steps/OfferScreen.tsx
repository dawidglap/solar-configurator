"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download } from "lucide-react";
import { usePlannerV2Store } from "../state/plannerV2Store";
import { PANEL_CATALOG } from "@/constants/panels";

const fmt2 = new Intl.NumberFormat("de-CH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fmt0 = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 0 });

export default function OfferScreen() {
  const sp = useSearchParams();
  const planningId = sp.get("planningId") ?? "";

  // dati reali: pannelli piazzati + catalogo
  const placedPanels = usePlannerV2Store((s) => s.panels);

  const placed = useMemo(() => {
    const qty = placedPanels.length;
    const panelId = placedPanels[0]?.panelId;
    const spec = panelId
      ? PANEL_CATALOG.find((p) => p.id === panelId)
      : undefined;

    const wp = spec?.wp ?? 0;
    const priceChf = (spec as any)?.priceChf ?? 0; // se PanelSpec già ha priceChf, togli any
    const kWp = (qty * wp) / 1000;
    const total = qty * priceChf;

    return { qty, panelId, spec, wp, priceChf, kWp, total };
  }, [placedPanels]);

  // UI: toggle (per ora non cambiano dati; servono al cliente)
  const [sections, setSections] = useState({
    energiefluss: true,
    wirtschaftlichkeit: true,
    produktion: true,
    ersparnis: true,
  });

  // preview PDF
  const [pdfUrl, setPdfUrl] = useState<string>("");
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [err, setErr] = useState<string>("");

  const onGenerate = async () => {
    if (!planningId) {
      setErr("Missing planningId in URL.");
      return;
    }
    setErr("");
    setLoadingPdf(true);
    try {
      const res = await fetch(`/api/plannings/${planningId}/offer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // inviamo solo quello che serve ORA (toggle + dati minimi)
        body: JSON.stringify({
          sections,
        }),
      });

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || `HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);
    } catch (e: any) {
      setErr(e?.message ?? "Failed generating PDF");
    } finally {
      setLoadingPdf(false);
    }
  };

  const onDownload = () => {
    if (!pdfUrl) return;
    const a = document.createElement("a");
    a.href = pdfUrl;
    a.download = `Angebot_${planningId}.pdf`;
    a.click();
  };

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* background come gli altri screen */}
      <div className="absolute inset-0 z-0">
        <Image
          src="/images/hero.webp"
          alt=""
          fill
          priority
          className="object-cover object-bottom-right"
        />
        <div className="pointer-events-none absolute inset-0 bg-black/25" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/35 to-transparent" />
      </div>

      <div className="relative z-10 w-full h-full grid grid-cols-12 gap-0">
        {/* LEFT COLUMN */}
        <aside className="col-span-3 bg-neutral-900/40 backdrop-blur-xl border-r border-white/10">
          <div className="p-5 h-full flex flex-col">
            <div className="text-white/90 text-lg font-medium">Bericht</div>

            <div className="mt-6 space-y-6">
              <ToggleRow
                label="Energiefluss"
                value={sections.energiefluss}
                onChange={(v) =>
                  setSections((s) => ({ ...s, energiefluss: v }))
                }
              />
              <ToggleRow
                label="Wirtschaftlichkeit"
                value={sections.wirtschaftlichkeit}
                onChange={(v) =>
                  setSections((s) => ({ ...s, wirtschaftlichkeit: v }))
                }
              />
              <ToggleRow
                label="Produktion"
                value={sections.produktion}
                onChange={(v) => setSections((s) => ({ ...s, produktion: v }))}
              />
              <ToggleRow
                label="Ersparnis"
                value={sections.ersparnis}
                onChange={(v) => setSections((s) => ({ ...s, ersparnis: v }))}
              />
            </div>

            <div className="mt-8 rounded-xl border border-white/10 bg-white/5 p-3 text-[12px] text-white/80">
              <div className="flex justify-between">
                <span>Module (geplant)</span>
                <span className="tabular-nums">{fmt0.format(placed.qty)}</span>
              </div>
              <div className="flex justify-between mt-1">
                <span>Leistung</span>
                <span className="tabular-nums">
                  {fmt2.format(placed.kWp)} kWp
                </span>
              </div>
              <div className="flex justify-between mt-1">
                <span>Modell</span>
                <span className="tabular-nums">
                  {placed.spec
                    ? `${placed.spec.brand} ${placed.spec.model}`
                    : "—"}
                </span>
              </div>
            </div>

            <div className="mt-auto pt-6 space-y-3">
              <button
                type="button"
                onClick={onDownload}
                disabled={!pdfUrl}
                className="w-12 h-12 rounded-xl border border-white/15 bg-white/5 grid place-items-center text-white/80 disabled:opacity-40"
                title="Download"
              >
                <Download className="w-6 h-6" />
              </button>

              <button
                type="button"
                onClick={onGenerate}
                disabled={loadingPdf}
                className="w-full rounded-full border border-white/20 bg-white/5 px-4 py-3 text-white/90 hover:bg-white/10 transition disabled:opacity-60"
              >
                {loadingPdf ? "Generiere…" : "PDF generieren"}
              </button>

              {err ? (
                <div className="text-[11px] text-red-200/90 leading-snug">
                  {err}
                </div>
              ) : (
                <div className="text-[11px] text-white/45 leading-snug">
                  Hinweis: aktuell verwenden wir nur verfügbare Daten (Module +
                  Stückliste). Grafiken folgen später.
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* MAIN = PDF PREVIEW */}
        <main className="col-span-9 relative">
          {/* finta scrollbar/linea come nello screenshot */}
          <div className="pointer-events-none absolute top-24 bottom-24 right-10 w-[3px] rounded-full bg-white/70 opacity-70" />

          <div className="h-full w-full flex items-center justify-center p-10">
            <div className="relative w-[720px] max-w-[86%] aspect-[1/1.4142] rounded-sm bg-white shadow-2xl overflow-hidden">
              {!pdfUrl ? (
                <PdfSkeleton />
              ) : (
                <iframe
                  title="pdf-preview"
                  src={pdfUrl}
                  className="w-full h-full"
                />
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="text-white/85">{label}</div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className="w-[86px] h-[34px] rounded-full border border-white/30 bg-white/5 relative"
        aria-pressed={value}
      >
        <span
          className={`absolute top-[3px] h-[26px] w-[26px] rounded-full bg-white transition-all ${
            value ? "left-[54px]" : "left-[4px]"
          }`}
        />
      </button>
    </div>
  );
}

function PdfSkeleton() {
  return (
    <div className="w-full h-full p-8">
      <div className="h-24 w-full rounded bg-neutral-200 animate-pulse" />
      <div className="mt-6 h-6 w-2/3 rounded bg-neutral-200 animate-pulse" />
      <div className="mt-3 h-4 w-1/2 rounded bg-neutral-200 animate-pulse" />
      <div className="mt-10 space-y-3">
        <div className="h-4 w-full rounded bg-neutral-200 animate-pulse" />
        <div className="h-4 w-full rounded bg-neutral-200 animate-pulse" />
        <div className="h-4 w-5/6 rounded bg-neutral-200 animate-pulse" />
      </div>
      <div className="mt-10 h-56 w-full rounded bg-neutral-200 animate-pulse" />
    </div>
  );
}
