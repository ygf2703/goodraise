import { handleRequest } from '../../backend/app';

export default handleRequest;

export const config = {
  path: [
    "/api/health",
    "/api/public-context",
    "/api/auth/status",
    "/api/auth/login",
    "/api/auth/setup",
    "/api/auth/logout",
    "/api/auth/change-password",
    "/api/admin/dataset",
    "/api/admin/campaign-config",
    "/api/admin/source-config",
    "/api/admin/source-refresh",
    "/api/organizations/*",
  ],
};
