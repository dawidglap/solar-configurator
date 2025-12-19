// src/app/page.tsx
export const dynamic = "force-dynamic";

/* -------------------- UI helpers -------------------- */

function GlassShell({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={[
        "h-full rounded-2xl border border-white/25 bg-white/10 backdrop-blur-xl",
        "shadow-[0_0_30px_rgba(0,0,0,0.35)] ring-1 ring-white/10",
        className,
      ].join(" ")}
    >
      <div className="h-full rounded-2xl border border-white/20 p-8">
        {children}
      </div>
    </div>
  );
}

function CardBlock({
  title,
  heightClass,
  children,
}: {
  title: string;
  heightClass: string; // es. "h-[340px]"
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col">
      <h3 className="mb-3 text-[18px] font-medium text-white/90">{title}</h3>
      <GlassShell className={heightClass}>{children}</GlassShell>
    </section>
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
      <div className={`mt-1 text-[16px] font-medium ${color}`}>{label}</div>

      <div className="mt-1 text-[14px] text-white/60">
        <span>{sub}</span>
        {rightSub ? <span className="ml-3">{rightSub}</span> : null}
      </div>
    </div>
  );
}

function SmallStatInner({
  big,
  lines,
}: {
  big: string;
  lines: { label: string; value: string }[];
}) {
  return (
    <div className="flex h-full flex-col justify-center">
      <div className="text-center text-[72px] font-semibold leading-none text-emerald-200/90">
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
  );
}

/* -------------------- Page -------------------- */

export default function HomePage() {
  const CHF0 = "0 CHF";

  return (
    // ✅ IMPORTANT: la pagina segue sempre la sidebar tramite --sb
    <div
      className="w-full"
      style={{
        paddingLeft: "calc(var(--sb, 224px) + 32px)", // 32px = px-8
        paddingRight: "32px",
        paddingTop: "40px",
        paddingBottom: "40px",
      }}
    >
      {/* TOP ROW: 2 card uguali */}
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
        <CardBlock title="Projekte" heightClass="h-[340px]">
          <div className="grid h-full grid-cols-3 content-center gap-y-10">
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
        </CardBlock>

        <CardBlock title="Statistik" heightClass="h-[340px]">
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <div className="text-[18px] font-medium text-white/90">
                Grafik folgt demnächst
              </div>
              <div className="mt-2 text-sm text-white/60">(Coming soon)</div>
            </div>
          </div>
        </CardBlock>
      </div>

      {/* BOTTOM ROW: 4 card identiche */}
      <div className="mt-14 grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
        <CardBlock title="Kunden" heightClass="h-[240px]">
          <SmallStatInner
            big="0"
            lines={[
              { label: "Privat:", value: "0" },
              { label: "Firma:", value: "0" },
            ]}
          />
        </CardBlock>

        <CardBlock title="Aufgaben" heightClass="h-[240px]">
          <SmallStatInner
            big="0"
            lines={[
              { label: "Meine:", value: "0" },
              { label: "Kunden:", value: "0" },
            ]}
          />
        </CardBlock>

        <CardBlock title="Montagen" heightClass="h-[240px]">
          <SmallStatInner
            big="0"
            lines={[
              { label: "Montage:", value: "0" },
              { label: "Elektrisch:", value: "0" },
            ]}
          />
        </CardBlock>

        <CardBlock title="Entwürfe" heightClass="h-[240px]">
          <SmallStatInner big="0" lines={[{ label: "Entwurf:", value: "0" }]} />
        </CardBlock>
      </div>
    </div>
  );
}
