import sanitizeHtml from "sanitize-html";

const BLOCK_END_TAGS =
  /<\/(?:address|article|aside|blockquote|div|figcaption|figure|footer|h[1-6]|header|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)>/gi;

function decodeSerializedEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value.replace(
    /&(?:#(\d+)|#x([\da-f]+)|(amp|apos|gt|lt|nbsp|quot));/gi,
    (match, decimal: string | undefined, hex: string | undefined, name: string | undefined) => {
      const codePoint = decimal
        ? Number.parseInt(decimal, 10)
        : hex
          ? Number.parseInt(hex, 16)
          : Number.NaN;
      if (Number.isFinite(codePoint)) {
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return "";
        }
      }
      return name ? named[name.toLowerCase()] ?? match : match;
    },
  );
}

export function htmlToPlainText(value: unknown) {
  if (typeof value !== "string" || !value) return "";

  const withLineBreaks = value
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(BLOCK_END_TAGS, "\n");
  const withoutTags = sanitizeHtml(withLineBreaks, {
    allowedTags: [],
    allowedAttributes: {},
  });

  return decodeSerializedEntities(withoutTags)
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}
