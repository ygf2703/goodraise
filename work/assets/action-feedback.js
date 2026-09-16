/** Shared pending state for imperative controls; React buttons use the same aria-busy styling. */
export function setButtonBusy(button, busy, pendingLabel, idleLabel) {
  button.disabled = busy;
  button.setAttribute("aria-busy", String(busy));
  button.textContent = busy ? pendingLabel : idleLabel;
}
