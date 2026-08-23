import { readSession, safeString } from "@/lib/api-session";
import { getCorsHeaders, isAllowedCorsOrigin } from "@/lib/cors";
import {
  formatCompanyRealtimeEvent,
  REALTIME_KEEP_ALIVE_MS,
  REALTIME_RETRY_MS,
  registerCompanyRealtimeStream,
} from "@/lib/realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 1_800;

function jsonError(origin: string | null, message: string, status: number) {
  return new Response(JSON.stringify({ ok: false, message }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...getCorsHeaders(origin),
    },
  });
}

function isRejectedCorsOrigin(origin: string | null) {
  return !!origin && !isAllowedCorsOrigin(origin);
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  if (isRejectedCorsOrigin(origin)) {
    return jsonError(origin, "Origin nicht erlaubt.", 403);
  }
  return new Response(null, { status: 204, headers: getCorsHeaders(origin) });
}

export async function GET(req: Request) {
  const origin = req.headers.get("origin");
  if (isRejectedCorsOrigin(origin)) {
    return jsonError(origin, "Origin nicht erlaubt.", 403);
  }

  const secret = safeString(process.env.SESSION_SECRET);
  if (!secret) return jsonError(origin, "SESSION_SECRET fehlt.", 500);
  const session = readSession(req, secret);
  const companyId = safeString(session?.activeCompanyId);
  const userId = safeString(session?.userId);
  if (!companyId || !userId) {
    return jsonError(origin, "Nicht eingeloggt.", 401);
  }

  const encoder = new TextEncoder();
  let closeStream: (() => void) | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unregister: () => void = () => {};
      let keepAlive: ReturnType<typeof setInterval> | null = null;

      const enqueue = (message: string) => {
        if (closed) return;
        controller.enqueue(encoder.encode(message));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (keepAlive) clearInterval(keepAlive);
        unregister();
        req.signal.removeEventListener("abort", close);
        try {
          controller.close();
        } catch {
          // The client already closed the stream.
        }
      };
      closeStream = close;

      enqueue(`retry: ${REALTIME_RETRY_MS}\n\n`);
      unregister = registerCompanyRealtimeStream({
        companyId,
        userId,
        send: (event) => enqueue(formatCompanyRealtimeEvent(event)),
        close,
      });
      keepAlive = setInterval(() => enqueue(": ping\n\n"), REALTIME_KEEP_ALIVE_MS);
      (keepAlive as NodeJS.Timeout).unref?.();
      req.signal.addEventListener("abort", close, { once: true });
      if (req.signal.aborted) close();
    },
    cancel() {
      closeStream?.();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...getCorsHeaders(origin),
    },
  });
}
