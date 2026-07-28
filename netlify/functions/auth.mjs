import {
  getAuthStatus,
  jsonResponse,
  loginManager,
  logoutManager,
  setupManagerPassword,
} from "../lib/auth-store.mjs";

const JSON_METHODS = new Set(["POST"]);

async function readRequestPayload(request) {
  if (!JSON_METHODS.has(request.method)) {
    return {};
  }

  try {
    const parsed = await request.json();
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export default async (request) => {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "cache-control": "no-store",
      },
    });
  }

  if (url.pathname === "/api/health" && request.method === "GET") {
    return jsonResponse(200, { ok: true, service: "yellow-dashboard-netlify-auth" });
  }

  if (url.pathname === "/api/auth/status" && request.method === "GET") {
    const status = await getAuthStatus(request);
    return jsonResponse(200, {
      mode: "backend",
      ...status,
    });
  }

  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    const payload = await readRequestPayload(request);
    return loginManager({
      email: payload.email,
      password: payload.password,
      requestUrl: request.url,
    });
  }

  if (url.pathname === "/api/auth/setup" && request.method === "POST") {
    const payload = await readRequestPayload(request);
    return setupManagerPassword({
      email: payload.email,
      password: payload.password,
      confirmPassword: payload.confirmPassword,
      requestUrl: request.url,
    });
  }

  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    return logoutManager(request);
  }

  return jsonResponse(404, { message: "הנתיב המבוקש לא נמצא." });
};

export const config = {
  path: [
    "/api/health",
    "/api/auth/status",
    "/api/auth/login",
    "/api/auth/setup",
    "/api/auth/logout",
  ],
};
