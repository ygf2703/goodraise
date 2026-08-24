import { getPublicContext } from "../lib/auth-store.mjs";

// This route is intentionally separate from auth.mjs so the generic public-page
// rewrite can never turn a campaign-context request into the HTML app shell.
export default async () => getPublicContext();
