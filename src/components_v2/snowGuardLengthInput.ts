const SNOW_LENGTH_INPUT_PATTERN = /^\s*(\d+(?:[.,]\d+)?)\s*m?\s*$/i;

export type ParsedSnowLength =
  | { ok: true; value: number; normalized: string }
  | { ok: false; error: string };

export const INVALID_SNOW_LENGTH_MESSAGE =
  "Bitte eine gültige, nicht negative Länge eingeben (z. B. 25,46 m).";

export function formatSnowLengthInput(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  return String(value).replace(".", ",");
}

export function parseSnowLengthInput(rawValue: string): ParsedSnowLength {
  if (rawValue.trim() === "") {
    return { ok: true, value: 0, normalized: "" };
  }

  const match = SNOW_LENGTH_INPUT_PATTERN.exec(rawValue);
  if (!match) return { ok: false, error: INVALID_SNOW_LENGTH_MESSAGE };

  const value = Number(match[1].replace(",", "."));
  if (!Number.isFinite(value) || value < 0) {
    return { ok: false, error: INVALID_SNOW_LENGTH_MESSAGE };
  }

  return {
    ok: true,
    value,
    normalized: formatSnowLengthInput(value),
  };
}
