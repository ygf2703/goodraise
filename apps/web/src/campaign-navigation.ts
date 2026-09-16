interface CampaignNavigationState {
  authorized: boolean;
  canAnalyze: boolean;
  page: string;
  scope: { organizationId?: string; campaignId?: string };
  campaignName: string;
  ambassadorSlug?: string;
}

/** Only a server-resolved, accessible campaign may supply local navigation. */
export function renderCampaignNavigation(navigation: HTMLElement, state: CampaignNavigationState) {
  const { organizationId, campaignId } = state.scope;
  const visible = state.authorized && Boolean(organizationId && campaignId)
    && ["admin", "project", "prizes"].includes(state.page);
  navigation.hidden = !visible;
  navigation.querySelector<HTMLElement>("[data-campaign-name]")!.textContent = visible ? state.campaignName : "";
  for (const link of navigation.querySelectorAll<HTMLAnchorElement>("[data-page-target]")) {
    const page = link.dataset.pageTarget!;
    link.hidden = !visible || (page === "admin" && !state.canAnalyze);
    const active = !link.hidden && page === state.page;
    link.classList.toggle("is-active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
    if (link.hidden) { link.removeAttribute("href"); continue; }
    const query = new URLSearchParams({ organizationId: organizationId!, campaignId: campaignId! });
    if (state.ambassadorSlug) query.set("ambassador", state.ambassadorSlug);
    link.setAttribute("href", `/${page}?${query}`);
  }
}
