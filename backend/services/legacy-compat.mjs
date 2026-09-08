// These names identify existing deployed data, not application or campaign names.
// Keep reads compatible until the corresponding data has been migrated.
export const LEGACY_AUTH_STORE_NAME = "yellow-dashboard-auth";
export const LEGACY_SESSION_COOKIE_NAME = "yellow_dashboard_admin_session";

export function readSetting(name) {
  return process.env[`GOODRAISE_${name}`] ?? process.env[`YELLOW_DASHBOARD_${name}`];
}
