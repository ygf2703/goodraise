import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mountAuthGate } from "../apps/web/src/auth-gate";
import { mountProjectNavigation } from "../apps/web/src/project-navigation";
import { bindLogoutButton } from "../work/assets/site-header.js";
import { mountAccountHome } from "../apps/web/src/account-home";

class ElementStub extends EventTarget {
  textContent = "";
  value = "";
  disabled = false;
  hidden = false;
  required = false;
  type = "password";
  autocomplete = "";
  target = "";
  className = "";
  id = "";
  style = { display: "" };
  attributes = new Map<string, string>();
  children: ElementStub[] = [];
  classes = new Set<string>();
  classList = {
    add: (name: string) => this.classes.add(name),
    remove: (name: string) => this.classes.delete(name),
    toggle: (name: string, enabled: boolean) => enabled ? this.classes.add(name) : this.classes.delete(name),
  };
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  replaceChildren() { this.children = []; }
  append(...children: ElementStub[]) { this.children.push(...children); }
  querySelector(selector: string) {
    return this.children.find(child => selector === "h3" ? child.id === "h3" : child.className.split(" ").includes(selector.slice(1))) || null;
  }
  focus() {}
  reset() {}
  querySelectorAll() { return []; }
}

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function environment(context: TestContext) {
  const destinations: string[] = [];
  const location = Object.assign(new URL("https://goodraise.example/login"), {
    replace: (path: string) => destinations.push(path), assign: (path: string) => destinations.push(path),
  });
  const browser = Object.assign(new EventTarget(), { location, history: { replaceState() {} } });
  for (const [name, value] of Object.entries({ window: browser, document: { title: "" }, localStorage: { getItem: () => null, setItem() {} } })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    context.after(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
  }
  return { browser, destinations };
}
function authRoot() {
  const nodes = new Map<string, ElementStub>();
  const get = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, Object.assign(new ElementStub(), { id }));
    return nodes.get(id)!;
  };
  return { get, root: { querySelector: (selector: string) => get(selector.slice(1)), querySelectorAll: () => [] } as unknown as HTMLElement };
}
function click(element: ElementStub, modifiers = {}) {
  const event = Object.assign(new Event("click", { cancelable: true }), { button: 0, ...modifiers });
  element.dispatchEvent(event);
  return event;
}

test("login stays visibly pending, prevents repeats, recovers after rejection and retains pending across redirect", async context => {
  const { destinations } = environment(context);
  const replies: ReturnType<typeof deferred<Response>>[] = [];
  context.mock.method(globalThis, "fetch", () => { const reply = deferred<Response>(); replies.push(reply); return reply.promise; });
  const { root, get } = authRoot();
  const abort = new AbortController();
  context.after(() => abort.abort());
  mountAuthGate(root, { signal: abort.signal, sessionRequest: new Promise(() => {}), onReady() {}, onAuthenticated: async () => {} });
  get("login-email").value = "approved@example.org";
  get("login-password").value = "test-password";
  const submit = () => get("login-form").dispatchEvent(new Event("submit", { cancelable: true }));
  submit(); submit();
  assert.equal(replies.length, 1);
  assert.equal(get("login-button").disabled, true);
  assert.equal(get("login-button").attributes.get("aria-busy"), "true");
  assert.equal(get("login-button").textContent, "מתחברים…");
  replies[0].resolve(Response.json({ message: "סיסמה שגויה" }, { status: 401 }));
  await tick();
  assert.equal(get("login-button").disabled, false);
  assert.equal(get("login-button").textContent, "כניסה לחשבון");
  assert.equal(get("login-message").textContent, "סיסמה שגויה");
  submit();
  replies[1].resolve(Response.json({ code: "setup_required" }, { status: 409 }));
  await tick();
  assert.equal(get("login-button").textContent, "שמירת סיסמה וכניסה");
  get("login-password-confirm").value = "test-password";
  submit();
  assert.equal(get("login-button").textContent, "שומרים ומתחברים…");
  replies[2].resolve(Response.json({ authenticated: true, email: "approved@example.org", accessibleCampaigns: [{ organizationId: "org", campaignId: "one", accessRole: "viewer" }] }));
  await tick();
  assert.deepEqual(destinations, ["/project?organizationId=org&campaignId=one"]);
  assert.equal(get("login-button").textContent, "פותחים את העמוד…");
  assert.equal(get("login-button").disabled, true, "finally must not unlock before navigation finishes");
  submit();
  assert.equal(replies.length, 3);
});

