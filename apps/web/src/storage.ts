/** Copy existing browser drafts once; never overwrite a newer GoodRaise value. */
export function migrateBrowserStorage(storage?: Storage): void {
  try {
    const target = storage ?? window.localStorage;
    const keys = Array.from({ length: target.length }, (_, index) => target.key(index));
    for (const key of keys) {
      if (!key?.startsWith("yellow-dashboard.")) continue;
      const newKey = key.replace("yellow-dashboard.", "goodraise.");
      const value = target.getItem(key);
      if (value !== null && target.getItem(newKey) === null) target.setItem(newKey, value);
    }
  } catch {
    // Browsers can disable draft storage. Server-backed campaign data still works.
  }
}
