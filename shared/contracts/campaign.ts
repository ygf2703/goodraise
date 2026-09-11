export interface CampaignScope {
  organizationId: string;
  campaignId: string;
}

export interface DonationRow {
  id: string;
  createdIso: string;
  date: string;
  hour: number;
  email: string;
  donor: string;
  ambassador: string;
  amount: number;
  city: string;
  status: "success" | "failed";
  chargeResult: string;
}

export interface DatasetMeta {
  uniqueDates: string[];
  projectDates: string[];
  defaultFrom: string;
  defaultTo: string;
  minDate: string;
  maxDate: string;
  rowCount: number;
  projectWindowLabel: string;
}

export interface PrizeModel {
  placePrizes: { place: number; label: string; prize: string }[];
  tierPrizes: { threshold: number; prize: string }[];
  tierRuleNote: string;
  sprintPrize: string;
  excludedAmbassadors: string[];
}

export interface BootstrapData {
  rows: DonationRow[];
  meta: DatasetMeta;
  sourceLabel: string;
  prizes: PrizeModel;
}

export interface PublicCampaignOrganization {
  id: string;
  slug: string;
  name: string;
  logoUrl: string;
}

export interface PublicCompletedCampaignCard {
  organization: PublicCampaignOrganization;
  campaign: {
    id: string;
    slug: string;
    name: string;
    status: "completed";
    description: string;
    mediaType: "image" | "video";
    mediaUrl: string;
    mediaAlt: string;
    campaignLogoUrl: string;
  };
  totals: {
    raised: number;
    target: number;
    progressPercent: number;
    supporterCount: number;
    currency: string;
  };
  startAt: string;
  endAt: string;
  completedAt: string;
  href: string;
  revision: number;
  updatedAt: string;
}

export interface PublicCompletedCampaign extends PublicCompletedCampaignCard {
  schemaVersion: number;
  publishedAt: string;
  campaign: PublicCompletedCampaignCard["campaign"] & { story: string };
}

export interface PublicCompletedCampaignIndex {
  items: PublicCompletedCampaignCard[];
  total: number;
  hasMore: boolean;
}

export type Page = "project" | "prizes" | "rules" | "privacy" | "accessibility" | "admin";
