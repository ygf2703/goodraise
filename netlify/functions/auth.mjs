import {
  getAdminDataset,
  getAuthStatus,
  getRuntimeHealth,
  jsonResponse,
  loginManager,
  logoutManager,
  setupManagerPassword,
} from "../lib/auth-store.mjs";
import { getAdminCampaignConfig, saveAdminCampaignConfig } from "../lib/campaign-store.mjs";
import {
  getAdminSourceConfig,
  refreshAdminSource,
  saveAdminSourceConfig,
} from "../lib/source-store.mjs";

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
    const payload = await getRuntimeHealth();
    return jsonResponse(payload.ok ? 200 : 503, payload);
  }

  if (url.pathname === "/api/auth/status" && request.method === "GET") {
    const status = await getAuthStatus(request);
    return jsonResponse(200, {
      mode: "backend",
      ...status,
    });
  }

  if (url.pathname === "/api/admin/dataset" && request.method === "GET") {
    return getAdminDataset(request);
  }

  if (url.pathname === "/api/admin/source-config" && request.method === "GET") {
    return getAdminSourceConfig(request);
  }

  if (url.pathname === "/api/admin/campaign-config" && request.method === "GET") {
    return getAdminCampaignConfig(request);
  }

  if (url.pathname === "/api/admin/source-config" && request.method === "POST") {
    const payload = await readRequestPayload(request);
    return saveAdminSourceConfig(request, payload.config || {});
  }

  if (url.pathname === "/api/admin/campaign-config" && request.method === "POST") {
    const payload = await readRequestPayload(request);
    return saveAdminCampaignConfig(request, payload.config || {});
  }

  if (url.pathname === "/api/admin/source-refresh" && request.method === "POST") {
    return refreshAdminSource(request);
  }

  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    const payload = await readRequestPayload(request);
    return loginManager({
      email: payload.email,
      password: payload.password,
      request,
    });
  }

  if (url.pathname === "/api/auth/setup" && request.method === "POST") {
    const payload = await readRequestPayload(request);
    return setupManagerPassword({
      email: payload.email,
      password: payload.password,
      confirmPassword: payload.confirmPassword,
      request,
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
    "/api/admin/dataset",
    "/api/admin/campaign-config",
    "/api/admin/source-config",
    "/api/admin/source-refresh",
    "/api/auth/status",
    "/api/auth/login",
    "/api/auth/setup",
    "/api/auth/logout",
  ],
};
