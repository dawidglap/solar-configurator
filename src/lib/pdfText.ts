const REPLACEMENTS: Array<[RegExp, string]> = [
  [/Ä/g, "Ae"],
  [/Ö/g, "Oe"],
  [/Ü/g, "Ue"],
  [/ä/g, "ae"],
  [/ö/g, "oe"],
  [/ü/g, "ue"],
  [/ß/g, "ss"],
  [/ẞ/g, "SS"],
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
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\n\r\t\x20-\x7e\xa0-\xff]/g, "");
}
