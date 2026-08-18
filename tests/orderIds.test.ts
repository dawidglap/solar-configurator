import assert from "node:assert/strict";
import test from "node:test";

import {
  expandOrderSearchTerm,
  getOrderIdAliases,
  getOrderIdQuery,
} from "../src/lib/orderIds";
import { sanitizePdfText } from "../src/lib/pdfText";

process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/order-id-unit-tests";

test("new order numbers use the AB prefix and retain the existing counter", async () => {
  const { nextOrderId } = await import("../src/lib/orders");
  const db = {
    collection(name: string) {
      assert.equal(name, "counters");
      return {
        async findOneAndUpdate(filter: any) {
          assert.equal(filter.type, "auftrag");
          assert.equal(filter.year, 2026);
          return { seq: 60 };
        },
      };
    },
  } as any;

  assert.equal(await nextOrderId(db, "company-1", new Date(2026, 7, 18)), "AB-2026-0060");
});

test("AB and legacy AUF route parameters resolve bidirectionally", () => {
  assert.deepEqual(getOrderIdAliases("AB-2026-0060"), ["AB-2026-0060", "AUF-2026-0060"]);
  assert.deepEqual(getOrderIdAliases("auf-2026-0060"), ["AUF-2026-0060", "AB-2026-0060"]);
  assert.deepEqual(getOrderIdQuery("AB-2026-0060"), {
    $in: ["AB-2026-0060", "AUF-2026-0060"],
  });
});

test("search expands both order prefixes without changing unrelated terms", () => {
  assert.deepEqual(expandOrderSearchTerm("AB-2026-0060"), ["AB-2026-0060", "AUF-2026-0060"]);
  assert.deepEqual(expandOrderSearchTerm("AUF-2026"), ["AUF-2026", "AB-2026"]);
  assert.deepEqual(expandOrderSearchTerm("Fabio Grosso"), ["Fabio Grosso"]);
});

test("PDF text keeps the German Auftragsbestätigung title intact", () => {
  assert.equal(sanitizePdfText("AUFTRAGSBESTÄTIGUNG"), "AUFTRAGSBESTÄTIGUNG");
  assert.equal(sanitizePdfText("Auftragsbestätigung"), "Auftragsbestätigung");
});
