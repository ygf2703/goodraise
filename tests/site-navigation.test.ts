import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getSitePage, mountSiteHeader, setSitePage, setSiteSession } from "../work/assets/site-header.js";
import { Header } from "../apps/web/src/components/Header";
import { mountAccountHome } from "../apps/web/src/account-home";
import { getProjectActionLabel, getProjectDestination } from "../apps/web/src/account-home";
import { CampaignNavigation } from "../apps/web/src/components/CampaignNavigation";
import { renderCampaignNavigation } from "../apps/web/src/campaign-navigation";

test("page identity distinguishes the project selector, management routes and campaign dashboard", () => {
  const cases: Record<string, string> = {
    "/": "home", "/goodraise/": "home", "/index.html": "home",
    "/login?returnTo=%2Fadmin": "login", "/admin": "projects", "/admin/": "projects",
    "/admin?organizationId=org&campaignId=campaign": "admin", "/admin?project=campaign": "admin",
    "/admin/users/": "users", "/admin/applications": "applications",
    "/project?organizationId=org&campaignId=campaign": "project", "/prizes": "prizes",
    "/campaign-name/ambassador": "project", "/?project=campaign": "project",
    "/campaigns": "campaigns", "/campaigns/org/campaign": "archive",
    "/start": "start", "/start/verify?token=example": "verify",
    "/rules": "rules", "/privacy": "privacy", "/accessibility": "accessibility",
    "/faq": "faq", "/contact": "contact",
    // Internal navigation keys are not reserved campaign slugs.
    "/users": "project", "/projects": "project", "/applications": "project",
  };
  for (const [path, expected] of Object.entries(cases)) assert.equal(getSitePage(`https://goodraise.example${path}`), expected, path);
});

class ElementStub extends EventTarget {
  hidden = false;
  textContent = "";
  className = "";
  checked = false;
  readOnly = false;
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  classes = new Set<string>();
  classList = {
    toggle: (name: string, enabled = !this.classes.has(name)) => {
      if (enabled) this.classes.add(name); else this.classes.delete(name);
      return enabled;
    },
    remove: (name: string) => { this.classes.delete(name); },
    contains: (name: string) => this.classes.has(name),
  };
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  replaceChildren() {}
  reset() {}
}

test("shared header marks only the current visible route and updates the browser title on in-app navigation", () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  const browser = Object.assign(new EventTarget(), {
    location: new URL("https://goodraise.example/admin"),
    matchMedia: () => new EventTarget(),
  });
  const document = { title: "" };
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  const links = [
    ["projects", "session"], ["users", "site-admin"],
    ["applications", "site-admin"], ["login", "guest"],
  ].map(([page, audience]) => Object.assign(new ElementStub(), { dataset: { sitePage: page, siteAudience: audience } }));
  const nodes = new Map([".site-header-toggle", ".site-header-nav", ".site-header-logout", ".site-header-error"].map(key => [key, new ElementStub()]));
  const header = Object.assign(new ElementStub(), {
    querySelector: (selector: string) => nodes.get(selector),
    querySelectorAll: () => links,
  });
  let dispose: (() => void) | undefined;
  try {
    setSiteSession(null);
    dispose = mountSiteHeader(header as unknown as HTMLElement, { loadSession: false });
    const current = () => links.filter(link => link.attributes.get("aria-current") === "page").map(link => link.dataset.sitePage);
    assert.deepEqual(current(), []);
    setSiteSession({ authenticated: true, email: "owner@example.org", permissions: { siteAdmin: true, analytics: true, campaignPages: true } });
    assert.deepEqual(current(), ["projects"], "The unscoped /admin link must not select the campaign dashboard");
    for (const [path, page, title] of [
      ["/admin/users", "users", "משתמשים והרשאות"],
      ["/admin/applications", "applications", "בקשות לפתיחת קמפיין"],
      ["/admin?organizationId=org&campaignId=campaign", "admin", "ניהול הקמפיין"],
      ["/project?campaignId=campaign", "project", "דף הקמפיין"],
      ["/prizes?campaignId=campaign", "prizes", "פרסים ותחרות"],
    ]) {
      browser.location = new URL(path, browser.location);
      setSitePage(page);
      assert.deepEqual(current(), ["admin", "project", "prizes"].includes(page) ? [] : [page]);
      assert.equal(document.title, `${title} | GoodRaise`);
    }
    browser.location = new URL("/admin", browser.location);
    browser.dispatchEvent(new Event("popstate"));
    assert.deepEqual(current(), ["projects"]);
    setSiteSession(null);
    assert.deepEqual(current(), [], "Hidden manager links must lose stale selection");
    browser.location = new URL("/login", browser.location);
    setSitePage("login");
    assert.deepEqual(current(), ["login"]);
  } finally {
    dispose?.();
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor); else Reflect.deleteProperty(globalThis, "window");
    if (documentDescriptor) Object.defineProperty(globalThis, "document", documentDescriptor); else Reflect.deleteProperty(globalThis, "document");
  }
});

