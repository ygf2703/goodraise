import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApplicationRouter } from "../apps/web/src/ApplicationRouter";
import type { AppProps } from "../apps/web/src/App";
import { SiteFooter } from "../apps/web/src/components/SiteFooter";
import { getCampaignRoute, getPublicHelpRoute } from "../apps/web/src/platform";
import { isLandingRequest } from "../shared/routes.mjs";

test("FAQ and contact are public routes, never campaign slugs", () => {
  for (const page of ["faq", "contact"] as const) {
    for (const suffix of ["", "/"]) {
      assert.equal(getPublicHelpRoute(`/${page}${suffix}`), page);
      assert.equal(getCampaignRoute(`https://goodraise.example/${page}${suffix}`).projectSlug, "");
      assert.equal(isLandingRequest(new URL(`https://goodraise.example/${page}${suffix}`)), false);
    }
  }
  assert.equal(getPublicHelpRoute("/campaign"), null);
  assert.equal(getPublicHelpRoute("/contact/other"), null);
});

test("public help uses the shared footer, accessible FAQ and labelled contact fields", () => {
  const footer = renderToStaticMarkup(createElement(SiteFooter));
  assert.match(footer, /href="\/faq"/);
  assert.match(footer, /href="\/contact"/);
  assert.doesNotMatch(footer, /שותפים לדרך|placeholder|<dialog/);
  for (const route of ["faq", "contact"] as const) {
    const html = renderToStaticMarkup(createElement<AppProps>(ApplicationRouter, { helpRoute: route }));
    assert.equal((html.match(/<h1>/g) || []).length, 1);
    assert.match(html, /<main id="main"[^>]*tabindex="-1"/);
    assert.ok(html.includes(footer.replace(/^<link[^>]+\/>/, "")), "Shared footer rendered on help pages");
    assert.doesNotMatch(html, /login-form|data-placeholder/);
    if (route === "faq") {
      assert.equal((html.match(/<details>/g) || []).length, 10);
      assert.equal((html.match(/<summary>/g) || []).length, 10);
      assert.match(html, /תורמים ייחודיים/);
      assert.match(html, /אינו מפרסם את הקמפיין או מתחיל גבייה/);
    } else {
      for (const id of ["name", "email", "topic", "message", "consent"]) assert.match(html, new RegExp(`for="contact-${id}"`));
      assert.match(html, /type="email"/);
      assert.match(html, /maxlength="4000"/i);
      assert.match(html, /type="checkbox" required=""/);
    }
  }
});

test("Netlify exposes help routes and contact API; static carousel has no stale dialog code", async () => {
  const config = await readFile(new URL("../netlify.toml", import.meta.url), "utf8");
  for (const page of ["faq", "contact"]) assert.match(config, new RegExp(`from = "/${page}"\\s+to = "/app.html"`));
  assert.match(await readFile(new URL("../netlify/functions/auth.ts", import.meta.url), "utf8"), /"\/api\/contact"/);
  const landing = await readFile(new URL("../work/goodraise-landing.html", import.meta.url), "utf8");
  assert.doesNotMatch(landing, /placeholder-dialog|data-placeholder|שותפים לדרך/);
  assert.match(landing, /campaign-carousel/);
});

test("the homepage introduction links to the contact form, while How it works stays a homepage section", async () => {
  const landing = await readFile(new URL("../work/goodraise-landing.html", import.meta.url), "utf8");
  const homepage = renderToStaticMarkup(createElement<AppProps>(ApplicationRouter, { landingRoute: true }));
  for (const html of [landing, homepage]) {
    assert.match(html, /<a\b[^>]*href="\/contact"[^>]*>בואו נכיר\s/);
    assert.match(html, /<section\b[^>]*id="how-it-works"/);
  }
  const footer = renderToStaticMarkup(createElement(SiteFooter));
  assert.match(footer, /href="\/#how-it-works">איך זה עובד<\/a>/);
});

test("How it works explains email verification, review and conditional draft access without promising automatic launch", async () => {
  const landing = await readFile(new URL("../work/goodraise-landing.html", import.meta.url), "utf8");
  const homepage = renderToStaticMarkup(createElement<AppProps>(ApplicationRouter, { landingRoute: true }));
  for (const html of [landing, homepage]) {
    const section = html.match(/<section\b[^>]*id="how-it-works"[\s\S]*?<\/section>/)?.[0] || "";
    assert.equal((section.match(/<article class="step">/g) || []).length, 3);
    assert.match(section, /שולחים בקשה ומאמתים אימייל/);
    assert.match(section, /אפשר להגיש בקשה גם בלי חשבון/);
    assert.match(section, /לאחר אימות האימייל הבקשה עוברת לבדיקת הצוות, שמחליט אם לאשר אותה/);
    assert.match(section, /אם הבקשה מאושרת, נוצר קמפיין במצב טיוטה/);
    assert.match(section, /האישור אינו מפרסם את הקמפיין או מפעיל גביית תשלומים/);
  }
});
