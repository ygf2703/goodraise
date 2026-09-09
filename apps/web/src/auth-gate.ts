import { requestJson } from "./api";
import { authConfig, getInitialPage } from "./platform";
import { migrateBrowserStorage } from "./storage";
import { canAccessManagerPages, logoutSiteSession, setSiteSession } from "../../../work/assets/site-header.js";

export interface ManagerSession {
  authenticated: boolean;
  email?: string;
  permissions?: { campaignPages: boolean };
  message?: string;
  code?: string;
  setupRequired?: boolean;
}

export function requestSession(signal?: AbortSignal) {
  return requestJson<ManagerSession>(`${authConfig.statusEndpoint}?includeCampaigns=false`, {}, signal);
}

/** Bind the login form immediately; campaign code and data load only after authorization. */
export function mountAuthGate(root: HTMLElement, options: {
  signal: AbortSignal;
  sessionRequest: ReturnType<typeof requestSession>;
  onAuthenticated: (session: ManagerSession) => Promise<void>;
  onReady: () => void;
}) {
  const { signal } = options;
  const element = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const form = element<HTMLFormElement>("login-form");
  const email = element<HTMLInputElement>("login-email");
  const password = element<HTMLInputElement>("login-password");
  const confirmation = element<HTMLInputElement>("login-password-confirm");
  const button = element<HTMLButtonElement>("login-button");
  const message = element("login-message");
  let setup = false;
  let revision = 0;
  let busy = false;
  migrateBrowserStorage();
  try { email.value = localStorage.getItem("goodraise.last-admin-email") || ""; } catch { /* Optional remembered email. */ }

  const showMessage = (text: string, error = false) => {
    message.textContent = text;
    message.className = `login-message text-small${error ? " is-error" : ""}`;
  };
  const setSetup = (enabled: boolean) => {
    setup = enabled;
    for (const id of ["login-password-confirm-label", "login-password-confirm", "login-password-setup-note"]) {
      element(id).hidden = !enabled;
      element(id).style.display = enabled ? "" : "none";
    }
    confirmation.required = enabled;
    password.autocomplete = enabled ? "new-password" : "current-password";
    button.textContent = enabled ? "שמירת סיסמה וכניסה" : "כניסה לפאנל הניהול";
  };
  const currentPage = () => getInitialPage(window.location.pathname, true);
  const showShell = (session: ManagerSession | null) => {
    setSiteSession(session);
    const requested = currentPage();
    const page = requested === "rules" || requested === "privacy" ? requested : "admin";
    for (const section of root.querySelectorAll<HTMLElement>(".page-shell")) {
      section.classList.toggle("is-active", section.id === `page-${page}`);
    }
    element("session-status").textContent = session?.authenticated ? `מחובר/ת: ${session.email}` : "מצב ניהול: אורח/ת";
    element("logout-button").hidden = !session?.authenticated;
    if (session?.authenticated && !canAccessManagerPages(session)) {
      showMessage("אין לחשבון זה הרשאת מנהל. דף הפרויקט, הפרסים והניהול זמינים כרגע למנהלים בלבד.", true);
    }
    options.onReady();
  };
  const acceptSession = async (session: ManagerSession) => {
    if (signal.aborted) return;
    showShell(session);
    if (!canAccessManagerPages(session) || ["rules", "privacy"].includes(currentPage())) return;
    busy = true;
    button.disabled = true;
    showMessage("הכניסה הצליחה. טוענים את העמוד…");
    try { await options.onAuthenticated(session); }
    catch (error) {
      if (!signal.aborted) {
        options.onReady();
        showMessage(error instanceof Error ? error.message : "טעינת העמוד נכשלה. נסו שוב.", true);
      }
    } finally { busy = false; button.disabled = false; }
  };

  showShell(null);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    revision++;
    if (!email.value.trim() || !password.value) return showMessage("יש למלא גם מייל וגם סיסמה.", true);
    if (setup && (password.value.length < 8 || password.value !== confirmation.value)) {
      return showMessage("יש לבחור סיסמה באורך 8 תווים לפחות ולוודא שאימות הסיסמה תואם.", true);
    }
    busy = true;
    button.disabled = true;
    showMessage("מתחברים…");
    try {
      try { localStorage.setItem("goodraise.last-admin-email", email.value.trim()); } catch { /* Optional remembered email. */ }
      const { response, payload } = await requestJson<ManagerSession>(setup ? authConfig.setupEndpoint : authConfig.loginEndpoint, {
        method: "POST",
        body: { email: email.value.trim(), password: password.value, ...(setup ? { confirmPassword: confirmation.value } : {}) },
      }, signal);
      if (response.ok && payload.authenticated) {
        password.value = "";
        confirmation.value = "";
        setSetup(false);
        await acceptSession(payload);
      } else if (payload.code === "setup_required" || payload.setupRequired) {
        setSetup(true);
        showMessage(payload.message || "זו כניסה ראשונה. יש להגדיר סיסמה אישית.");
        confirmation.focus();
      } else showMessage(payload.message || "התחברות נכשלה.", true);
    } catch (error) {
      if (!signal.aborted) showMessage(error instanceof Error ? error.message : "שירות הניהול אינו זמין כרגע.", true);
    } finally { busy = false; button.disabled = false; }
  }, { signal });
  element("login-password-toggle").addEventListener("click", () => {
    password.type = password.type === "password" ? "text" : "password";
    confirmation.type = password.type;
    element("login-password-toggle").textContent = password.type === "password" ? "הצג" : "הסתר";
  }, { signal });
  element("logout-button").addEventListener("click", () => {
    void logoutSiteSession().catch(() => showMessage("ההתנתקות נכשלה. נסו שוב.", true));
  }, { signal });
  root.querySelector('.app-footer [data-page-target="rules"]')?.addEventListener("click", () => window.location.assign("/rules"), { signal });

  void options.sessionRequest.then(async ({ response, payload }) => {
    if (signal.aborted || revision) return;
    if (response.ok) await acceptSession(payload);
  }).catch(() => {
    if (!signal.aborted && !revision) showMessage("לא ניתן לבדוק את החיבור כרגע. אפשר לנסות להיכנס.", true);
  });
}
