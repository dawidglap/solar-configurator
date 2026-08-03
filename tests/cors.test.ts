import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { getCorsHeaders } from "../src/lib/cors";

describe("CORS headers", () => {
  test("allows authenticated PDF preview requests from the CRM", () => {
    const headers = getCorsHeaders("https://app.helionic.ch");

    assert.equal(headers["Access-Control-Allow-Origin"], "https://app.helionic.ch");
    assert.match(headers["Access-Control-Allow-Headers"], /(?:^|,\s*)Authorization(?:,|$)/i);
    assert.match(headers["Access-Control-Allow-Headers"], /(?:^|,\s*)Cache-Control(?:,|$)/i);
    assert.match(headers["Access-Control-Expose-Headers"], /(?:^|,\s*)X-QR-Bill-Warning(?:,|$)/i);
  });
});
