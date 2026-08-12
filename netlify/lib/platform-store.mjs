import { getStore } from "@netlify/blobs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  } catch {}

  return { items: {} };
}

async function writeDevStore(devStorePath, store) {
  await mkdir(dirname(devStorePath), { recursive: true });
  await writeFile(devStorePath, JSON.stringify(store, null, 2), "utf8");
}

function createFileStore(devStorePath) {
  return {
    async getJSON(key) {
      const store = await readDevStore(devStorePath);
      return cloneJson(store.items[key] ?? null);
    },
    async setJSON(key, value) {
      const store = await readDevStore(devStorePath);
      store.items[key] = cloneJson(value);
      await writeDevStore(devStorePath, store);
    },
    async delete(key) {
      const store = await readDevStore(devStorePath);
      delete store.items[key];
      await writeDevStore(devStorePath, store);
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

export function createPlatformStore({ storeName, devStorePath }) {
  if (isNetlifyRuntime()) {
    return createBlobStore(storeName);
  }
  return createFileStore(devStorePath);
}
