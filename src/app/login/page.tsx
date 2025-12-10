// src/app/login/page.tsx (o dove hai creato la route)
"use client";

import Image from "next/image";

export default function LoginPage() {
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

          {/* Form (solo UI, nessuna logica) */}
          <form className="mx-auto flex max-w-xl flex-col gap-4">
            <div>
              <input
                type="email"
                placeholder="E-Mail Adresse"
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
