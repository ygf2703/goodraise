import type { BootstrapData } from "../../../../shared/contracts/campaign";
import type { ManagerSession } from "../auth-gate";
import type { JsonObject } from "../api";

export function mountDashboard(root: HTMLElement, options: {
  bootstrap: BootstrapData;
  signal: AbortSignal;
  session?: ManagerSession;
  initialCampaignData?: JsonObject;
  onReady(): void;
  onError(error: unknown): void;
}): () => void;
