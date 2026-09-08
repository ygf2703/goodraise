import assert from "node:assert/strict";
import test from "node:test";
import { getInitialPage, getCampaignRoute } from "../apps/web/src/platform";
import { migrateBrowserStorage } from "../apps/web/src/storage";
import { requestJson } from "../apps/web/src/api";
import { migrateStore } from "../backend/services/platform-store.mjs";
import { createPlatformStore } from "../backend/services/platform-store.mjs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSessionToken } from "../backend/services/auth-store.mjs";
import { parsePrizeTable } from "../scripts/prepare";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

test("direct public, legal and manager links retain their page after session restoration", () => {
  assert.equal(getInitialPage("/rules", true), "rules");
  assert.equal(getInitialPage("/privacy/"), "privacy");
  assert.equal(getInitialPage("/admin"), "admin");
  assert.equal(getInitialPage("/campaign/person", true), "project");
  assert.equal(getInitialPage("/", true), "admin");
  assert.deepEqual(getCampaignRoute("https://example.org/campaign-a/person-a"), { projectSlug: "campaign-a", ambassadorSlug: "person-a" });
  assert.deepEqual(getCampaignRoute("https://example.org/admin"), { projectSlug: "", ambassadorSlug: "" });
});

test("generic browser names preserve existing drafts and never overwrite newer values", () => {
  const storage = new MemoryStorage();
  storage.setItem("yellow-dashboard.goals", '{"total":1200}');
  storage.setItem("yellow-dashboard.prize-model", '{"placePrizes":[]}');
  storage.setItem("goodraise.goals", '{"total":3000}');
  migrateBrowserStorage(storage);
  migrateBrowserStorage(storage);
  assert.equal(storage.getItem("goodraise.goals"), '{"total":3000}');
  assert.equal(storage.getItem("goodraise.prize-model"), '{"placePrizes":[]}');
});

test("existing cookies remain readable while new cookies take precedence", () => {
  assert.equal(getSessionToken(new Request("http://localhost", { headers: { cookie: "yellow_dashboard_admin_session=legacy" } })), "legacy");
  assert.equal(getSessionToken(new Request("http://localhost", { headers: { cookie: "yellow_dashboard_admin_session=legacy; goodraise_admin_session=current" } })), "current");
});

test("auth store migration cannot resurrect a deleted legacy session", async () => {
  function store() {
    const items = new Map<string, unknown>();
    return {
      getJSON: async (key: string) => items.get(key) ?? null,
      setJSON: async (key: string, value: unknown) => { items.set(key, value); },
      listJSON: async () => [...items].map(([key, value]) => ({ key, value })),
    };
  }
  const old = store(), current = store();
  await old.setJSON("session:old", { email: "manager@example.org" });
  const migrated = migrateStore(current, old);
  assert.deepEqual(await migrated.getJSON("session:old"), { email: "manager@example.org" });
  await migrated.delete("session:old");
  assert.equal(await migrated.getJSON("session:old"), null);
  assert.deepEqual(await migrated.listJSON(), []);
});

test("concurrent local API writes retain every key and reject corrupt storage", async () => {
  const directory = await mkdtemp(join(tmpdir(), "goodraise-store-test-"));
  const path = join(directory, "store.json");
  try {
    const stores = Array.from({ length: 12 }, () => createPlatformStore({ storeName: "test", devStorePath: path }));
    await Promise.all(stores.map((store, index) => store.setJSON(`campaign:${index}`, { index })));
    assert.equal((await stores[0].listJSON()).length, 12);
    await writeFile(path, "{broken");
    await assert.rejects(stores[0].setJSON("new", {}));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Node prize preprocessing retains places, tiers and the single-prize rule", () => {
  const result = parsePrizeTable([["מקום 1", "ראשון"], ["מקום 2", "שני"], ["מדרגות פרס", ""], [500, "דרגה"], ["לא ניתן לקבל יותר מפרס אחד", ""]]);
  assert.deepEqual(result.placePrizes.map((item) => item.place), [1, 2]);
  assert.deepEqual(result.tierPrizes, [{ threshold: 500, prize: "דרגה" }]);
  assert.equal(result.tierRuleNote, "לא ניתן לקבל יותר מפרס אחד");
  assert.deepEqual(result.excludedAmbassadors, []);
});

test("typed API client sends same-origin session requests and reports malformed responses", async (context) => {
  let captured: RequestInit | undefined;
  context.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
    captured = options;
    return Response.json({ saved: true });
  });
  const { payload } = await requestJson<{ saved: boolean }>("/api/admin/source-config", { method: "POST", body: { config: { mode: "file" } } });
  assert.equal(payload.saved, true);
  assert.equal(captured?.credentials, "include");
  assert.equal(captured?.body, '{"config":{"mode":"file"}}');
  context.mock.method(globalThis, "fetch", async () => new Response("<html>Error</html>", { status: 502 }));
  await assert.rejects(requestJson("/api/auth/status"), /502/);
});
