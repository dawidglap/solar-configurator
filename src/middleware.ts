// src/middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function hasSessionCookie(req: NextRequest) {
  // cookie HttpOnly è leggibile dal middleware ✅
  return Boolean(req.cookies.get("session")?.value);
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  const isLoggedIn = hasSessionCookie(req);

  // ✅ Non toccare mai API e asset
  if (
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon.ico") ||
    pathname.startsWith("/images") ||
    pathname.startsWith("/fonts") ||
    pathname.startsWith("/robots.txt") ||
    pathname.startsWith("/sitemap.xml")
  ) {
    return NextResponse.next();
  }

  // ✅ Se non loggato: manda SEMPRE a /login (eccetto /login stesso)
  if (!isLoggedIn && pathname !== "/login") {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    // opzionale: torna dove eri dopo login
    url.searchParams.set("next", pathname + (search || ""));
    return NextResponse.redirect(url);
  }

  // Do not redirect /login based only on cookie presence. Middleware cannot
  // validate the signature, and a stale migration cookie must not trap the
  // browser in a redirect loop before it can authenticate again.

  return NextResponse.next();
}

export const config = {
  // Applica a tutto, esclusi i file statici più comuni
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
