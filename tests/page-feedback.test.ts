import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { beginPageBusy, isPageBusy, navigateSite } from "../work/assets/page-feedback.js";
import { isAppDestination, shouldHandleLink } from "../apps/web/src/client-navigation";

class NodeStub {
  id = "";
  className = "";
  textContent = "";
  inert = false;
  isConnected = true;
  children: NodeStub[] = [];
  attributes = new Map<string, string>();
  classes = new Set<string>();
  focusCount = 0;
  parent: NodeStub | null = null;
  classList = { add: (name: string) => this.classes.add(name), remove: (name: string) => this.classes.delete(name) };
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  focus() { this.focusCount++; }
  append(...children: NodeStub[]) { children.forEach(child => { child.parent = this; this.children.push(child); }); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.isConnected = false; }
  querySelector(selector: string): NodeStub | null {
    for (const child of this.children) {
      if (child.className === selector.slice(1)) return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }
}

test("one fixed overlay remains until all operations finish, locks background and restores focus without replacing page content", context => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  const body = new NodeStub(), page = new NodeStub(), html = new NodeStub(), focused = new NodeStub();
  page.textContent = "The current page stays here";
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    body, documentElement: html, activeElement: focused,
    getElementById: (id: string) => id === "app" ? page : body.children.find(child => child.id === id),
    createElement: () => new NodeStub(),
  } });
  context.after(() => { if (original) Object.defineProperty(globalThis, "document", original); else Reflect.deleteProperty(globalThis, "document"); });
  const endRoute = beginPageBusy("טוענים עמוד…");
  const endData = beginPageBusy("טוענים נתונים…");
  try {
    assert.equal(body.children.length, 1);
    assert.equal(body.children[0].attributes.get("role"), "status");
    assert.equal(body.children[0].querySelector(".page-loading-label")?.textContent, "טוענים נתונים…");
    assert.equal(page.inert, true);
    assert.equal(page.textContent, "The current page stays here");
    endData(); endData();
    assert.equal(isPageBusy(), true);
    assert.equal(body.children[0].querySelector(".page-loading-label")?.textContent, "טוענים עמוד…");
    endRoute();
    assert.equal(isPageBusy(), false);
    assert.equal(body.children.length, 0);
    assert.equal(page.inert, false);
    assert.equal(focused.focusCount, 1);
    assert.equal(html.classes.has("page-is-loading"), false);
  } finally { endData(); endRoute(); }
});

test("client navigation only owns app routes, retaining external, public-site, fragment and new-tab behavior", () => {
  const origin = "https://goodraise.example";
  for (const path of ["/admin", "/admin/users", "/admin/applications", "/project?campaignId=one", "/prizes", "/login", "/campaign/ambassador"]) assert.equal(isAppDestination(path, origin), true, path);
  for (const path of ["/", "/faq", "/contact", "/rules", "/privacy", "/accessibility", "/campaigns", "/campaigns/org/one", "/start", "/assets/image.png", "https://elsewhere.example/admin"]) assert.equal(isAppDestination(path, origin), false, path);
  const event = { defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
  const link = { href: `${origin}/admin/users`, target: "", hasAttribute: () => false } as unknown as HTMLAnchorElement;
  assert.equal(shouldHandleLink(event, link, `${origin}/admin`), true);
  for (const change of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }]) assert.equal(shouldHandleLink({ ...event, ...change }, link, `${origin}/admin`), false);
  assert.equal(shouldHandleLink(event, { ...link, target: "_blank" } as HTMLAnchorElement, `${origin}/admin`), false);
  assert.equal(shouldHandleLink(event, { ...link, hasAttribute: () => true } as HTMLAnchorElement, `${origin}/admin`), false);
  assert.equal(shouldHandleLink(event, { ...link, href: `${origin}/admin#main` } as HTMLAnchorElement, `${origin}/admin`), false);
});

test("programmatic redirects use the app router when available and keep the native fallback", context => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  const destinations: string[] = [];
  const browser = Object.assign(new EventTarget(), { location: { replace: (path: string) => destinations.push(path), assign: (path: string) => destinations.push(path) } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  context.after(() => { if (original) Object.defineProperty(globalThis, "window", original); else Reflect.deleteProperty(globalThis, "window"); });
  navigateSite("/login", { replace: true });
  assert.deepEqual(destinations, ["/login"]);
  browser.addEventListener("goodraise:navigate", event => event.preventDefault());
  navigateSite("/admin");
  assert.deepEqual(destinations, ["/login"]);
});

test("overlay styling is out of document flow and supports narrow screens and reduced motion", async () => {
  const css = await readFile(new URL("../work/assets/page-feedback.css", import.meta.url), "utf8");
  assert.match(css, /position: fixed/);
  assert.match(css, /inset: 0/);
  assert.match(css, /scrollbar-gutter: stable/);
  assert.match(css, /width: min\(360px, 100%\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /animation: none/);
});
