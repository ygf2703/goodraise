import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("dashboard template does not contain mojibake separators", async () => {
  const template = await readFile(new URL("../work/build_yellow_dashboard.py", import.meta.url), "utf8");
  assert.doesNotMatch(template, /Â|Ã/);
});
