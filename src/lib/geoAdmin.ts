import crypto from "node:crypto";
import type { Db } from "mongodb";
import { safeString } from "@/lib/api-session";

const GEO_ADMIN_BASE = "https://api3.geo.admin.ch/rest/services/api";
const GEO_ADMIN_TIMEOUT_MS = 5_000;

export type ObjectAddressInput = {
  street: string;
  houseNumber: string;
  zip: string;
  city: string;
};

export type GeoAdminPropertyResult = {
  lookupSucceeded: boolean;
  addressStreet: string | null;
  addressHouseNumber: string | null;
  addressZip: string | null;
  addressCity: string | null;
  egid: string | null;
  buildingNumber: string | null;
  parcelNumber: string | null;
  easting: number | null;
  northing: number | null;
  featureId: string | null;
};

const EMPTY_RESULT: GeoAdminPropertyResult = {
  lookupSucceeded: false,
  addressStreet: null,
  addressHouseNumber: null,
  addressZip: null,
  addressCity: null,
  egid: null,
  buildingNumber: null,
  parcelNumber: null,
  easting: null,
  northing: null,
  featureId: null,
};

let indexPromise: Promise<void> | null = null;

function attributeString(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return safeString(value);
}

export function normalizeObjectAddress(input: Partial<ObjectAddressInput>): ObjectAddressInput {
  return {
    street: safeString(input.street),
    houseNumber: safeString(input.houseNumber),
    zip: safeString(input.zip),
    city: safeString(input.city),
  };
}

export function objectAddressFingerprint(input: Partial<ObjectAddressInput>) {
  const normalized = normalizeObjectAddress(input);
  return [normalized.street, normalized.houseNumber, normalized.zip, normalized.city]
    .map((value) => value.toLocaleLowerCase("de-CH").replace(/\s+/g, " "))
    .join("|");
}

export function hasResolvableObjectAddress(input: Partial<ObjectAddressInput>) {
  const normalized = normalizeObjectAddress(input);
  return Boolean(normalized.street && normalized.houseNumber && normalized.zip && normalized.city);
}

export function objectAddressChanged(
  previous: Partial<ObjectAddressInput>,
  next: Partial<ObjectAddressInput>,
) {
  return objectAddressFingerprint(previous) !== objectAddressFingerprint(next);
}

