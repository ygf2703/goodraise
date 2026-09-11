import { useEffect, useState } from "react";
import type {
  PublicCompletedCampaign,
  PublicCompletedCampaignCard,
  PublicCompletedCampaignIndex,
} from "../../../../shared/contracts/campaign";
import { getPublicArchiveEndpoint, type PublicArchiveRoute } from "../platform";
import { Header } from "./Header";
import { SiteFooter } from "./SiteFooter";
import { SkipLink } from "./SkipLink";

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: currency || "ILS",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatDate(value: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("he-IL", { dateStyle: "medium" }).format(date);
}

export function PublicCampaignCard({ item }: { item: PublicCompletedCampaignCard }) {
  const image = item.campaign.mediaUrl || item.campaign.campaignLogoUrl || item.organization.logoUrl;
  return <article className="archive-card">
    <a className="archive-card-link" href={item.href}>
      <div className="archive-card-media">
        {image
          ? <img src={image} alt={item.campaign.mediaAlt || item.campaign.name} loading="lazy" />
          : <span className="archive-media-placeholder" aria-hidden="true">GR</span>}
        <span className="archive-status">הקמפיין הסתיים</span>
      </div>
      <div className="archive-card-body">
        <p className="archive-organization">{item.organization.name}</p>
        <h2>{item.campaign.name}</h2>
        {item.campaign.description && <p className="archive-description">{item.campaign.description}</p>}
        <div className="archive-progress" aria-label={`${item.totals.progressPercent}% מהיעד`}>
          <span style={{ width: `${Math.min(100, Math.max(0, item.totals.progressPercent))}%` }} />
        </div>
        <div className="archive-card-totals">
          <strong>{formatMoney(item.totals.raised, item.totals.currency)}</strong>
          <span>מתוך {formatMoney(item.totals.target, item.totals.currency)}</span>
        </div>
        <div className="archive-card-meta">
          <span>{item.totals.supporterCount.toLocaleString("he-IL")} תומכים ותומכות</span>
          {formatDate(item.completedAt) && <span>הסתיים ב־{formatDate(item.completedAt)}</span>}
        </div>
      </div>
    </a>
  </article>;
}

function ArchiveIndex({ data }: { data: PublicCompletedCampaignIndex }) {
  return <div className="archive-main">
    <header className="archive-heading">
      <p className="archive-kicker">הטוב שכבר קרה</p>
      <h1>קמפיינים שהסתיימו</h1>
      <p>הכירו את הקמפיינים, האנשים והקהילות שהפכו מטרות טובות להשפעה אמיתית.</p>
    </header>
    {data.items.length
      ? <div className="archive-grid">{data.items.map((item) => <PublicCampaignCard key={`${item.organization.id}:${item.campaign.id}`} item={item} />)}</div>
      : <div className="archive-empty">עדיין אין קמפיינים שהסתיימו להצגה.</div>}
  </div>;
}

function ArchiveDetail({ campaign }: { campaign: PublicCompletedCampaign }) {
  const image = campaign.campaign.mediaUrl || campaign.campaign.campaignLogoUrl || campaign.organization.logoUrl;
  return <div className="archive-main archive-detail">
    <a className="archive-back" href="/campaigns">כל הקמפיינים שהסתיימו <span aria-hidden="true">←</span></a>
    <article className="archive-detail-card">
      <div className="archive-detail-copy">
        <p className="archive-kicker">{campaign.organization.name}</p>
        <span className="archive-detail-status">הקמפיין הסתיים</span>
        <h1>{campaign.campaign.name}</h1>
        {campaign.campaign.description && <p className="archive-detail-description">{campaign.campaign.description}</p>}
        <div className="archive-detail-total">
          <strong>{formatMoney(campaign.totals.raised, campaign.totals.currency)}</strong>
          <span>גויסו מתוך יעד של {formatMoney(campaign.totals.target, campaign.totals.currency)}</span>
        </div>
        <div className="archive-progress archive-progress--large" aria-label={`${campaign.totals.progressPercent}% מהיעד`}>
          <span style={{ width: `${Math.min(100, Math.max(0, campaign.totals.progressPercent))}%` }} />
        </div>
        <div className="archive-detail-facts">
          <div><strong>{campaign.totals.progressPercent.toLocaleString("he-IL")}%</strong><span>מהיעד</span></div>
          <div><strong>{campaign.totals.supporterCount.toLocaleString("he-IL")}</strong><span>תומכים ותומכות</span></div>
          <div><strong>{formatDate(campaign.completedAt) || "—"}</strong><span>תאריך סיום</span></div>
        </div>
      </div>
      <div className="archive-detail-media">
        {image
          ? campaign.campaign.mediaType === "video"
            ? <video src={image} controls preload="metadata" aria-label={campaign.campaign.mediaAlt || campaign.campaign.name} />
            : <img src={image} alt={campaign.campaign.mediaAlt || campaign.campaign.name} />
          : <span className="archive-media-placeholder" aria-hidden="true">GoodRaise</span>}
      </div>
    </article>
    {campaign.campaign.story && <section className="archive-story">
      <h2>על הקמפיין</h2>
      <div>{campaign.campaign.story}</div>
    </section>}
  </div>;
}

export function PublicArchivePage({ route }: { route: PublicArchiveRoute }) {
  const [data, setData] = useState<PublicCompletedCampaignIndex | PublicCompletedCampaign | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    fetch(getPublicArchiveEndpoint(route), { signal: abort.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(String(payload?.message || "טעינת הקמפיין נכשלה."));
        setData(payload);
      })
      .catch((reason) => { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : "טעינת הקמפיין נכשלה."); });
    return () => abort.abort();
  }, [route.kind, route.kind === "detail" ? route.organizationId : "", route.kind === "detail" ? route.campaignId : ""]);

  return <div id="goodraise-root" className="public-archive" dir="rtl">
    <SkipLink />
    <Header loadSession />
    <main id="main" className="archive-content" tabIndex={-1}>
      {!data && !error && <div className="archive-loading" role="status">טוענים קמפיינים שהסתיימו…</div>}
      {error && <div className="archive-main"><div className="archive-empty is-error">{error}</div></div>}
      {data && (route.kind === "index"
        ? <ArchiveIndex data={data as PublicCompletedCampaignIndex} />
        : <ArchiveDetail campaign={data as PublicCompletedCampaign} />)}
    </main>
    <SiteFooter />
  </div>;
}
