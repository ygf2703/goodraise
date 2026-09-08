import { getStore } from "@netlify/blobs";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

function cloneJson(value) {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

export function isNetlifyRuntime() {
  return Boolean(
    process.env.NETLIFY_LOCAL ||
      process.env.NETLIFY ||
      process.env.SITE_ID ||
      process.env.URL ||
      process.env.SITE_NAME,
  );
}

async function readDevStore(devStorePath) {
  try {
    const content = await readFile(devStorePath, "utf8");
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object" && parsed.items && typeof parsed.items === "object") {
      return parsed;
    }
    throw new Error(`Invalid development store: ${devStorePath}`);
  } catch (error) {
    if (error?.code === "ENOENT") return { items: {} };
    throw error;
  }
}

async function writeDevStore(devStorePath, store) {
  await mkdir(dirname(devStorePath), { recursive: true });
  const temporaryPath = `${devStorePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(store, null, 2), "utf8");
    await rename(temporaryPath, devStorePath);
  } finally { await rm(temporaryPath, { force: true }); }
}

// Serialize the entire read/modify/write operation per development file. Atomic
// replacement also ensures concurrent readers always see a complete JSON document.
const fileWrites = new Map();
function mutateFileStore(path, change) {
  const previous = fileWrites.get(path) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    const store = await readDevStore(path);
    change(store);
    await writeDevStore(path, store);
  });
  fileWrites.set(path, operation);
  void operation.finally(() => { if (fileWrites.get(path) === operation) fileWrites.delete(path); }).catch(() => {});
  return operation;
}

function createFileStore(devStorePath) {
  return {
    async getJSON(key) {
      const store = await readDevStore(devStorePath);
      return cloneJson(store.items[key] ?? null);
    },
    async setJSON(key, value) {
      await mutateFileStore(devStorePath, (store) => { store.items[key] = cloneJson(value); });
    },
    async delete(key) {
      await mutateFileStore(devStorePath, (store) => { delete store.items[key]; });
    },
    async listJSON(prefix = "") {
      const store = await readDevStore(devStorePath);
      return Object.entries(store.items)
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({ key, value: cloneJson(value) }));
    },
  };
}

function createBlobStore(storeName) {
  const store = getStore(storeName);
  return {
    async getJSON(key) {
      return (await store.get(key, { type: "json" })) ?? null;
    },
    async setJSON(key, value) {
      await store.setJSON(key, value);
    },
    async delete(key) {
      await store.delete(key);
    },
    async listJSON(prefix = "") {
      const items = [];
      let cursor;

      do {
        const page = await store.list(cursor ? { prefix, cursor } : { prefix });
        for (const blob of page.blobs || []) {
          const value = await store.get(blob.key, { type: "json" });
          if (value !== null) {
            items.push({ key: blob.key, value });
          }
        }
        cursor = page.cursor || undefined;
      } while (cursor);

      return items;
    },
  };
}

export function migrateStore(current, legacy) {
  const deleted = { __goodraiseDeleted: true };
  return {
    async getJSON(key) {
      const value = await current.getJSON(key);
      if (value?.__goodraiseDeleted === true) return null;
      if (value !== null) return value;
      const previous = await legacy.getJSON(key);
      if (previous !== null) await current.setJSON(key, previous);
      return previous;
    },
    setJSON: (key, value) => current.setJSON(key, value),
    // A tombstone prevents deleted legacy sessions from being copied back.
    delete: (key) => current.setJSON(key, deleted),
    async listJSON(prefix = "") {
      const merged = new Map((await legacy.listJSON(prefix)).map((item) => [item.key, item]));
      for (const item of await current.listJSON(prefix)) merged.set(item.key, item);
      return [...merged.values()].filter((item) => item.value?.__goodraiseDeleted !== true);
    },
  };
}

export function createPlatformStore({ storeName, devStorePath, legacyStoreName = "" }) {
  if (isNetlifyRuntime()) {
    const store = createBlobStore(storeName);
    return legacyStoreName ? migrateStore(store, createBlobStore(legacyStoreName)) : store;
  }
  return createFileStore(devStorePath);
}
