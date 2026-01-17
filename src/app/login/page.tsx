// src/app/login/page.tsx
"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

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

      router.push("/planner-v2");
    } catch (err: any) {
      setError(err?.message || "Netzwerkfehler");
    } finally {
      setLoading(false);
    }
  }

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

      {/* Contenuto centrato */}
      <div className="flex min-h-screen items-center justify-center px-4">
        {/* Card glassmorphism */}
        <div
          className="
            w-full max-w-4xl
            rounded-[32px]
            border border-white/30
            bg-white/10
            backdrop-blur-sm
            shadow-[0_0_60px_rgba(0,0,0,0.65)]
            px-6 py-8
            sm:px-12 sm:py-10
            lg:px-20 lg:py-12
            text-white
          "
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

          {/* Form (UI + logica) */}
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
              "
            >
              {loading ? "Anmelden..." : "Anmelden"}
            </button>

            {error ? (
              <p className="text-center text-sm text-red-200">{error}</p>
            ) : null}
          </form>

          {/* Testo footer */}
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
