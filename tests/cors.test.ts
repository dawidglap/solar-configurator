import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { getCorsHeaders } from "../src/lib/cors";
import { jsonResponse as apiJsonResponse } from "../src/lib/api-session";
import { jsonResponse as taskJsonResponse } from "../src/lib/tasks";

describe("CORS headers", () => {
  test("allows authenticated PDF preview requests from the CRM", () => {
    const headers = getCorsHeaders("https://app.helionic.ch");

    assert.equal(headers["Access-Control-Allow-Origin"], "https://app.helionic.ch");
    assert.match(headers["Access-Control-Allow-Headers"], /(?:^|,\s*)Authorization(?:,|$)/i);
    assert.match(headers["Access-Control-Allow-Headers"], /(?:^|,\s*)Cache-Control(?:,|$)/i);
    assert.match(headers["Access-Control-Expose-Headers"], /(?:^|,\s*)X-QR-Bill-Warning(?:,|$)/i);
  });

  test("adds the frontend message alias to legacy error responses", async () => {
    for (const response of [
      apiJsonResponse(null, { ok: false, error: "Invalid request" }, 400),
      taskJsonResponse(null, { ok: false, error: "Invalid request" }, 400),
    ]) {
      assert.deepEqual(await response.json(), {
        ok: false,
        error: "Invalid request",
        message: "Invalid request",
      });
    }
  });
});
