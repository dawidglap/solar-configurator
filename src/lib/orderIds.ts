const CURRENT_ORDER_PREFIX = "AB-";
const LEGACY_ORDER_PREFIX = "AUF-";

export function normalizeOrderId(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

export function getOrderIdAliases(value: unknown) {
  const orderId = normalizeOrderId(value);
  if (!orderId) return [];

  if (orderId.startsWith(CURRENT_ORDER_PREFIX)) {
    return [orderId, `${LEGACY_ORDER_PREFIX}${orderId.slice(CURRENT_ORDER_PREFIX.length)}`];
  }
  if (orderId.startsWith(LEGACY_ORDER_PREFIX)) {
    return [orderId, `${CURRENT_ORDER_PREFIX}${orderId.slice(LEGACY_ORDER_PREFIX.length)}`];
  }
  return [orderId];
}

export function getOrderIdQuery(value: unknown) {
  const aliases = getOrderIdAliases(value);
  return aliases.length <= 1 ? aliases[0] ?? "" : { $in: aliases };
}

export function expandOrderSearchTerm(value: unknown) {
  const query = String(value ?? "").trim();
  if (!query) return [];

  const upper = query.toUpperCase();
  if (upper.includes(CURRENT_ORDER_PREFIX)) {
    return Array.from(new Set([query, upper.replace(CURRENT_ORDER_PREFIX, LEGACY_ORDER_PREFIX)]));
  }
  if (upper.includes(LEGACY_ORDER_PREFIX)) {
    return Array.from(new Set([query, upper.replace(LEGACY_ORDER_PREFIX, CURRENT_ORDER_PREFIX)]));
  }
  return [query];
}
