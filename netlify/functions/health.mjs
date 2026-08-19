import { getRuntimeHealth, jsonResponse } from "../lib/auth-store.mjs";

export default async function healthHandler() {
  const payload = await getRuntimeHealth();
  return jsonResponse(payload.ok ? 200 : 503, payload);
}