test("the global header has only platform links; campaign links live in a hidden local navigation", () => {
  const html = renderToStaticMarkup(createElement(Header));
  for (const page of ["projects", "users", "applications"]) {
    assert.equal((html.match(new RegExp(`data-site-page="${page}"`, "g")) || []).length, 1, page);
  }
  assert.doesNotMatch(html, /data-page-target=|דשבורד ניהולי|ניהול הקמפיין|דף הפרויקט|פרסים ותחרות/);
  const local = renderToStaticMarkup(createElement(CampaignNavigation));
  assert.match(local, /<section[^>]*data-campaign-navigation[^>]*hidden/);
  for (const page of ["admin", "project", "prizes"]) assert.match(local, new RegExp(`<a data-page-target="${page}" hidden`));
  assert.match(local, /href="\/admin">חזרה לפרויקטים שלי/);
});

test("campaign navigation requires resolved access, preserves scope, and marks only the current local page", () => {
  const name = new ElementStub();
  const links = ["admin", "project", "prizes"].map(page => Object.assign(new ElementStub(), { dataset: { pageTarget: page } }));
  const navigation = Object.assign(new ElementStub(), { querySelector: () => name, querySelectorAll: () => links });
  const state = { authorized: true, canAnalyze: true, page: "admin", scope: { organizationId: "org-a", campaignId: "campaign-a" }, campaignName: "קמפיין א׳", ambassadorSlug: "דנה" };
  const render = (change = {}) => renderCampaignNavigation(navigation as unknown as HTMLElement, { ...state, ...change });
  render({ scope: {} });
  assert.equal(navigation.hidden, true);
  assert.ok(links.every(link => link.hidden && !link.attributes.has("href")));
  render();
  assert.equal(navigation.hidden, false);
  assert.equal(name.textContent, "קמפיין א׳");
  for (const link of links) {
    const destination = new URL(link.attributes.get("href")!, "https://goodraise.example");
    assert.equal(destination.pathname, `/${link.dataset.pageTarget}`);
    assert.equal(destination.searchParams.get("organizationId"), "org-a");
    assert.equal(destination.searchParams.get("campaignId"), "campaign-a");
    assert.equal(destination.searchParams.get("ambassador"), "דנה");
    assert.equal(link.attributes.has("aria-current"), link.dataset.pageTarget === "admin");
  }
  render({ page: "prizes", scope: { organizationId: "org-b", campaignId: "campaign-b" }, campaignName: "קמפיין ב׳" });
  assert.equal(name.textContent, "קמפיין ב׳");
  assert.ok(links.every(link => link.attributes.get("href")!.includes("campaignId=campaign-b")));
  assert.deepEqual(links.filter(link => link.attributes.has("aria-current")).map(link => link.dataset.pageTarget), ["prizes"]);
  render({ page: "project", canAnalyze: false });
  assert.equal(links[0].hidden, true, "Viewer must not see campaign management");
  assert.equal(links[0].attributes.has("href"), false);
  assert.equal(links[1].hidden, false);
  for (const change of [{ authorized: false }, { page: "rules" }, { page: "projects" }]) {
    render(change);
    assert.equal(navigation.hidden, true);
    assert.equal(name.textContent, "");
    assert.ok(links.every(link => link.hidden && !link.attributes.has("href") && !link.attributes.has("aria-current")));
  }
});

