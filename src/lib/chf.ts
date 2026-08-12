/** Round a CHF amount to the smallest cash unit (5 Rappen). */
export function roundChf05(value: number) {
  return Math.round(value * 20) / 20;
}

export function formatChf05(value: number) {
  return new Intl.NumberFormat("de-CH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(roundChf05(value));
}

/** Round every line first, then round the resulting CHF total again. */
export function sumChf05(values: Iterable<number>) {
  let total = 0;
  for (const value of values) {
    total += roundChf05(value);
  }
  return roundChf05(total);
}

/**
 * Allocate a CHF total by percentages. If the percentages represent 100%, the
 * final rate receives the rounded remainder so all displayed rates add up.
 */
export function allocateChf05(total: number, percentages: number[]) {
  const roundedTotal = roundChf05(total);
  const representsWhole =
    Math.abs(percentages.reduce((sum, pct) => sum + pct, 0) - 100) <= 0.01;
  let allocated = 0;

  return percentages.map((pct, index) => {
    const amount = representsWhole && index === percentages.length - 1
      ? roundChf05(roundedTotal - allocated)
      : roundChf05((roundedTotal * pct) / 100);
    allocated = roundChf05(allocated + amount);
    return amount;
  });
}
