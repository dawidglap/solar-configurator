// src/app/dashboard/page.tsx
export const dynamic = "force-dynamic";

function GlassCard({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={["relative", className].join(" ")}>
      <h3 className="mb-3 text-[18px] font-medium text-white/90">{title}</h3>

      <div
        className={[
          "rounded-2xl border border-white/25 bg-white/10 backdrop-blur-xl",
          "shadow-[0_0_30px_rgba(0,0,0,0.35)]",
          "ring-1 ring-white/10",
        ].join(" ")}
      >
        {/* inner subtle frame like screenshot */}
        <div className="rounded-2xl border border-white/20 p-8">{children}</div>
      </div>
    </section>
  );
}

function BigNumberCard({
  title,
  big,
  lines,
}: {
  title: string;
  big: string;
  lines: { label: string; value: string }[];
}) {
  return (
    <section>
      <h3 className="mb-3 text-[18px] font-medium text-white/90">{title}</h3>
      <div className="rounded-2xl border border-white/25 bg-white/10 backdrop-blur-xl shadow-[0_0_30px_rgba(0,0,0,0.35)] ring-1 ring-white/10">
        <div className="rounded-2xl border border-white/20 p-7">
          <div className="text-center text-[64px] font-semibold leading-none text-emerald-200/90">
            {big}
          </div>
          <div className="mt-6 space-y-2 text-[18px] text-white/85">
            {lines.map((l) => (
              <div key={l.label} className="flex items-center gap-3">
                <span className="min-w-[90px] text-white/70">{l.label}</span>
                <span className="text-white/90">{l.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function DashboardPage() {
  // ✅ Tutti i dati a 0
  const CHF0 = "0 CHF";

  return (
    <div className="relative min-h-[calc(100dvh-0px)] w-full overflow-hidden">
      {/* Background "blurred" vibe (senza immagine) */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-br from-[#2c3a46] via-[#32414f] to-[#1c2530]" />
        {/* soft blobs like bokeh */}
        <div className="absolute left-[10%] top-[18%] h-64 w-64 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute right-[18%] top-[20%] h-72 w-72 rounded-full bg-amber-300/10 blur-3xl" />
        <div className="absolute left-[30%] bottom-[10%] h-80 w-80 rounded-full bg-sky-300/10 blur-3xl" />
        {/* vignette */}
        <div className="absolute inset-0 bg-black/25" />
      </div>

      {/* Content */}
      <div className="relative mx-auto w-full max-w-6xl px-8 py-10">
        {/* Top row */}
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
          {/* Projekte (6 tiles inside) */}
          <GlassCard title="Projekte">
            <div className="grid grid-cols-3 gap-y-10">
              <KpiMini
                value={CHF0}
                label="Leads"
                sub="(0)"
                color="text-sky-200"
              />
              <KpiMini
                value={CHF0}
                label="Terminiert"
                sub="(0)"
                color="text-indigo-200"
              />
              <KpiMini
                value={CHF0}
                label="Erstellt"
                sub="(0)"
                rightSub="Entwurf (0)"
                color="text-slate-200"
              />

              <KpiMini
                value={CHF0}
                label="Offeriert"
                sub="(0)"
                color="text-amber-200"
              />
              <KpiMini
                value={CHF0}
                label="Gewonnen"
                sub="(0)"
                color="text-emerald-200"
              />
              <KpiMini
                value={CHF0}
                label="Verloren"
                sub="(0)"
                color="text-rose-200"
              />
            </div>
          </GlassCard>

          {/* Statistik (coming soon card instead of chart) */}
          <GlassCard title="Statistik">
            <div className="flex h-[240px] items-center justify-center">
              <div className="text-center">
                <div className="text-[18px] font-medium text-white/90">
                  Grafik folgt demnächst
                </div>
                <div className="mt-2 text-sm text-white/60">(Coming soon)</div>
              </div>
            </div>
          </GlassCard>
        </div>

        {/* Bottom row */}
        <div className="mt-14 grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <BigNumberCard
            title="Kunden"
            big="0"
            lines={[
              { label: "Privat:", value: "0" },
              { label: "Firma:", value: "0" },
            ]}
          />
          <BigNumberCard
            title="Aufgaben"
            big="0"
            lines={[
              { label: "Meine:", value: "0" },
              { label: "Kunden:", value: "0" },
            ]}
          />
          <BigNumberCard
            title="Montagen"
            big="0"
            lines={[
              { label: "Montage:", value: "0" },
              { label: "Elektrisch:", value: "0" },
            ]}
          />
          <BigNumberCard
            title="Entwürfe"
            big="0"
            lines={[{ label: "Entwurf:", value: "0" }]}
          />
        </div>
      </div>
    </div>
  );
}

function KpiMini({
  value,
  label,
  sub,
  rightSub,
  color,
}: {
  value: string;
  label: string;
  sub: string;
  rightSub?: string;
  color: string;
}) {
  return (
    <div className="text-center">
      <div className="text-[22px] font-medium text-white/90">{value}</div>
      <div className={["mt-1 text-[16px] font-medium", color].join(" ")}>
        {label}
      </div>

      <div className="mt-1 text-[14px] text-white/60">
        <span>{sub}</span>
        {rightSub ? <span className="ml-3">{rightSub}</span> : null}
      </div>
    </div>
  );
}
