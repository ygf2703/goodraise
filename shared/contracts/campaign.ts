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

export type Page = "project" | "prizes" | "rules" | "privacy" | "admin";
