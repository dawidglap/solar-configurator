export function isAllowedCorsOrigin(origin: string | null) {
  // origini statiche consentite
  const staticAllowed = [
    "https://app.helionic.ch",
    "https://planner.helionic.ch",
    "https://lovable.dev",
  ];

  // supporto wildcard per preview Lovable (*.lovableproject.com)
  const isLovablePreview =
    !!origin && origin.endsWith(".lovableproject.com");

  // supporto ENV opzionale
  const envAllowed = (process.env.ALLOWED_CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    !!origin &&
    (
      staticAllowed.includes(origin) ||
      envAllowed.includes(origin) ||
      isLovablePreview
    )
  );
}

export function getCorsHeaders(origin: string | null): Record<string, string> {
  const isAllowed = isAllowedCorsOrigin(origin);

  return {
    ...(isAllowed && origin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST, PUT, PATCH,DELETE,OPTIONS",
    // The CRM uses authenticated cross-origin requests and explicitly sends
    // Cache-Control for uncached PDF previews. Both headers must pass the
    // preflight before the invoice renderer can be reached.
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Cache-Control",
    "Access-Control-Expose-Headers": "X-QR-Bill-Warning",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
