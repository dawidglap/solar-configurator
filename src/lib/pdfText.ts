const REPLACEMENTS: Array<[RegExp, string]> = [
  [/“|”/g, "\""],
  [/‘|’/g, "'"],
  [/—|–/g, "-"],
  [/…/g, "..."],
  [/•/g, "-"],
  [/\u00a0/g, " "],
];

export function sanitizePdfText(value: unknown) {
  const raw =
    typeof value === "string"
      ? value.trim()
      : value == null
        ? ""
        : String(value).trim();

  if (!raw) return "";

  let text = raw;
  for (const [pattern, replacement] of REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }

  return text
    .normalize("NFKC")
    .replace(/[^\n\r\t\x20-\x7e\xa0-\xff]/g, "");
}
