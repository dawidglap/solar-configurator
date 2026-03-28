export function getCorsHeaders(origin: string | null) {
  const allowedOrigins = [
    "https://app.helionic.ch",
  ];

  const isAllowed = origin && allowedOrigins.includes(origin);

  return {
    ...(isAllowed ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}