test("project cards describe the permitted destination, including analyst and completed viewer access", () => {
  const campaign = { organizationId: "org", campaignId: "one", status: "live" };
  for (const accessRole of ["platform_admin", "organization_admin", "campaign_manager"] as const) {
    assert.equal(getProjectActionLabel({ ...campaign, accessRole }), "ניהול הקמפיין");
    assert.equal(getProjectDestination({ ...campaign, accessRole }), "/admin?organizationId=org&campaignId=one");
  }
  assert.equal(getProjectActionLabel({ ...campaign, accessRole: "analyst" }), "צפייה בנתוני הקמפיין");
  assert.equal(getProjectActionLabel({ ...campaign, accessRole: "viewer" }), "צפייה בקמפיין");
  assert.equal(getProjectDestination({ ...campaign, accessRole: "viewer" }), "/project?organizationId=org&campaignId=one");
  assert.equal(getProjectActionLabel({ ...campaign, status: "completed", accessRole: "viewer" }), "צפייה בסיכום הקמפיין");
  assert.equal(getProjectDestination({ ...campaign, status: "completed", accessRole: "viewer" }), "/campaigns/org/one");
});

function accountRoot() {
  const nodes = new Map<string, ElementStub>();
  const get = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, new ElementStub());
    return nodes.get(id)!;
  };
  return { get, root: { querySelector: (selector: string) => get(selector.slice(1)) } as unknown as HTMLElement };
}

test("My projects never loads or displays account management, even for a site admin", (context) => {
  const fetch = context.mock.method(globalThis, "fetch", async () => Response.json({ users: [], organizations: [] }));
  const { get, root } = accountRoot();
  const abort = new AbortController();
  mountAccountHome(root, { authenticated: true, permissions: { manageUsers: true } }, abort.signal, "projects");
  assert.equal(get("account-home-title").textContent, "הפרויקטים שלי");
  assert.equal(get("account-active-projects").hidden, false);
  assert.equal(get("account-completed-projects").hidden, false);
  assert.equal(get("site-access-management").hidden, true);
  assert.equal(fetch.mock.callCount(), 0);
  abort.abort();
});

test("Users & permissions has its own heading, hides project lists and loads the account list", async (context) => {
  const fetch = context.mock.method(globalThis, "fetch", async () => Response.json({ users: [], organizations: [] }));
  const { get, root } = accountRoot();
  const abort = new AbortController();
  mountAccountHome(root, { authenticated: true, permissions: { manageUsers: true } }, abort.signal, "users");
  assert.equal(get("account-home-title").textContent, "משתמשים והרשאות");
  assert.equal(get("account-active-projects").hidden, true);
  assert.equal(get("account-completed-projects").hidden, true);
  assert.equal(get("site-access-management").hidden, false);
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(fetch.mock.calls[0].arguments[0], "/api/admin/accounts");
  // Let the asynchronous account rendering finish before checking its status.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(get("account-management-status").textContent, "");
  abort.abort();
});

test("a user without management permission cannot initialize the account editor", (context) => {
  const fetch = context.mock.method(globalThis, "fetch", async () => Response.json({}));
  const { get, root } = accountRoot();
  const abort = new AbortController();
  mountAccountHome(root, { authenticated: true, permissions: { manageUsers: false } }, abort.signal, "users");
  assert.equal(get("site-access-management").hidden, true);
  assert.equal(fetch.mock.callCount(), 0);
  abort.abort();
});
