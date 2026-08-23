import crypto from "node:crypto";
import { createClient, type RedisClientType } from "redis";
import { safeString } from "@/lib/api-session";

export const REALTIME_RETRY_MS = 5_000;
export const REALTIME_KEEP_ALIVE_MS = 25_000;
export const MAX_REALTIME_STREAMS_PER_USER = 5;

export type CompanyRealtimeEvent = Record<string, unknown> & {
  type: string;
};

type RealtimeConnection = {
  id: string;
  companyId: string;
  userId: string;
  openedAt: number;
  send: (event: CompanyRealtimeEvent) => void;
  close: () => void;
};

type RedisFanout = {
  publisher: RedisClientType;
  subscriber: RedisClientType;
};

type RealtimeState = {
  instanceId: string;
  connections: Map<string, RealtimeConnection>;
  connectionIdsByUser: Map<string, string[]>;
  redisFanoutPromise: Promise<RedisFanout | null> | null;
};

declare global {
  var _helionicRealtimeState: RealtimeState | undefined;
}

const state: RealtimeState = globalThis._helionicRealtimeState ?? {
  instanceId: crypto.randomUUID(),
  connections: new Map(),
  connectionIdsByUser: new Map(),
  redisFanoutPromise: null,
};

if (!globalThis._helionicRealtimeState) {
  globalThis._helionicRealtimeState = state;
}

function normalizeEventType(value: unknown) {
  const type = safeString(value);
  return /^[A-Za-z0-9._:-]{1,100}$/.test(type) ? type : "event";
}

export function buildCompanyRealtimeEvent(
  type: string,
  payload: Record<string, unknown> = {},
): CompanyRealtimeEvent {
  const normalizedType = normalizeEventType(type);
  const event: CompanyRealtimeEvent = { type: normalizedType, ...payload };
  event.type = normalizedType;
  return event;
}

export function formatCompanyRealtimeEvent(event: CompanyRealtimeEvent) {
  const type = normalizeEventType(event.type);
  return `event: ${type}\ndata: ${JSON.stringify({ ...event, type })}\n\n`;
}

function removeConnection(connectionId: string) {
  const connection = state.connections.get(connectionId);
  if (!connection) return;
  state.connections.delete(connectionId);
  const userConnections = state.connectionIdsByUser.get(connection.userId) ?? [];
  const remaining = userConnections.filter((id) => id !== connectionId);
  if (remaining.length) state.connectionIdsByUser.set(connection.userId, remaining);
  else state.connectionIdsByUser.delete(connection.userId);
}

function broadcastLocal(companyId: string, event: CompanyRealtimeEvent) {
  let delivered = false;
  for (const connection of [...state.connections.values()]) {
    if (connection.companyId !== companyId) continue;
    try {
      connection.send(event);
      delivered = true;
    } catch {
      removeConnection(connection.id);
      try {
        connection.close();
      } catch {
        // Stream is already gone.
      }
    }
  }
  return delivered;
}

async function ensureRedisFanout(): Promise<RedisFanout | null> {
  const redisUrl = safeString(process.env.REDIS_URL);
  if (!redisUrl) return null;
  if (state.redisFanoutPromise) return state.redisFanoutPromise;

  state.redisFanoutPromise = (async () => {
    const publisher = createClient({
      url: redisUrl,
      socket: { connectTimeout: 1_500, reconnectStrategy: false },
    });
    const subscriber = publisher.duplicate();
    publisher.on("error", (error) => console.error("[realtime:redis:publisher]", error));
    subscriber.on("error", (error) => console.error("[realtime:redis:subscriber]", error));
    await Promise.all([publisher.connect(), subscriber.connect()]);
    await subscriber.pSubscribe("events:*", (message, channel) => {
      try {
        const companyId = safeString(channel).replace(/^events:/, "");
        const envelope = JSON.parse(message);
        if (!companyId || safeString(envelope?.sourceInstanceId) === state.instanceId) return;
        const event = buildCompanyRealtimeEvent(safeString(envelope?.event?.type), envelope?.event ?? {});
        broadcastLocal(companyId, event);
      } catch (error) {
        console.error("[realtime:redis:message]", error);
      }
    });
    return { publisher, subscriber } as RedisFanout;
  })().catch((error) => {
    state.redisFanoutPromise = null;
    console.error("[realtime:redis:connect]", error);
    return null;
  });

  return state.redisFanoutPromise;
}

