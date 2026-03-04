// src/components_v2/offer/OfferScreen.tsx
"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download, Loader2 } from "lucide-react";
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
          sections: {
            energiefluss: true,
            wirtschaftlichkeit: true,
            produktion: true,
            ersparnis: true,
          },
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
    <div className="relative w-full h-full overflow-hidden border-[#7E8B97] border-l rounded-b-2xl">
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

      {/* STAGE */}
      <div className="relative z-10 w-full h-full flex items-center justify-center px-6 py-6">
        {/* PDF WRAPPER: centrato e “fit” nello schermo (niente tagli sopra/sotto) */}
        <div className="relative">
          {/* A4 box responsive: mantiene look del vecchio (720px) ma si riduce se serve */}
          <div
            className={[
              "bg-white shadow-2xl overflow-hidden",
              // ✅ dimensione “come prima” ma con fit verticale e orizzontale
              "w-[min(720px,90vw)]",
              // ✅ altezza: min tra viewport e rapporto A4 -> evita tagli
              "h-[min(84vh,calc(90vw*1.414))]",
            ].join(" ")}
          >
            {!pdfUrl ? (
              <PdfSkeleton />
            ) : (
              <iframe
                src={pdfUrl}
                className="w-full h-full"
                title="PDF Preview"
              />
            )}
          </div>

          {/* Download icon in alto a dx del PDF (solo se pdf pronto) */}
          {pdfUrl && (
            <button
              type="button"
              onClick={onDownload}
              className="absolute -right-3 top-2 rounded-full border border-[#6CE5E9]/70 bg-neutral-900/65 p-2 text-[#6CE5E9] backdrop-blur-md hover:bg-neutral-900/80 hover:border-[#6CE5E9]"
              title="Download"
            >
              <Download className="h-4 w-4" />
            </button>
          )}

          {/* Error sotto il PDF */}
          {err && (
            <div className="mt-3 text-[11px] text-red-300 text-center">
              {err}
            </div>
          )}
        </div>

        {/* BUTTON: posizione “come in foto” (in basso, centrato sotto il PDF) */}
        <div className="absolute left-1/2 bottom-7 -translate-x-1/2">
          <button
            onClick={onGenerate}
            disabled={loadingPdf}
            className={[
              "inline-flex items-center justify-center gap-2",
              "rounded-full border border-[#6CE5E9]/70 bg-neutral-900/40",
              "px-5 py-2 text-[12px] text-[#6CE5E9] backdrop-blur-md",
              "hover:bg-neutral-900/55 hover:border-[#6CE5E9]",
              "disabled:opacity-55",
            ].join(" ")}
          >
            {loadingPdf ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generiere…
              </>
            ) : (
              "PDF generieren"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function PdfSkeleton() {
  // ✅ identico alla versione che ti piaceva
  return <div className="w-full h-full p-8 bg-neutral-100 animate-pulse" />;
}
