import type { BootstrapData } from "../../../../shared/contracts/campaign";

export function mountDashboard(root: HTMLElement, options: {
  bootstrap: BootstrapData;
  signal: AbortSignal;
  onReady(): void;
  onError(error: unknown): void;
}): () => void;