function decodeHtml(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseGeoAdminAddress(
  attrs: Record<string, unknown>,
  fallback: ObjectAddressInput,
) {
  const label = decodeHtml(safeString(attrs.label));
  const detail = decodeHtml(safeString(attrs.detail));
  const source = label || detail;
  const zipMatch = source.match(/\b(\d{4})\b/);
  if (!zipMatch || typeof zipMatch.index !== "number") {
    return {
      addressStreet: fallback.street || null,
      addressHouseNumber: fallback.houseNumber || null,
      addressZip: fallback.zip || null,
      addressCity: fallback.city || null,
    };
  }
  const beforeZip = source.slice(0, zipMatch.index).trim();
  const city = label
    ? source.slice(zipMatch.index + zipMatch[0].length).trim()
    : fallback.city;
  const explicitNumber = attributeString(attrs.num);
  const numberMatch = beforeZip.match(/\s+(\d+[\p{L}\d./-]*)$/u);
  const houseNumber = explicitNumber || safeString(numberMatch?.[1]) || fallback.houseNumber;
  const street = numberMatch ? beforeZip.slice(0, numberMatch.index).trim() : beforeZip;
  return {
    addressStreet: street || fallback.street || null,
    addressHouseNumber: houseNumber || null,
    addressZip: zipMatch[1] || fallback.zip || null,
    addressCity: city || fallback.city || null,
  };
}

export function normalizeLv95Coordinates(attrs: Record<string, unknown>) {
  const first = Number(attrs.x);
  const second = Number(attrs.y);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
  if (first >= 2_000_000 && second >= 1_000_000 && second < 2_000_000) {
    return { easting: first, northing: second };
  }
  if (second >= 2_000_000 && first >= 1_000_000 && first < 2_000_000) {
    return { easting: second, northing: first };
  }
  return null;
}

export function extractParcelNumber(attributes: Record<string, unknown> | null | undefined) {
  if (!attributes) return null;
  const preferred = [
    "number",
    "nummer",
    "parzellennummer",
    "parcelnumber",
    "lparz",
    "name",
  ];
  const entries = Object.entries(attributes);
  for (const candidate of preferred) {
    const match = entries.find(([key]) => key.toLowerCase().replace(/[^a-z]/g, "") === candidate);
    const value = attributeString(match?.[1]);
    if (value) return value;
  }
  return null;
}

async function fetchGeoAdminJson(url: URL) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEO_ADMIN_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "Helionic-Planner/1.0" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`GeoAdmin HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function identifyUrl(easting: number, northing: number, layer: string) {
  const url = new URL(`${GEO_ADMIN_BASE}/MapServer/identify`);
  url.searchParams.set("geometry", `${easting},${northing}`);
  url.searchParams.set("geometryType", "esriGeometryPoint");
  url.searchParams.set("layers", `all:${layer}`);
  url.searchParams.set("tolerance", "5");
  url.searchParams.set("sr", "2056");
  url.searchParams.set(
    "mapExtent",
    `${easting - 50},${northing - 50},${easting + 50},${northing + 50}`,
  );
  url.searchParams.set("imageDisplay", "100,100,96");
  return url;
}

async function resolveParcel(easting: number, northing: number) {
  for (const layer of [
    "ch.kantone.cadastralwebmap",
    "ch.swisstopo-vd.amtliche-vermessung",
  ]) {
    try {
      const payload = await fetchGeoAdminJson(identifyUrl(easting, northing, layer));
      const attributes = payload?.results?.[0]?.attributes;
      const parcelNumber = extractParcelNumber(attributes);
      if (parcelNumber) return parcelNumber;
    } catch {
      // Coverage and identify support vary by canton; continue with the fallback layer.
    }
  }
  return null;
}

async function ensureGeoAdminCacheIndex(db: Db) {
  if (indexPromise) return indexPromise;
  indexPromise = db.collection("geoAdminAddressCache")
    .createIndex({ key: 1 }, { unique: true, name: "unique_geo_admin_address_key" })
    .then(() => undefined)
    .catch((error) => {
      indexPromise = null;
      throw error;
    });
  return indexPromise;
}

function normalizeCachedResult(value: any): GeoAdminPropertyResult {
  const optionalNumber = (candidate: unknown) =>
    candidate !== null && candidate !== undefined && candidate !== "" && Number.isFinite(Number(candidate))
      ? Number(candidate)
      : null;
  return {
    lookupSucceeded: value?.lookupSucceeded !== false,
    addressStreet: safeString(value?.addressStreet) || null,
    addressHouseNumber: safeString(value?.addressHouseNumber) || null,
    addressZip: safeString(value?.addressZip) || null,
    addressCity: safeString(value?.addressCity) || null,
    egid: safeString(value?.egid) || null,
    buildingNumber: safeString(value?.buildingNumber) || null,
    parcelNumber: safeString(value?.parcelNumber) || null,
    easting: optionalNumber(value?.easting),
    northing: optionalNumber(value?.northing),
    featureId: safeString(value?.featureId) || null,
  };
}

export async function resolveGeoAdminProperty(
  db: Db,
  addressInput: Partial<ObjectAddressInput>,
): Promise<GeoAdminPropertyResult> {
  const address = normalizeObjectAddress(addressInput);
  if (!hasResolvableObjectAddress(address)) return { ...EMPTY_RESULT };
  await ensureGeoAdminCacheIndex(db);
  const fingerprint = objectAddressFingerprint(address);
  const key = crypto.createHash("sha256").update(fingerprint).digest("hex");
  const cache = db.collection("geoAdminAddressCache");
  const cached = await cache.findOne({ key });
  if (cached?.result) return normalizeCachedResult(cached.result);

  const searchUrl = new URL(`${GEO_ADMIN_BASE}/SearchServer`);
  searchUrl.searchParams.set(
    "searchText",
    `${address.street} ${address.houseNumber}, ${address.zip} ${address.city}`,
  );
  searchUrl.searchParams.set("type", "locations");
  searchUrl.searchParams.set("origins", "address");
  searchUrl.searchParams.set("sr", "2056");
  searchUrl.searchParams.set("limit", "1");

  try {
    const search = await fetchGeoAdminJson(searchUrl);
    const attrs = search?.results?.[0]?.attrs as Record<string, unknown> | undefined;
    const coordinates = attrs ? normalizeLv95Coordinates(attrs) : null;
    if (!attrs || !coordinates) {
      await cache.updateOne(
        { key },
        {
          $set: {
            key,
            fingerprint,
            address,
            result: { ...EMPTY_RESULT, lookupSucceeded: true },
            resolvedAt: new Date(),
          },
        },
        { upsert: true },
      );
      return { ...EMPTY_RESULT, lookupSucceeded: true };
    }

    const [buildingPayload, parcelNumber] = await Promise.all([
      fetchGeoAdminJson(
        identifyUrl(
          coordinates.easting,
          coordinates.northing,
          "ch.bfs.gebaeude_wohnungs_register",
        ),
      ).catch(() => null),
      resolveParcel(coordinates.easting, coordinates.northing),
    ]);
    const buildingAttributes = buildingPayload?.results?.[0]?.attributes as
      | Record<string, unknown>
      | undefined;
    const egid = attributeString(buildingAttributes?.egid) || null;
    const parsedAddress = parseGeoAdminAddress(attrs, address);
    const gwrStreet = Array.isArray(buildingAttributes?.strname)
      ? attributeString(buildingAttributes?.strname?.[0])
      : attributeString(buildingAttributes?.strname);
    const normalizedAddress = {
      addressStreet: gwrStreet || parsedAddress.addressStreet,
      addressHouseNumber:
        attributeString(buildingAttributes?.deinr) || parsedAddress.addressHouseNumber,
      addressZip:
        attributeString(buildingAttributes?.dplz4) || parsedAddress.addressZip,
      addressCity:
        attributeString(buildingAttributes?.dplzname) || parsedAddress.addressCity,
    };
    const result: GeoAdminPropertyResult = {
      lookupSucceeded: true,
      ...normalizedAddress,
      egid,
      buildingNumber: egid,
      parcelNumber: parcelNumber || extractParcelNumber(buildingAttributes),
      ...coordinates,
      featureId: attributeString(attrs.featureId) || null,
    };
    await cache.updateOne(
      { key },
      { $set: { key, fingerprint, address, result, resolvedAt: new Date() } },
      { upsert: true },
    );
    return result;
  } catch (error) {
    console.warn("GEOADMIN ADDRESS RESOLUTION FAILED:", (error as Error)?.message || error);
    return { ...EMPTY_RESULT };
  }
}
