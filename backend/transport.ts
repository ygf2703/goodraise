import type { IncomingMessage, ServerResponse } from "node:http";
import { handleRequest } from "./app";

const MAX_BODY_BYTES = 6_000_000;

export async function serveApi(incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of incoming) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BODY_BYTES) {
      outgoing.writeHead(413, { "content-type": "application/json" });
      outgoing.end(JSON.stringify({ message: "Request body is too large." }));
      return;
    }
    chunks.push(bytes);
  }
  const headers = new Headers();
  for (const [key, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
    else if (value !== undefined) headers.set(key, value);
  }
  // Local callers cannot spoof their address through a forwarding header.
  headers.set("x-forwarded-for", incoming.socket.remoteAddress || "unknown");
  const body = new Uint8Array(Buffer.concat(chunks));
  const request = new Request(new URL(incoming.url || "/", `http://${incoming.headers.host || "localhost"}`), {
    method: incoming.method,
    headers,
    ...(body.length ? { body } : {}),
  });
  const response = await handleRequest(request);
  outgoing.statusCode = response.status;
  response.headers.forEach((value, key) => { if (key !== "set-cookie") outgoing.setHeader(key, value); });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) outgoing.setHeader("set-cookie", cookies);
  outgoing.end(Buffer.from(await response.arrayBuffer()));
}
