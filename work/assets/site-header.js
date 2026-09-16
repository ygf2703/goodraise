import { setButtonBusy } from "./action-feedback.js";
import { beginPageBusy } from "./page-feedback.js";

let siteSession = null;
let logoutRequest = null;

const pageTitles = {
  home: "גודרייז",
  login: "כניסה לחשבון",
  projects: "הפרויקטים שלי",
  users: "משתמשים והרשאות",
  applications: "בקשות לפתיחת קמפיין",
  admin: "ניהול הקמפיין",
  project: "דף הקמפיין",
  prizes: "פרסים ותחרות",
  campaigns: "קמפיינים שהסתיימו",
  archive: "קמפיין שהסתיים",
  start: "פתיחת קמפיין",
  verify: "אימות בקשת קמפיין",
  rules: "תנאי שימוש",
  privacy: "מדיניות פרטיות",
  accessibility: "הצהרת נגישות",
  faq: "שאלות נפוצות",
  contact: "יצירת קשר",
};

export function getSitePage(address) {
  const url = new URL(address);
  const path = url.pathname.replace(/\/$/, "");
  if (path === "/admin/users") return "users";
  if (path === "/admin/applications") return "applications";
  if (path === "/admin") {
    return ["organizationId", "campaignId", "project"].some(key => url.searchParams.has(key)) ? "admin" : "projects";
  }
  if (path === "/start/verify") return "verify";
  if (path.startsWith("/campaigns/") && path.split("/").filter(Boolean).length === 3) return "archive";
  if (["", "/index.html", "/goodraise"].includes(path)) {
    return ["organizationId", "campaignId", "project", "ambassador", "nickname"].some(key => url.searchParams.has(key)) ? "project" : "home";
  }
  const page = path.slice(1);
  return ["login", "project", "prizes", "campaigns", "start", "rules", "privacy", "accessibility", "faq", "contact"].includes(page) ? page : "project";
}

/** Publish the page actually shown, including in-app campaign navigation. */
export function setSitePage(page) {
  if (!Object.hasOwn(pageTitles, page)) return;
  document.title = `${pageTitles[page]} | GoodRaise`;
  window.dispatchEvent(new CustomEvent("goodraise:page", { detail: page }));
}

// The server derives this capability from the current account's role.
export function canAccessManagerPages(session) {
  return Boolean(session?.authenticated && session?.email && session?.permissions?.campaignPages === true);
}

export function setSiteSession(session) {
  siteSession = session;
  window.dispatchEvent(new CustomEvent("goodraise:session", { detail: session }));
}

export function logoutSiteSession() {
  // The header and dashboard can both expose logout. Share their in-flight request.
  if (!logoutRequest) logoutRequest = (async () => {
    const endLoading = beginPageBusy("מתנתקים…");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error("ההתנתקות נכשלה. נסו שוב.");
      setSiteSession(null);
      window.location.assign("/");
    } catch (error) { endLoading(); throw error; }
  })().catch((error) => { logoutRequest = null; throw error; });
  return logoutRequest;
}

export function bindLogoutButton(button, { signal, onError, onStart = () => {} }) {
  let pending = false;
  button.addEventListener("click", async () => {
    if (pending) return;
    pending = true;
    setButtonBusy(button, true, "מתנתקים…", "התנתקות");
    onStart();
    try { await logoutSiteSession(); }
    catch (error) {
      if (signal.aborted) return;
      pending = false;
      setButtonBusy(button, false, "מתנתקים…", "התנתקות");
      onError(error);
    }
  }, { signal });
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

  function renderCurrentPage(page = getSitePage(window.location.href)) {
    header.querySelectorAll("[data-site-page]").forEach((link) => {
      const active = !link.hidden && link.dataset.sitePage === page;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }

  function renderSession(session) {
    const manager = canAccessManagerPages(session);
    const authenticated = Boolean(session?.authenticated && session?.email);
    const analyst = Boolean(authenticated && session?.permissions?.analytics === true);
    const siteAdmin = Boolean(authenticated && session?.permissions?.siteAdmin === true);
    header.querySelectorAll("[data-site-audience]").forEach((element) => {
      const audience = element.dataset.siteAudience;
      element.hidden = audience === "manager" ? !manager
        : audience === "analyst" ? !analyst
        : audience === "site-admin" ? !siteAdmin
          : audience === "session" ? !authenticated
            : audience === "public" ? manager
              : authenticated;
    });
    renderCurrentPage();
    closeMenu();
  }

  window.addEventListener("goodraise:session", (event) => renderSession(event.detail), options);
  window.addEventListener("goodraise:page", (event) => renderCurrentPage(event.detail), options);
  window.addEventListener("popstate", () => renderCurrentPage(), options);
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) window.location.reload();
  }, options);
  renderSession(siteSession);
  if (loadSession) {
    fetch("/api/auth/status?includeCampaigns=false", { credentials: "same-origin", cache: "no-store", signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Session unavailable");
        setSiteSession(await response.json());
      })
      .catch(() => { if (!abort.signal.aborted) setSiteSession(null); });
  }

  const logout = header.querySelector(".site-header-logout");
  const error = header.querySelector(".site-header-error");
  bindLogoutButton(logout, {
    signal: abort.signal,
    onStart: () => { error.hidden = true; },
    onError: () => {
      error.textContent = "ההתנתקות נכשלה. נסו שוב.";
      error.hidden = false;
    },
  });

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
