const integerAngleFormatter = new Intl.NumberFormat("de-DE", {
  maximumFractionDigits: 0,
});

/** Customer-facing formatting only. The supplied domain value is untouched. */
export function formatDisplayAngleDeg(value: number): string {
  return `${integerAngleFormatter.format(value)}°`;
}
