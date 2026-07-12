export async function emitCompanyRealtimeEvent(
  companyId: string,
  event: string,
  payload: Record<string, unknown>,
) {
  if (process.env.NODE_ENV === "development") {
    console.info("[realtime:no-op]", { companyId, event, payload });
  }

  return false;
}
