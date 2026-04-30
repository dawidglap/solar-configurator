import crypto from "crypto";
import { ObjectId } from "mongodb";
import { getCorsHeaders } from "@/lib/cors";

export type SessionPayload = {
  userId?: string | null;
  activeCompanyId?: string | null;
  [key: string]: unknown;
};

function sign(payload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function getCookie(req: Request, name: string) {
  const cookie = req.headers.get("cookie") || "";
  const parts = cookie.split(";").map((p) => p.trim());
  const found = parts.find((p) => p.startsWith(name + "="));
  return found ? decodeURIComponent(found.split("=").slice(1).join("=")) : null;
}

export function readSession(
  req: Request,
  secret: string
): SessionPayload | null {
  const token = getCookie(req, "session");
  if (!token) return null;

  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  if (sign(payload, secret) !== sig) return null;

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function safeString(v: unknown) {
  return typeof v === "string" ? v.trim() : "";
}

export function toObjectIdOrNull(v: unknown) {
  try {
    const s = safeString(v);
    if (!s) return null;
    return new ObjectId(s);
  } catch {
    return null;
  }
}

export function mongoIdToString(v: any) {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (v?.$oid) return String(v.$oid);
  if (typeof v?.toString === "function") return v.toString();
  return "";
}

export function jsonResponse(origin: string | null, body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...getCorsHeaders(origin),
    },
  });
}