async function publishRedis(companyId: string, event: CompanyRealtimeEvent) {
  const fanout = await ensureRedisFanout();
  if (!fanout) return false;
  await fanout.publisher.publish(
    `events:${companyId}`,
    JSON.stringify({ sourceInstanceId: state.instanceId, event }),
  );
  return true;
}

async function deliverConfiguredWebhook(event: CompanyRealtimeEvent) {
  const url = safeString(process.env.COMPANY_WEBHOOK_URL);
  if (!url) return;
  const body = JSON.stringify(event);
  const secret = safeString(process.env.COMPANY_WEBHOOK_SECRET);
  if (!secret) {
    console.error("[realtime:webhook] COMPANY_WEBHOOK_SECRET fehlt; Webhook wird nicht unsigniert versendet.");
    return;
  }
  const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Helionic-Signature": `sha256=${signature}`,
      },
      body,
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) {
      console.error(`[realtime:webhook] HTTP ${response.status}`);
    }
  } catch (error) {
    console.error("[realtime:webhook]", error);
  }
}

export function registerCompanyRealtimeStream(args: {
  companyId: string;
  userId: string;
  send: (event: CompanyRealtimeEvent) => void;
  close: () => void;
}) {
  const companyId = safeString(args.companyId);
  const userId = safeString(args.userId);
  if (!companyId || !userId) throw new Error("companyId und userId sind erforderlich.");

  const connection: RealtimeConnection = {
    id: crypto.randomUUID(),
    companyId,
    userId,
    openedAt: Date.now(),
    send: args.send,
    close: args.close,
  };
  const existingIds = (state.connectionIdsByUser.get(userId) ?? [])
    .filter((id) => state.connections.has(id));
  while (existingIds.length >= MAX_REALTIME_STREAMS_PER_USER) {
    const oldestId = existingIds.shift();
    if (!oldestId) break;
    const oldest = state.connections.get(oldestId);
    removeConnection(oldestId);
    try {
      oldest?.close();
    } catch {
      // Stream is already gone.
    }
  }

  state.connections.set(connection.id, connection);
  state.connectionIdsByUser.set(userId, [...existingIds, connection.id]);
  void ensureRedisFanout();

  return () => removeConnection(connection.id);
}

export async function emitCompanyRealtimeEvent(
  companyId: string,
  type: string,
  payload: Record<string, unknown>,
) {
  const normalizedCompanyId = safeString(companyId);
  if (!normalizedCompanyId) return false;
  const event = buildCompanyRealtimeEvent(type, payload);
  const deliveredLocally = broadcastLocal(normalizedCompanyId, event);
  const deliveredViaRedis = await publishRedis(normalizedCompanyId, event).catch((error) => {
    console.error("[realtime:redis:publish]", error);
    return false;
  });
  void deliverConfiguredWebhook(event);
  return deliveredLocally || deliveredViaRedis;
}

function idString(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    const stringifier = Reflect.get(value, "toString");
    if (typeof stringifier === "function") return String(stringifier.call(value)).trim();
  }
  return "";
}

export function emitInvoiceUpdatedEvent(companyId: string, invoice: unknown) {
  const record = invoice && typeof invoice === "object"
    ? invoice as Record<string, unknown>
    : {};
  const updatedAt = record.updatedAt instanceof Date
    ? record.updatedAt.toISOString()
    : safeString(record.updatedAt) || new Date().toISOString();
  return emitCompanyRealtimeEvent(companyId, "invoice.updated", {
    invoiceId: idString(record._id),
    planningId: idString(record.planningId),
    orderId: safeString(record.orderId) || null,
    status: safeString(record.status) || null,
    paymentStatus: safeString(record.paymentStatus) || null,
    updatedAt,
  });
}

export function getRealtimeConnectionCount(companyId?: string) {
  const normalizedCompanyId = safeString(companyId);
  return [...state.connections.values()].filter(
    (connection) => !normalizedCompanyId || connection.companyId === normalizedCompanyId,
  ).length;
}

export function resetRealtimeConnectionsForTests() {
  for (const connection of [...state.connections.values()]) {
    try {
      connection.close();
    } catch {
      // Ignore cleanup failures in tests.
    }
  }
  state.connections.clear();
  state.connectionIdsByUser.clear();
}
