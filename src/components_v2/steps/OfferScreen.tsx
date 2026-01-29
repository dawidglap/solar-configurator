// src/components_v2/offer/OfferScreen.tsx
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

  const placedPanels = usePlannerV2Store((s) => s.panels);

  const placed = useMemo(() => {
    const qty = placedPanels.length;
    const panelId = placedPanels[0]?.panelId;
    const spec = panelId
      ? PANEL_CATALOG.find((p) => p.id === panelId)
      : undefined;

    const wp = spec?.wp ?? 0;
    const priceChf = (spec as any)?.priceChf ?? 0;
    const kWp = (qty * wp) / 1000;
    const total = qty * priceChf;

    return { qty, panelId, spec, wp, priceChf, kWp, total };
  }, [placedPanels]);

  const [sections, setSections] = useState({
    energiefluss: true,
    wirtschaftlichkeit: true,
    produktion: true,
    ersparnis: true,
  });

  const [pdfUrl, setPdfUrl] = useState("");
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [err, setErr] = useState("");

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
        credentials: "include",
        body: JSON.stringify({
          sections,
          summary: {
            qty: placed.qty,
            kWp: placed.kWp,
            panelId: placed.panelId,
            model: placed.spec
              ? `${placed.spec.brand} ${placed.spec.model}`
              : null,
            priceChf: placed.priceChf,
            totalChf: placed.total,
          },
        }),
      });

      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      setPdfUrl(URL.createObjectURL(blob));
    } catch (e: any) {
      setErr(e?.message ?? "PDF Fehler");
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
      {/* background */}
      <div className="absolute inset-0 z-0">
        <Image
          src="/images/hero.webp"
          alt=""
          fill
          priority
          className="object-cover object-bottom-right"
        />
        <div className="absolute inset-0 bg-black/30" />
      </div>

      <div className="relative z-10 w-full h-full grid grid-cols-12">
        {/* LEFT */}
        <aside className="col-span-3 bg-neutral-900/45 backdrop-blur-xl border-r border-white/10 flex flex-col h-full">
          {/* SCROLLABLE CONTENT */}
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            <div className="text-white/90 text-lg font-medium">Bericht</div>

            <ToggleRow
              label="Energiefluss"
              value={sections.energiefluss}
              onChange={(v) => setSections((s) => ({ ...s, energiefluss: v }))}
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

            <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-[12px] text-white/80">
              <Row label="Module (geplant)" value={fmt0.format(placed.qty)} />
              <Row label="Leistung" value={`${fmt2.format(placed.kWp)} kWp`} />
              <Row
                label="Modell"
                value={
                  placed.spec
                    ? `${placed.spec.brand} ${placed.spec.model}`
                    : "—"
                }
              />
            </div>
          </div>

          {/* STICKY FOOTER */}
          <div className="sticky bottom-0 border-t border-white/10 bg-neutral-900/80 p-4 space-y-3">
            <button
              onClick={onDownload}
              disabled={!pdfUrl}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/5 py-2 text-white/80 disabled:opacity-40"
            >
              <Download className="w-4 h-4" />
              Download
            </button>

            <button
              onClick={onGenerate}
              disabled={loadingPdf}
              className="w-full rounded-full border border-white/30 bg-white/10 py-3 text-white font-medium"
            >
              {loadingPdf ? "Generiere…" : "PDF generieren"}
            </button>

            {err && <div className="text-[11px] text-red-300">{err}</div>}
          </div>
        </aside>

        {/* MAIN */}
        <main className="col-span-9 flex items-center justify-center p-10">
          <div className="w-[720px] aspect-[1/1.414] bg-white shadow-2xl">
            {!pdfUrl ? (
              <PdfSkeleton />
            ) : (
              <iframe src={pdfUrl} className="w-full h-full" />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

/* helpers */

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between mt-1">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
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
    <div>
      <div className="text-white/85 mb-2">{label}</div>
      <button
        onClick={() => onChange(!value)}
        className="w-[86px] h-[34px] rounded-full border border-white/30 bg-white/5 relative"
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
  return <div className="w-full h-full p-8 bg-neutral-100 animate-pulse" />;
}
