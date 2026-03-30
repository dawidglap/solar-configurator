export function getCorsHeaders(origin: string | null) {
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
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}