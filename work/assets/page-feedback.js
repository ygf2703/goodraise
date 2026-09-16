const operations = new Map();
let restorePage = null;

/** A single overlay, outside page layout; independent operations cannot hide each other. */
export function beginPageBusy(label = "טוענים את העמוד…") {
  const token = Symbol("page-operation");
  operations.set(token, label);
  render();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    operations.delete(token);
    render();
  };
}

export function isPageBusy() { return operations.size > 0; }

function render() {
  // Rendering/tests on the server do not have a browser document.
  if (typeof document === "undefined" || typeof document.getElementById !== "function") return;
  let overlay = document.getElementById("goodraise-page-loading");
  if (operations.size) {
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "goodraise-page-loading";
      overlay.className = "page-loading-overlay";
      overlay.dir = "rtl";
      overlay.setAttribute("role", "status");
      overlay.setAttribute("aria-live", "polite");
      overlay.setAttribute("tabindex", "-1");
      const panel = document.createElement("div");
      panel.className = "page-loading-panel";
      const spinner = document.createElement("span");
      spinner.className = "page-loading-spinner";
      spinner.setAttribute("aria-hidden", "true");
      const text = document.createElement("span");
      text.className = "page-loading-label";
      panel.append(spinner, text);
      overlay.append(panel);
      document.body.append(overlay);
    }
    overlay.querySelector(".page-loading-label").textContent = [...operations.values()].at(-1);
    if (!restorePage) {
      const page = document.getElementById("app") || document.querySelector("main");
      const focused = document.activeElement;
      const wasInert = page?.inert;
      if (page) page.inert = true;
      document.documentElement.classList.add("page-is-loading");
      overlay.focus({ preventScroll: true });
      restorePage = () => {
        if (page) page.inert = wasInert;
        document.documentElement.classList.remove("page-is-loading");
        if (focused?.isConnected && typeof focused.focus === "function") focused.focus({ preventScroll: true });
      };
    }
  } else {
    overlay?.remove();
    restorePage?.();
    restorePage = null;
  }
}

export function navigateSite(destination, { replace = false } = {}) {
  const event = new CustomEvent("goodraise:navigate", { cancelable: true, detail: { destination, replace } });
  if (window.dispatchEvent(event)) window.location[replace ? "replace" : "assign"](destination);
}