test("login keeps its spinner through portfolio loading and clears it after the selector opens", async context => {
  environment(context);
  const portfolio = deferred<Response>();
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => ++calls === 1
    ? Response.json({ authenticated: true, email: "owner@example.org" }) : portfolio.promise);
  const { root, get } = authRoot();
  const abort = new AbortController();
  context.after(() => abort.abort());
  mountAuthGate(root, { signal: abort.signal, sessionRequest: new Promise(() => {}), onReady() {}, onAuthenticated: async () => {} });
  get("login-email").value = "owner@example.org";
  get("login-password").value = "test-password";
  get("login-form").dispatchEvent(new Event("submit", { cancelable: true }));
  await tick();
  assert.equal(calls, 2);
  assert.equal(get("login-button").textContent, "טוענים פרויקטים…");
  assert.equal(get("login-button").disabled, true);
  portfolio.resolve(Response.json({ authenticated: true, email: "owner@example.org", permissions: { siteAdmin: true }, accessibleCampaigns: [] }));
  await tick();
  assert.equal(get("account-home").hidden, false);
  assert.equal(get("login-button").attributes.get("aria-busy"), "false");
});

test("explicit My Projects navigation shows the selector even for a single-project user", async context => {
  const { browser, destinations } = environment(context);
  browser.location.pathname = "/admin";
  Object.assign(document, { createElement: (tag: string) => Object.assign(new ElementStub(), { id: tag }) });
  const { root, get } = authRoot();
  const abort = new AbortController();
  let ready = false;
  const dispose = mountAuthGate(root, {
    signal: abort.signal,
    sessionRequest: Promise.resolve({ response: Response.json({}), payload: {
      authenticated: true, email: "manager@example.org", permissions: { campaignPages: true },
      accessibleCampaigns: [{ organizationId: "org", campaignId: "one", campaignName: "One", accessRole: "campaign_manager" }],
    } }),
    onReady: () => { ready = true; },
    onAuthenticated: async () => { assert.fail("Explicit portfolio navigation must not boot a campaign"); },
  });
  context.after(() => { abort.abort(); dispose(); });
  await tick();
  assert.equal(ready, true);
  assert.deepEqual(destinations, []);
  assert.equal(get("account-home").hidden, false);
  assert.equal(get("account-home-title").textContent, "הפרויקטים שלי");
  assert.equal(get("active-projects-list").children.length, 1);
  const action = get("active-projects-list").children[0].children.find(child => child.className.includes("account-project-action"));
  assert.equal(action?.textContent, "ניהול הקמפיין");
});

test("logout shows pending on both surfaces, shares requests, restores retry after failure and stays pending on success", async context => {
  const { destinations } = environment(context);
  const replies: ReturnType<typeof deferred<Response>>[] = [];
  context.mock.method(globalThis, "fetch", () => { const reply = deferred<Response>(); replies.push(reply); return reply.promise; });
  const buttons = [new ElementStub(), new ElementStub()];
  const abort = new AbortController();
  context.after(() => abort.abort());
  let errors = 0;
  buttons.forEach(button => bindLogoutButton(button, { signal: abort.signal, onError: () => errors++ }));
  click(buttons[0]); click(buttons[0]); click(buttons[1]);
  assert.equal(replies.length, 1);
  buttons.forEach(button => {
    assert.equal(button.disabled, true);
    assert.equal(button.textContent, "מתנתקים…");
    assert.equal(button.attributes.get("aria-busy"), "true");
  });
  replies[0].resolve(Response.json({}, { status: 503 }));
  await tick();
  assert.equal(errors, 2);
  buttons.forEach(button => { assert.equal(button.disabled, false); assert.equal(button.textContent, "התנתקות"); });
  click(buttons[1]); click(buttons[0]);
  assert.equal(replies.length, 2);
  replies[1].resolve(Response.json({ ok: true }));
  await tick();
  assert.deepEqual(destinations, ["/"]);
  assert.equal(buttons[0].disabled, true);
});

