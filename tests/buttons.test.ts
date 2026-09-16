import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button, ButtonLink, type ButtonVariant } from "../apps/web/src/components/Button";
import { PublicHelpPage } from "../apps/web/src/components/HelpPages";

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("buttons and navigation links share all four variants and three sizes", () => {
  for (const variant of ["primary", "secondary", "ghost", "danger"] as ButtonVariant[]) {
    for (const size of ["sm", "md", "lg"] as const) {
      for (const html of [
        renderToStaticMarkup(createElement(Button, { variant, size }, "Action")),
        renderToStaticMarkup(createElement(ButtonLink, { variant, size, href: "/contact" }, "Action")),
      ]) assert.match(html, new RegExp(`class="gr-button gr-button--${variant} gr-button--${size}"`));
    }
  }
  assert.match(renderToStaticMarkup(createElement(Button, {}, "Cancel")), /type="button"/);
  assert.match(renderToStaticMarkup(createElement(Button, { type: "submit" }, "Send")), /type="submit"/);
  const link = renderToStaticMarkup(createElement(ButtonLink, { href: "/contact", target: "_blank" }, "Contact"));
  assert.match(link, /<a /);
  assert.match(link, /href="\/contact"/);
  assert.match(link, /target="_blank"/);
});

test("disabled, busy, hidden, ref-compatible native props and icon labels are preserved", () => {
  const busy = renderToStaticMarkup(createElement(Button, { busy: true, id: "save", "aria-controls": "result" }, "Saving"));
  assert.match(busy, /disabled=""/);
  assert.match(busy, /aria-busy="true"/);
  assert.match(busy, /id="save"/);
  assert.match(busy, /aria-controls="result"/);
  assert.match(renderToStaticMarkup(createElement(Button, { disabled: true }, "Unavailable")), /disabled=""/);
  const disabledLink = renderToStaticMarkup(createElement(ButtonLink, { href: "/contact", disabled: true }, "Contact"));
  assert.doesNotMatch(disabledLink, /href=/);
  assert.match(disabledLink, /role="link"/);
  assert.match(disabledLink, /aria-disabled="true"/);
  assert.match(disabledLink, /tabindex="-1"/);
  const icon = renderToStaticMarkup(createElement(Button, { icon: true, hidden: true, "aria-label": "Next" }, "→"));
  assert.match(icon, /gr-button--icon/);
  assert.match(icon, /aria-label="Next"/);
  assert.match(icon, /hidden=""/);
});

test("FAQ CTA uses the shared link component and prose styles cannot recolor it", async () => {
  const html = renderToStaticMarkup(createElement(PublicHelpPage, { route: "faq" }));
  assert.match(html, /href="\/contact" class="gr-button gr-button--primary gr-button--lg">בואו נדבר/);
  assert.doesNotMatch(html, /help-button/);
  const css = await source("apps/web/src/styles/help.css");
  assert.match(css, /\.help-main a:not\(\.gr-button\)\s*\{/);
  assert.doesNotMatch(css, /\.help-main a\s*\{/);
  assert.doesNotMatch(css, /\.help-button/);
  assert.match(await source("work/assets/site-header.css"), /\.site-header a:not\(\.gr-button\)\s*\{/);
});

test("one shared stylesheet supplies static, React and legacy action-button appearance", async () => {
  const css = await source("work/assets/buttons.css");
  for (const alias of ["button-primary", "button-secondary", "button-ghost", "action-button"]) assert.ok(css.includes(`.${alias}`));
  assert.match(css, /:focus-visible/);
  assert.match(css, /:disabled/);
  assert.match(css, /\[hidden\] \{ display: none !important; \}/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /forced-colors/);
  assert.match(css, /\[aria-busy="true"\]::before/);
  assert.match(css, /animation: gr-action-spin/);
  assert.match(css, /\.gr-loading-indicator::before \{ animation: none; \}/);
  for (const shell of ["apps/web/index.html", "work/goodraise-landing.html"]) assert.match(await source(shell), /href="\/assets\/buttons\.css"/);
  const dashboard = await source("apps/web/src/styles/dashboard.css");
  assert.doesNotMatch(dashboard, /#goodraise-root \.(?:button-primary|button-secondary|button-ghost|action-button)(?:[:.,\s{])/);
  assert.doesNotMatch(dashboard, /\.admin-application-review \.(approve|reject)\s*\{/);
});

function contrast(first: string, second: string) {
  const luminance = (hex: string) => {
    const rgb = hex.match(/[a-f\d]{2}/gi)!.map((pair) => parseInt(pair, 16) / 255)
      .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const values = [luminance(first), luminance(second)].sort((a, b) => a - b);
  return (values[1] + 0.05) / (values[0] + 0.05);
}

test("shared enabled button palettes meet 4.5:1 text contrast in normal, hover and active states", async () => {
  const css = await source("work/assets/buttons.css");
  const tokens = Object.fromEntries([...css.matchAll(/--gr-action-([\w-]+):\s*(#[a-f\d]{6})/gi)].map((match) => [match[1], match[2]]));
  for (const background of ["primary", "primary-hover", "primary-active"]) assert.ok(contrast("#ffffff", tokens[background]) >= 4.5, background);
  for (const background of ["surface", "hover-surface", "active-surface"]) assert.ok(contrast(tokens.ink, tokens[background]) >= 4.5, background);
  for (const background of ["surface", "danger-hover", "danger-active"]) assert.ok(contrast(tokens.danger, tokens[background]) >= 4.5, background);
});
