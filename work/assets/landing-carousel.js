/** Reused by the homepage route; abort on navigation so stale responses cannot render. */
export function mountLandingCarousel(root, signal) {
  const campaignSection = root.querySelector("#past-campaigns");
  const campaignCarousel = root.querySelector("#campaign-carousel");
  const money = (value, currency) => new Intl.NumberFormat("he-IL", { style:"currency", currency:currency || "ILS", maximumFractionDigits:0 }).format(Number(value || 0));
  const date = (value) => {
    const parsed = new Date(value || "");
    return Number.isNaN(parsed.getTime()) ? "" : new Intl.DateTimeFormat("he-IL", { dateStyle:"medium" }).format(parsed);
  };
  const node = (name, className, text) => {
    const element = document.createElement(name);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  };
  const renderCampaign = (item) => {
    const card = node("article", "campaign-card");
    const link = node("a", "campaign-card-link");
    link.href = item.href;
    const media = node("div", "campaign-card-media", "GoodRaise");
    const imageUrl = item.campaign.mediaUrl || item.campaign.campaignLogoUrl || item.organization.logoUrl;
    if (imageUrl) {
      media.textContent = "";
      const image = document.createElement("img");
      image.src = imageUrl;
      image.alt = item.campaign.mediaAlt || item.campaign.name;
      image.loading = "lazy";
      media.append(image);
    }
    media.append(node("span", "campaign-card-status", "הקמפיין הסתיים"));
    const body = node("div", "campaign-card-body");
    body.append(node("p", "campaign-card-org", item.organization.name), node("h3", "", item.campaign.name));
    if (item.campaign.description) body.append(node("p", "campaign-card-description", item.campaign.description));
    const progress = node("div", "campaign-progress");
    progress.setAttribute("aria-label", `${item.totals.progressPercent}% מהיעד`);
    const progressValue = document.createElement("span");
    progressValue.style.width = `${Math.min(100, Math.max(0, item.totals.progressPercent))}%`;
    progress.append(progressValue);
    const totals = node("div", "campaign-card-total");
    totals.append(node("strong", "", money(item.totals.raised, item.totals.currency)), node("span", "", `מתוך ${money(item.totals.target, item.totals.currency)}`));
    const meta = node("div", "campaign-card-meta");
    meta.append(node("span", "", `${Number(item.totals.supporterCount || 0).toLocaleString("he-IL")} תומכים ותומכות`));
    const completed = date(item.completedAt);
    if (completed) meta.append(node("span", "", `הסתיים ב־${completed}`));
    body.append(progress, totals, meta);
    link.append(media, body);
    card.append(link);
    return card;
  };
  fetch("/api/public/campaigns?limit=8", { headers:{ accept:"application/json" }, signal })
    .then((response) => response.ok ? response.json() : Promise.reject(new Error("archive unavailable")))
    .then((payload) => {
      if (signal.aborted || !Array.isArray(payload.items) || !payload.items.length) return;
      campaignCarousel.classList.toggle("is-single", payload.items.length === 1);
      campaignCarousel.replaceChildren(...payload.items.map(renderCampaign));
      campaignSection.hidden = false;
    })
    .catch(() => {});
  root.querySelector("#campaign-carousel-next").addEventListener("click", () => campaignCarousel.scrollBy({ left:-campaignCarousel.clientWidth * .8, behavior:"smooth" }), { signal });
  root.querySelector("#campaign-carousel-previous").addEventListener("click", () => campaignCarousel.scrollBy({ left:campaignCarousel.clientWidth * .8, behavior:"smooth" }), { signal });
}