test("project cards show pending, block repeated same-tab navigation, preserve new tabs and reset on Back/disposal", context => {
  const { browser } = environment(context);
  const labels = [new ElementStub(), new ElementStub()];
  labels.forEach(label => { label.textContent = "פעיל"; });
  const cards = labels.map((label, index) => Object.assign(new ElementStub(), {
    querySelector: (selector: string) => selector === "h3" ? { textContent: `Project ${index}` } : label,
  }));
  const status = new ElementStub();
  const abort = new AbortController();
  mountProjectNavigation(cards as unknown as HTMLAnchorElement[], status as unknown as HTMLElement, abort.signal);
  for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
    assert.equal(click(cards[0], modifier).defaultPrevented, false);
    assert.equal(cards[0].attributes.has("aria-busy"), false);
  }
  assert.equal(click(cards[0]).defaultPrevented, false);
  assert.equal(labels[0].textContent, "פותחים פרויקט…");
  assert.ok(labels[0].classes.has("gr-loading-indicator"));
  assert.equal(status.textContent, "פותחים את Project 0…");
  assert.equal(click(cards[0]).defaultPrevented, true);
  assert.equal(click(cards[1]).defaultPrevented, true);
  assert.equal(click(cards[1], { metaKey: true }).defaultPrevented, false);
  browser.dispatchEvent(new Event("pageshow"));
  assert.equal(labels[0].textContent, "פעיל");
  assert.equal(status.textContent, "");
  assert.equal(cards[1].attributes.has("aria-disabled"), false);
  assert.equal(click(cards[1]).defaultPrevented, false);
  abort.abort();
  assert.equal(cards[1].attributes.has("aria-busy"), false);
  assert.equal(click(cards[0]).defaultPrevented, false);
});

test("account saving blocks duplicate submits and reports a successful write separately from a failed list refresh", async context => {
  environment(context);
  const replies: ReturnType<typeof deferred<Response>>[] = [];
  context.mock.method(globalThis, "fetch", () => { const reply = deferred<Response>(); replies.push(reply); return reply.promise; });
  const { root, get } = authRoot();
  const abort = new AbortController();
  context.after(() => abort.abort());
  let ready = false;
  mountAccountHome(root, { authenticated: true, permissions: { manageUsers: true } }, abort.signal, "users", () => { ready = true; });
  assert.equal(ready, false, "The route must wait for its users list before replacing the previous page");
  replies[0].resolve(Response.json({ users: [], organizations: [] }));
  await tick();
  assert.equal(ready, true);
  get("managed-account-email").value = "approved@example.org";
  const reset = context.mock.method(get("managed-account-form"), "reset");
  const submit = () => get("managed-account-form").dispatchEvent(new Event("submit", { cancelable: true }));
  submit(); submit();
  click(get("new-account-button")); click(get("cancel-managed-account"));
  assert.equal(replies.length, 2);
  assert.equal(reset.mock.callCount(), 0);
  assert.equal(get("save-managed-account").textContent, "שומרים…");
  replies[1].resolve(Response.json({ message: "נשמר" }));
  await tick();
  assert.equal(replies.length, 3);
  replies[2].resolve(Response.json({ message: "Temporary failure" }, { status: 503 }));
  await tick();
  assert.match(get("account-management-status").textContent, /המשתמש נשמר, אך רענון הרשימה נכשל/);
  assert.equal(get("save-managed-account").disabled, false);
  assert.equal(get("managed-account-email").value, "approved@example.org");
  submit();
  replies[3].resolve(Response.json({ message: "לא ניתן לשמור" }, { status: 503 }));
  await tick();
  assert.equal(get("account-management-status").textContent, "לא ניתן לשמור");
  assert.equal(get("managed-account-email").value, "approved@example.org");
  assert.equal(get("save-managed-account").disabled, false);
});
