import assert from "node:assert/strict";
import test from "node:test";
import { isLandingRequest } from "../shared/routes.mjs";
import rewriteHomepage from "../netlify/edge-functions/homepage";

test("the homepage and marketing alias show the landing page, including tracking links", () => {
  for (const path of ["/", "/index.html", "/index.html?utm_source=email", "/?utm_source=newsletter", "/goodraise", "/goodraise/", "/goodraise/index.html", "/goodraise/?utm_source=email"]) {
    assert.equal(isLandingRequest(new URL(path, "https://example.org")), true, path);
    const target = rewriteHomepage(new Request(new URL(path, "https://example.org")));
    assert.equal(target, undefined, "Public homepages should serve the static landing document directly.");
  }
});

test("campaign, ambassador, legal and admin links retain the application", () => {
  for (const path of ["/admin", "/project", "/rules", "/privacy", "/prizes", "/app.html", "/campaign", "/campaign/person", "/?project=campaign", "/?ambassador=person", "/?nickname=person", "/?project=campaign&ambassador=person&utm_source=email", "/index.html?project=campaign&nickname=person&utm_source=email"]) {
    assert.equal(isLandingRequest(new URL(path, "https://example.org")), false, path);
    if (path.startsWith("/?") || path.startsWith("/index.html?")) {
      const target = rewriteHomepage(new Request(new URL(path, "https://example.org")));
      assert.ok(target);
      assert.equal(target.pathname, "/app.html");
      assert.equal(target.search, new URL(path, "https://example.org").search);
    }
  }
});
