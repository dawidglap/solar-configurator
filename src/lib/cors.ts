export function getCorsHeaders(origin: string | null) {
  // origins statici base
  const staticAllowed = [
    "https://app.helionic.ch",
    "https://lovable.dev",
  ];

  // supporto wildcard per lovable preview (*.lovableproject.com)
  const isLovablePreview =
    !!origin && origin.endsWith(".lovableproject.com");

  // supporto ENV (facoltativo ma consigliato)
  const envAllowed = (process.env.ALLOWED_CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const isAllowed =
    !!origin &&
    (
      staticAllowed.includes(origin) ||
      envAllowed.includes(origin) ||
      isLovablePreview
    );

  return {
    ...(isAllowed ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}