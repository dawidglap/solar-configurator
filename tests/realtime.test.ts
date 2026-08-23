import assert from "node:assert/strict";
import crypto from "node:crypto";
import test, { afterEach, beforeEach } from "node:test";

const originalRedisUrl = process.env.REDIS_URL;
const originalWebhookUrl = process.env.COMPANY_WEBHOOK_URL;
const originalSessionSecret = process.env.SESSION_SECRET;

const loadRealtime = () => import("../src/lib/realtime");

beforeEach(async () => {
  delete process.env.REDIS_URL;
  delete process.env.COMPANY_WEBHOOK_URL;
  const { resetRealtimeConnectionsForTests } = await loadRealtime();
  resetRealtimeConnectionsForTests();
});

afterEach(async () => {
  const { resetRealtimeConnectionsForTests } = await loadRealtime();
  resetRealtimeConnectionsForTests();
  if (originalRedisUrl == null) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = originalRedisUrl;
  if (originalWebhookUrl == null) delete process.env.COMPANY_WEBHOOK_URL;
  else process.env.COMPANY_WEBHOOK_URL = originalWebhookUrl;
  if (originalSessionSecret == null) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSessionSecret;
});

test("formats typed SSE events and protects the canonical type", async () => {
  const { buildCompanyRealtimeEvent, formatCompanyRealtimeEvent } = await loadRealtime();
  const event = buildCompanyRealtimeEvent("offer.signed", {
    type: "forged",
    planningId: "planning-1",
    orderId: "AUF-1",
  });
  assert.deepEqual(event, {
    type: "offer.signed",
    planningId: "planning-1",
    orderId: "AUF-1",
  });
  assert.equal(
    formatCompanyRealtimeEvent(event),
    'event: offer.signed\ndata: {"type":"offer.signed","planningId":"planning-1","orderId":"AUF-1"}\n\n',
  );
});

test("delivers events only to streams of the matching company", async () => {
  const { emitCompanyRealtimeEvent, registerCompanyRealtimeStream } = await loadRealtime();
  const companyA: unknown[] = [];
  const companyB: unknown[] = [];
  registerCompanyRealtimeStream({
    companyId: "company-a",
    userId: "user-a",
    send: (event) => companyA.push(event),
    close: () => undefined,
  });
  registerCompanyRealtimeStream({
    companyId: "company-b",
    userId: "user-b",
    send: (event) => companyB.push(event),
    close: () => undefined,
  });

  await emitCompanyRealtimeEvent("company-a", "offer.viewed", { planningId: "planning-a" });
  assert.deepEqual(companyA, [{ type: "offer.viewed", planningId: "planning-a" }]);
  assert.deepEqual(companyB, []);
});

test("keeps at most five streams per user and closes the oldest", async () => {
  const {
    getRealtimeConnectionCount,
    MAX_REALTIME_STREAMS_PER_USER,
    registerCompanyRealtimeStream,
  } = await loadRealtime();
  let oldestClosed = 0;
  for (let index = 0; index < MAX_REALTIME_STREAMS_PER_USER + 1; index += 1) {
    registerCompanyRealtimeStream({
      companyId: `company-${index}`,
      userId: "same-user",
      send: () => undefined,
      close: () => {
        if (index === 0) oldestClosed += 1;
      },
    });
  }
  assert.equal(oldestClosed, 1);
  assert.equal(getRealtimeConnectionCount(), MAX_REALTIME_STREAMS_PER_USER);
  assert.equal(getRealtimeConnectionCount("company-0"), 0);
});

test("SSE route authenticates the cookie and returns streaming headers plus retry", async () => {
  const secret = "realtime-test-secret";
  process.env.SESSION_SECRET = secret;
  const payload = Buffer.from(JSON.stringify({
    userId: "user-1",
    activeCompanyId: "company-1",
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const { GET } = await import("../src/app/api/events/stream/route");
  const response = await GET(new Request("https://planner.helionic.ch/api/events/stream", {
    headers: {
      origin: "https://app.helionic.ch",
      cookie: `session=${payload}.${signature}`,
    },
  }));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  assert.equal(response.headers.get("cache-control"), "no-cache, no-transform");
  assert.equal(response.headers.get("connection"), "keep-alive");
  assert.equal(response.headers.get("x-accel-buffering"), "no");
  assert.equal(response.headers.get("access-control-allow-origin"), "https://app.helionic.ch");
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  const reader = response.body!.getReader();
  const first = await reader.read();
  assert.equal(new TextDecoder().decode(first.value), "retry: 5000\n\n");
  const { emitCompanyRealtimeEvent } = await loadRealtime();
  await emitCompanyRealtimeEvent("company-1", "offer.signed", {
    planningId: "planning-1",
    orderId: "AUF-1",
    signedAt: "2026-08-23T09:41:00.000Z",
  });
  const event = await reader.read();
  assert.equal(
    new TextDecoder().decode(event.value),
    'event: offer.signed\ndata: {"type":"offer.signed","planningId":"planning-1","orderId":"AUF-1","signedAt":"2026-08-23T09:41:00.000Z"}\n\n',
  );
  await reader.cancel();
});

test("SSE route rejects untrusted cross-origin requests", async () => {
  process.env.SESSION_SECRET = "realtime-test-secret";
  const { GET } = await import("../src/app/api/events/stream/route");
  const response = await GET(new Request("https://planner.helionic.ch/api/events/stream", {
    headers: { origin: "https://evil.example" },
  }));
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});
