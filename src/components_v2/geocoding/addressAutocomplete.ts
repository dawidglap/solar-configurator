export const ADDRESS_AUTOCOMPLETE_MIN_LENGTH = 3;

/**
 * Produces the free-text query sent to GeoAdmin without changing the visible
 * input. A terminal comma is only punctuation, not a search activation signal.
 */
export function normalizeAddressAutocompleteQuery(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/,+$/, "")
    .trim();
}

export function shouldSearchAddress(value: string): boolean {
  return normalizeAddressAutocompleteQuery(value).length >= ADDRESS_AUTOCOMPLETE_MIN_LENGTH;
}

/** Small request-version primitive used together with AbortController. */
export function createLatestAddressRequestGuard() {
  let latestRequestId = 0;
  return {
    begin(): number {
      latestRequestId += 1;
      return latestRequestId;
    },
    invalidate(): void {
      latestRequestId += 1;
    },
    isCurrent(requestId: number): boolean {
      return requestId === latestRequestId;
    },
  };
}
