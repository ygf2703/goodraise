import dispatch from "./http-handler.mjs";
import { SourceConfigValidationError } from "./services/source-security.mjs";
import { LEGACY_SESSION_COOKIE_NAME } from "./services/legacy-compat.mjs";

/** The single application boundary used by the Node server and Netlify. */
export async function handleRequest(request: Request): Promise<Response> {
  const startedAt = performance.now();
  try {
    const response: Response = await dispatch(request);
    if (response.headers.getSetCookie().some((cookie) => cookie.startsWith("goodraise_admin_session="))) {
      const secure = process.env.NETLIFY || process.env.NETLIFY_LOCAL || new URL(request.url).protocol === "https:";
      // Login/logout replaces both browser cookie names; otherwise logout of a
      // new session could reveal an older still-valid cookie on the next request.
      response.headers.append("set-cookie", `${LEGACY_SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`);
    }
    response.headers.set("server-timing", `app;dur=${(performance.now() - startedAt).toFixed(1)}`);
    return response;
  } catch (error) {
    if (error instanceof SourceConfigValidationError) return Response.json({ message: error.message }, { status: 400 });
    console.error("api_request_failed", { path: new URL(request.url).pathname, error });
    return Response.json({ message: "שגיאת שרת. הפעולה לא הושלמה." }, { status: 500 });
  }
}
