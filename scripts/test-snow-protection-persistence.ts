import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  normalizeSnowProtectionConfiguration,
  resolveSnowProtectionSummary,
} from "../src/lib/planning/snowProtectionSummary";

const baseUrl = process.env.TEST_BASE_URL ?? "http://localhost:3011";
const cookieFile = process.env.TEST_COOKIE_FILE ?? "cookies.txt";

function readSessionCookie(): string {
  const line = readFileSync(cookieFile, "utf8")
    .split(/\r?\n/)
    .find((candidate) => candidate.split("\t")[5] === "session");
  const value = line?.split("\t")[6];
  if (!value) throw new Error(`No session cookie found in ${cookieFile}`);
  return `session=${value}`;
}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Cookie: readSessionCookie(),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.ok) {
    throw new Error(
      `${init?.method ?? "GET"} ${path} failed: ${json?.error ?? response.status}`,
    );
  }
  return json;
}

async function main() {
  let planningId: string | undefined;

  try {
    const created = await request("/api/plannings", {
      method: "POST",
      body: JSON.stringify({
        title: `P0 Schneefang persistence ${Date.now()}`,
        planningNumber: `TEST-SNOW-${Date.now()}`,
      }),
    });
    planningId = created.planningId;
    assert.equal(typeof planningId, "string");

    const planner = {
      version: 1,
      savedAt: new Date().toISOString(),
      step: "building",
      layers: [{ id: "roof-d1", name: "D1", points: [] }],
      zones: [],
      panels: [],
      snowGuards: [
        {
          id: "geometric-control",
          roofId: "roof-d1",
          p1: { x: 0, y: 0 },
          p2: { x: 50, y: 0 },
        },
      ],
      snowProtection: {
        quantityMode: "manual",
        manualSegments: [
          { id: "manual-110", roofId: "roof-d1", lengthM: 110 },
          { id: "manual-10", roofId: "roof-d1", lengthM: 10 },
        ],
      },
      snapshot: {
        url: null,
        width: 1000,
        height: 1000,
        mppImage: 0.1,
        center: null,
        zoom: null,
        bbox3857: null,
        address: null,
      },
    };

    const patched = await request(`/api/plannings/${planningId}`, {
      method: "PATCH",
      body: JSON.stringify({ planner }),
    });
    assert.equal(
      patched.planning.summary.snowProtection.totalLengthM,
      120,
      "PATCH response must expose the persisted manual quantity",
    );

    // A completely new HTTP request is the persistence boundary under test.
    const loaded = await request(`/api/plannings/${planningId}`);
    const persisted = loaded.planning.data.planner.snowProtection;
    assert.deepEqual(persisted, planner.snowProtection);
    assert.equal(loaded.planning.summary.snowProtection.totalLengthM, 120);
    assert.deepEqual(loaded.planning.summary.snowProtection.byRoof, [
      { roofId: "roof-d1", lengthM: 120 },
    ]);
    assert.equal(JSON.stringify(persisted).includes("pricePerM"), false);

    // Recreate the frontend-derived display state from the GET payload with no
    // selected roof. Selection is intentionally not an input to the resolver.
    const hydratedConfiguration = normalizeSnowProtectionConfiguration(persisted);
    const hydratedSummary = resolveSnowProtectionSummary({
      snowProtection: hydratedConfiguration,
      snowGuards: loaded.planning.data.planner.snowGuards,
      mppImage: loaded.planning.data.planner.snapshot.mppImage,
      roofIds: loaded.planning.data.planner.layers.map((roof: any) => roof.id),
    });
    assert.equal(hydratedSummary.totalLengthM, 120);

    console.log(JSON.stringify({
      ok: true,
      persistedPayload: persisted,
      getSummary: loaded.planning.summary.snowProtection,
      hydratedWithoutSelectedRoof: hydratedSummary.totalLengthM,
    }, null, 2));
  } finally {
    if (planningId) {
      await request(`/api/plannings/${planningId}`, { method: "DELETE" });
    }
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
