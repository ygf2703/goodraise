/** Chart tooltips are siblings of the scrollable chart, inside a positioned
 * frame. Use that frame's coordinates, not the scrolled SVG or RTL start edge. */
export function showTooltip(target: HTMLElement, tooltip: HTMLElement, html: string, clientX: number, clientY: number) {
  tooltip.innerHTML = html;
  tooltip.classList.add("is-visible");
  const rect = (tooltip.offsetParent || target).getBoundingClientRect();
  const tipRect = tooltip.getBoundingClientRect();
  const left = Math.max(0, Math.min(Math.max(clientX - rect.left - tipRect.width / 2, 8), rect.width - tipRect.width - 8));
  const top = Math.max(clientY - rect.top - tipRect.height - 14, 8);
  tooltip.style.transform = `translate(${left}px, ${top}px)`;
}

export function hideTooltip(tooltip: HTMLElement) {
  tooltip.classList.remove("is-visible");
  tooltip.style.removeProperty("transform");
}
