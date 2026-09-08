export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface ApiRequestOptions {
  method?: string;
  headers?: HeadersInit;
  body?: unknown;
}

/** Session-aware client shared by the migrated campaign controls. */
export async function requestJson<T = JsonObject>(
  endpoint: string,
  options: ApiRequestOptions = {},
  signal?: AbortSignal,
): Promise<{ response: Response; payload: T }> {
  const headers = new Headers(options.headers);
  headers.set("content-type", "application/json");
  const response = await fetch(endpoint, {
    method: options.method || "GET",
    credentials: "include",
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    signal,
  });
  const text = await response.text();
  let payload: unknown;
  try { payload = text ? JSON.parse(text) : {}; }
  catch { throw new Error(`תגובת שרת לא תקינה (HTTP ${response.status}).`); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("תגובת השרת אינה אובייקט JSON.");
  return { response, payload: payload as T };
}
