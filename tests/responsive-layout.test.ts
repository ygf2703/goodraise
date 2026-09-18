import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { showTooltip, hideTooltip } from "../apps/web/src/chart-tooltip";

function tooltipFixture(frameWidth = 300, tipWidth = 120) {
  const classes = new Set<string>();
  const style = {
    transform: "",
    removeProperty(name: string) { assert.equal(name, "transform"); this.transform = ""; return ""; },
  };
  const tooltip = {
    innerHTML: "", style,
    classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name) },
    offsetParent: { getBoundingClientRect: () => ({ left: 20, top: 100, width: frameWidth }) },
    getBoundingClientRect: () => ({ width: tipWidth, height: 40 }),
  };
  // A scrolled chart may have a very different origin from its tooltip frame.
  const target = { getBoundingClientRect: () => ({ left: -800, top: 180, width: 1200 }) };
  return { tooltip: tooltip as unknown as HTMLElement, target: target as unknown as HTMLElement, classes, style };
}

test("chart tooltips use their positioned frame and clamp to both mobile edges", () => {
  const { tooltip, target, classes, style } = tooltipFixture();
  showTooltip(target, tooltip, "<strong>Chart value</strong>", 150, 220);
  assert.equal(style.transform, "translate(70px, 66px)");
  assert.ok(classes.has("is-visible"));
  assert.equal(tooltip.innerHTML, "<strong>Chart value</strong>");
  showTooltip(target, tooltip, "value", -100, 100);
  assert.equal(style.transform, "translate(8px, 8px)");
  showTooltip(target, tooltip, "value", 900, 100);
  assert.equal(style.transform, "translate(172px, 8px)");
});

test("hiding chart tooltips clears placement instead of extending the RTL scroll area", () => {
  const { tooltip, target, classes, style } = tooltipFixture();
  showTooltip(target, tooltip, "value", 150, 220);
  hideTooltip(tooltip);
  assert.equal(style.transform, "");
  assert.equal(classes.has("is-visible"), false);
  const narrow = tooltipFixture(100, 100);
  showTooltip(narrow.target, narrow.tooltip, "value", 50, 100);
  assert.equal(narrow.style.transform, "translate(0px, 8px)");
});

test("all pages load one responsive foundation, with shrink-safe controls and contained reports", async () => {
  const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const css = await source("work/assets/site-layout.css");
  assert.match(await source("apps/web/src/main.tsx"), /import "\.\.\/\.\.\/\.\.\/work\/assets\/site-layout\.css"/);
  assert.match(await source("work/goodraise-landing.html"), /href="\/assets\/site-layout\.css"/);
  assert.match(css, /:where\(\*\)\s*\{\s*min-width: 0;/);
  assert.match(css, /--site-control-font-size: 16px/);
  assert.match(css, /:where\(\.table-wrap, \.daily-winners-table-wrap, \.chart-surface\)[^}]*overflow-x: auto/s);
  assert.doesNotMatch(css, /overflow(?:-x)?:\s*(?:hidden|clip)/);
  for (const path of ["work/assets/site-header.css", "work/assets/landing.css", "apps/web/src/styles/help.css", "apps/web/src/styles/dashboard.css"]) {
    assert.match(await source(path), /var\(--site-gutter/, path);
  }
  const dashboard = await source("apps/web/src/styles/dashboard.css");
  assert.match(dashboard, /minmax\(min\(100%, 240px\), 1fr\)/);
  assert.match(dashboard, /\.place-card--1\s*\{\s*transform: none;\s*order: 0;/);
  assert.match(dashboard, /\.winner-amount\s*\{\s*grid-column: 2;/);
  assert.match(dashboard, /\.status-chip,[^}]*\.prize-pill\s*\{\s*white-space: normal;/);
  assert.match(dashboard, /\.tooltip\s*\{[^}]*left: 0;[^}]*visibility: hidden;/s);
  assert.match(dashboard, /min-width: var\(--chart-min-width, 100%\)/);
  assert.doesNotMatch(dashboard, /-9999px/);
  const controller = await source("apps/web/src/compat/dashboard-controller.js");
  assert.doesNotMatch(controller, /-9999px/);
  assert.match(controller, /style="--chart-min-width: \$\{width\}px"/);
  assert.match(controller, /class="daily-winners-table-wrap" tabindex="0" role="region" aria-label=/);
  const insights = await source("apps/web/src/components/InsightsPanel.tsx");
  for (const id of ["daily-chart", "heatmap-chart", "movement-chart", "table-root"]) {
    assert.match(insights, new RegExp(`id="${id}"[^>]*tabIndex=\\{0\\}[^>]*role="region"[^>]*aria-label=`));
  }
});
