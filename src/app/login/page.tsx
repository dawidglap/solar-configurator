// src/app/login/page.tsx
"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<
    "idle" | "checking" | "loading" | "success"
  >("idle");
  const [error, setError] = useState<string | null>(null);

  // timer refs (cleanup safe)
  const t1 = useRef<number | null>(null);
  const t2 = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (t1.current) window.clearTimeout(t1.current);
      if (t2.current) window.clearTimeout(t2.current);
    };
  }, []);

  const statusText = useMemo(() => {
    if (!loading) return "";
    switch (phase) {
      case "checking":
        return "Anmeldung wird geprüft…";
      case "loading":
        return "Profil wird geladen…";
      case "success":
        return "Erfolgreich angemeldet. Einen Moment…";
      default:
        return "Anmelden…";
    }
  }, [loading, phase]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;

    setError(null);
    setLoading(true);
    setPhase("checking");

    // micro UX: dopo 900ms cambia testo, fa percepire avanzamento
    t1.current = window.setTimeout(() => setPhase("loading"), 900);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Login fehlgeschlagen");
        return;
      }

      // success transition
      setPhase("success");

      // lascia 450ms per la transizione “premium” e poi naviga
      t2.current = window.setTimeout(() => {
        router.push("/planner-v2");
      }, 450);
    } catch (err: any) {
      setError(err?.message || "Netzwerkfehler");
    } finally {
      // se c'è errore, togli overlay
      // se è success, overlay resta fino al redirect
      if (!error) {
        // non fare niente qui: l’overlay sparisce con la navigazione
      } else {
        setLoading(false);
        setPhase("idle");
      }
    }
  }

  const disabled = loading;

  return (
    <main className="relative min-h-screen w-full overflow-hidden">
      {/* BG immagine + overlay scuro */}
      <div className="absolute inset-0 -z-10">
        <Image
          src="/images/hero.webp"
          alt="Sola Hintergrund"
          fill
          priority
          className="object-cover"
        />
        <div className="absolute inset-0 bg-black/40" />
      </div>

      {/* Premium loading overlay */}
      <div
        className={[
          "fixed inset-0 z-50 grid place-items-center",
          "transition-opacity duration-300",
          loading ? "opacity-100" : "pointer-events-none opacity-0",
        ].join(" ")}
        aria-hidden={!loading}
      >
        <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" />
        <div
          className={[
            "relative mx-4 w-full max-w-md",
            "rounded-3xl border border-white/20 bg-white/10",
            "shadow-[0_0_70px_rgba(0,0,0,0.75)] backdrop-blur-md",
            "p-6 sm:p-7 text-white",
            "transition-transform duration-300",
            loading ? "scale-100" : "scale-[0.98]",
          ].join(" ")}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-4">
            <div className="h-11 w-11 rounded-2xl border border-white/25 bg-white/10 grid place-items-center">
              <div className="h-5 w-5 rounded-full border-2 border-white/80 border-t-transparent animate-spin" />
            </div>
            <div className="min-w-0">
              <div className="text-sm sm:text-base font-semibold">
                {statusText || "Anmelden…"}
              </div>
              <div className="mt-1 text-[12px] text-white/75">
                Bitte nicht schließen.
              </div>
            </div>
          </div>

          <div className="mt-5 h-2 w-full rounded-full bg-white/10 overflow-hidden">
            <div
              className={[
                "h-full rounded-full bg-white/70",
                "transition-all duration-700",
                phase === "checking"
                  ? "w-[35%]"
                  : phase === "loading"
                    ? "w-[70%]"
                    : phase === "success"
                      ? "w-[100%]"
                      : "w-0",
              ].join(" ")}
            />
          </div>
        </div>
      </div>

      {/* Contenuto centrato */}
      <div className="flex min-h-screen items-center justify-center px-4">
        {/* Card glassmorphism */}
        <div
          className={[
            "w-full max-w-4xl rounded-[32px] border border-white/30 bg-white/10 backdrop-blur-sm",
            "shadow-[0_0_60px_rgba(0,0,0,0.65)] px-6 py-8 sm:px-12 sm:py-10 lg:px-20 lg:py-12",
            "text-white transition-opacity duration-300",
            loading ? "opacity-60" : "opacity-100",
          ].join(" ")}
        >
          {/* Logo + payoff */}
          <div className="flex flex-col items-center gap-4 mb-8 sm:mb-10">
            <div className="relative h-16 w-40 sm:h-20 sm:w-52">
              <Image
                src="/images/logo.png"
                alt="Sola Logo"
                fill
                className="object-contain"
                priority
              />
            </div>
          </div>

          {/* Testo di benvenuto */}
          <p className="mb-8 text-center text-sm sm:text-base text-white/90">
            Willkommen zurück. Melden Sie sich an, um fortzufahren.
          </p>

          {/* Form */}
          <form
            onSubmit={onSubmit}
            className="mx-auto flex max-w-xl flex-col gap-4"
          >
            <div>
              <input
                type="email"
                placeholder="E-Mail Adresse"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                disabled={disabled}
                className="
                  w-full rounded-full
                  border border-white/50
                  bg-white/12
                  px-6 py-3
                  text-sm sm:text-base
                  text-white
                  placeholder:text-white/80
                  outline-none
                  shadow-[0_0_18px_rgba(0,0,0,0.45)]
                  focus:border-white
                  focus:bg-white/18
                  disabled:opacity-60
                "
              />
            </div>

            <div>
              <input
                type="password"
                placeholder="Passwort"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                disabled={disabled}
                className="
                  w-full rounded-full
                  border border-white/50
                  bg-white/12
                  px-6 py-3
                  text-sm sm:text-base
                  text-white
                  placeholder:text-white/80
                  outline-none
                  shadow-[0_0_18px_rgba(0,0,0,0.45)]
                  focus:border-white
                  focus:bg-white/18
                  disabled:opacity-60
                "
              />
            </div>

            <button
              type="submit"
              disabled={loading || !email || !password}
              className="
                mt-2 w-full rounded-full
                bg-emerald-500/90
                px-6 py-3
                text-sm sm:text-base
                font-semibold text-white
                shadow-[0_0_18px_rgba(0,0,0,0.45)]
                hover:bg-emerald-400/90
                active:scale-[0.99]
                transition
                disabled:opacity-50 disabled:cursor-not-allowed
                flex items-center justify-center gap-2
              "
            >
              {loading ? (
                <>
                  <span className="h-4 w-4 rounded-full border-2 border-white/90 border-t-transparent animate-spin" />
                  <span>Anmelden…</span>
                </>
              ) : (
                "Anmelden"
              )}
            </button>

            {error ? (
              <p className="text-center text-sm text-red-200">{error}</p>
            ) : null}
          </form>

          {/* Footer */}
          <p className="mt-8 text-center text-[11px] sm:text-xs text-white/75">
            Probleme bei der Anmeldung?{" "}
            <a
              href="mailto:kontakt@sola.ch"
              className="text-emerald-300 hover:text-emerald-200 underline underline-offset-2"
            >
              kontakt@sola.ch
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}
