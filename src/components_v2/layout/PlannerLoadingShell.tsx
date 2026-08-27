"use client";

export default function PlannerLoadingShell({ error }: { error?: string }) {
  return (
    <div
      className="fixed inset-0 z-[1000] overflow-hidden bg-background text-foreground"
      style={{ backgroundColor: "hsl(var(--background))" }}
      role="status"
      aria-busy={!error}
      aria-live="polite"
    >
      <div className="absolute inset-x-0 top-0 h-[var(--tb,48px)] border-b border-border/60 bg-background" />
      <div className="absolute bottom-0 left-0 top-[var(--tb,48px)] w-[var(--propW,264px)] border-r border-border/60 bg-background">
        <div className="space-y-3 p-4 opacity-45" aria-hidden="true">
          <div className="h-3 w-20 rounded bg-muted" />
          <div className="h-8 rounded-lg bg-muted" />
          <div className="h-px bg-border" />
          <div className="h-3 w-28 rounded bg-muted" />
          <div className="h-20 rounded-xl bg-muted" />
        </div>
      </div>
      <div className="absolute inset-0 flex items-center justify-center pl-[var(--propW,264px)]">
        <p className="rounded-full border border-border/70 bg-muted/40 px-4 py-2 text-[11px] font-medium text-muted-foreground">
          {error ?? "Planung wird geladen …"}
        </p>
      </div>
    </div>
  );
}
