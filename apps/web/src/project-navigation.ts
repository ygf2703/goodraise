/** Keep real anchors and native navigation, including modified/new-tab clicks. */
export function mountProjectNavigation(cards: HTMLAnchorElement[], status: HTMLElement, signal: AbortSignal) {
  if (!cards.length) return () => {};
  let pending = false;
  const labels = cards.map(card => card.querySelector<HTMLElement>(".account-project-status")!);
  const originalLabels = labels.map(label => label.textContent);
  const reset = () => {
    pending = false;
    status.textContent = "";
    cards.forEach((card, index) => {
      card.removeAttribute("aria-busy");
      card.removeAttribute("aria-disabled");
      labels[index].textContent = originalLabels[index];
      labels[index].classList.remove("gr-loading-indicator");
    });
  };
  cards.forEach((card, index) => card.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || card.target === "_blank") return;
    if (pending) { event.preventDefault(); return; }
    pending = true;
    cards.forEach(item => item.setAttribute("aria-disabled", "true"));
    card.setAttribute("aria-busy", "true");
    labels[index].textContent = "פותחים פרויקט…";
    labels[index].classList.add("gr-loading-indicator");
    status.textContent = `פותחים את ${card.querySelector("h3")?.textContent || "הפרויקט"}…`;
  }, { signal }));
  // Returning with browser Back must not restore a permanently pending card.
  window.addEventListener("pageshow", reset, { signal });
  signal.addEventListener("abort", reset, { once: true });
  return reset;
}
