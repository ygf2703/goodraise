let siteSession = null;

// The server derives this capability from the current account's role.
export function canAccessManagerPages(session) {
  return Boolean(session?.authenticated && session?.email && session?.permissions?.campaignPages === true);
}

export function setSiteSession(session) {
  siteSession = session;
  window.dispatchEvent(new CustomEvent("goodraise:session", { detail: session }));
}

export async function logoutSiteSession() {
  const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  if (!response.ok) throw new Error("ההתנתקות נכשלה. נסו שוב.");
  setSiteSession(null);
  window.location.assign("/");
}

/** Shared session-aware navigation for the static homepage and React application.
 * @param {HTMLElement} header
 */
export function mountSiteHeader(header, { loadSession = true } = {}) {
  const toggle = header.querySelector(".site-header-toggle");
  const menu = header.querySelector(".site-header-nav");
  const abort = new AbortController();
  const options = { signal: abort.signal };
  const breakpoint = window.matchMedia("(max-width: 800px)");

  function renderSession(session) {
    const manager = canAccessManagerPages(session);
    const authenticated = Boolean(session?.authenticated && session?.email);
    header.querySelectorAll("[data-site-audience]").forEach((element) => {
      const audience = element.dataset.siteAudience;
      element.hidden = audience === "manager" ? !manager : audience === "session" ? !authenticated : audience === "public" ? manager : authenticated;
    });
    closeMenu();
  }

  window.addEventListener("goodraise:session", (event) => renderSession(event.detail), options);
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) window.location.reload();
  }, options);
  renderSession(siteSession);
  if (loadSession) {
    fetch("/api/auth/status", { credentials: "same-origin", cache: "no-store", signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Session unavailable");
        setSiteSession(await response.json());
      })
      .catch(() => { if (!abort.signal.aborted) setSiteSession(null); });
  }

  const logout = header.querySelector(".site-header-logout");
  const error = header.querySelector(".site-header-error");
  logout.addEventListener("click", async () => {
    logout.disabled = true;
    error.hidden = true;
    try { await logoutSiteSession(); }
    catch (_error) {
      error.textContent = "ההתנתקות נכשלה. נסו שוב.";
      error.hidden = false;
      logout.disabled = false;
    }
  }, options);

  function closeMenu() {
    menu.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "פתיחת תפריט");
  }

  toggle.addEventListener("click", () => {
    const open = menu.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "סגירת תפריט" : "פתיחת תפריט");
  }, options);
  menu.addEventListener("click", (event) => {
    if (event.target.closest("a")) closeMenu();
  }, options);
  header.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu.classList.contains("is-open")) {
      closeMenu();
      toggle.focus();
    }
  }, options);
  breakpoint.addEventListener("change", closeMenu, options);

  return () => { abort.abort(); closeMenu(); };
}
