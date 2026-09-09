import { createGoodRaiseIntelligence } from '../../../../shared/intelligence/engine.mjs';
import defaultCampaign from '../default-campaign.json';
import { authConfig, getInitialPage, getCampaignRoute, getCampaignViewEndpoint } from '../platform';
import { migrateBrowserStorage } from '../storage';
import { requestJson } from '../api';
import { canAccessManagerPages, setSiteSession, logoutSiteSession } from '../../../../work/assets/site-header.js';

/** Existing campaign controls, scoped to one React mount. Dynamic chart/table containers
 * are owned by this adapter until they are converted to individual React components. */
export function mountDashboard(root, { bootstrap, signal, onReady, onError, session: initialSession = null, initialCampaignData = null }) {
  migrateBrowserStorage();
  const fetch = (input, init = {}) => window.fetch(input, { ...init, signal });
  const listen = (target, event, callback, options = {}) => target.addEventListener(event, callback, { ...options, signal });
const { rows: INITIAL_ROWS, meta: INITIAL_META, sourceLabel: INITIAL_SOURCE_LABEL, prizes: INITIAL_PRIZES } = bootstrap;
const INITIAL_ORG_LOGO = '/assets/goodraise-logo-transparent.png';
const INITIAL_CAMPAIGN_LOGO = '/assets/goodraise-logo-transparent.png';
const INITIAL_BACKDROP = '';
const INITIAL_CAMPAIGN_PAGE_SETTINGS = defaultCampaign;
const AUTH_CONFIG = authConfig;
const PRIZE_STORAGE_KEY = "goodraise.prize-model";
const GOAL_STORAGE_KEY = "goodraise.goals";
const CAMPAIGN_PAGE_SETTINGS_KEY = "goodraise.campaign-page-settings";
const CAMPAIGN_BUILDER_CONFIG_KEY = "goodraise.campaign-builder-config";
const CAMPAIGN_REGISTRY_STORAGE_KEY = "goodraise.campaign-registry";
const AMBASSADOR_DIRECTORY_KEY = "goodraise.ambassador-directory";
const LAST_ADMIN_EMAIL_KEY = "goodraise.last-admin-email";

root.style.setProperty("--brand-pattern-campaign", `url("${INITIAL_CAMPAIGN_LOGO}")`);
root.style.setProperty("--brand-pattern-organization", `url("${INITIAL_ORG_LOGO}")`);
root.style.setProperty("--dashboard-backdrop", INITIAL_BACKDROP ? `url("${INITIAL_BACKDROP}")` : "none");


const elements = {
  logo: root.querySelector("#brand-logo"),
  brandOrgLogo: root.querySelector("#brand-org-logo"),
  publicLogo: root.querySelector("#public-logo"),
  publicOrgLogo: root.querySelector("#public-org-logo"),
  loginCampaignLogo: root.querySelector("#login-campaign-logo"),
  loginOrgLogo: root.querySelector("#login-org-logo"),
  navButtons: Array.from(root.querySelectorAll("[data-page-target]")),
  metricButtons: Array.from(root.querySelectorAll("[data-metric-select]")),
  pageProject: root.querySelector("#page-project"),
  pagePrizes: root.querySelector("#page-prizes"),
  pageRules: root.querySelector("#page-rules"),
  pagePrivacy: root.querySelector("#page-privacy"),
  pageAdmin: root.querySelector("#page-admin"),
  projectPageRoot: root.querySelector("#project-page-root"),
  campaignDesignerPanel: root.querySelector("#campaign-designer-panel"),
  adminTabButtons: Array.from(root.querySelectorAll("[data-admin-tab-target]")),
  adminTabPanelInsights: root.querySelector("#admin-tab-panel-insights"),
  adminTabPanelDesign: root.querySelector("#admin-tab-panel-design"),
  sessionStatus: root.querySelector("#session-status"),
  logoutButton: root.querySelector("#logout-button"),
  publicHeroBadges: root.querySelector("#public-hero-badges"),
  adminLock: root.querySelector("#admin-lock"),
  adminContent: root.querySelector("#admin-content"),
  loginForm: root.querySelector("#login-form"),
  loginEmail: root.querySelector("#login-email"),
  loginPassword: root.querySelector("#login-password"),
  loginPasswordSetupNote: root.querySelector("#login-password-setup-note"),
  loginPasswordConfirmLabel: root.querySelector("#login-password-confirm-label"),
  loginPasswordConfirm: root.querySelector("#login-password-confirm"),
  loginPasswordToggle: root.querySelector("#login-password-toggle"),
  loginButton: root.querySelector("#login-button"),
  loginResetButton: root.querySelector("#login-reset-button"),
  loginModeHint: root.querySelector("#login-mode-hint"),
  loginMessage: root.querySelector("#login-message"),
  heroBadges: root.querySelector("#hero-badges"),
  activeFilterSummary: root.querySelector("#active-filter-summary"),
  controlNote: root.querySelector("#control-note"),
  adminWindowLabel: root.querySelector("#admin-window-label"),
  adminLastUpdated: root.querySelector("#admin-last-updated"),
  adminSourceFile: root.querySelector("#admin-source-file"),
  adminRecordCount: root.querySelector("#admin-record-count"),
  upload: root.querySelector("#csv-upload"),
  compareUpload: root.querySelector("#compare-upload"),
  prizeUpload: root.querySelector("#prize-upload"),
  importStatus: root.querySelector("#import-status"),
  sourceMode: root.querySelector("#source-mode"),
  sourceApiEndpoint: root.querySelector("#source-api-endpoint"),
  sourceApiMethod: root.querySelector("#source-api-method"),
  sourceApiFormat: root.querySelector("#source-api-format"),
  sourceApiRecordsPath: root.querySelector("#source-api-records-path"),
  sourceApiAuthType: root.querySelector("#source-api-auth-type"),
  sourceApiAutoRefresh: root.querySelector("#source-api-auto-refresh"),
  sourceApiBearerToken: root.querySelector("#source-api-bearer-token"),
  sourceApiHeaders: root.querySelector("#source-api-headers"),
  sourceApiBody: root.querySelector("#source-api-body"),
  sourceApiFieldMap: root.querySelector("#source-api-field-map"),
  sourceApiFields: root.querySelector("#source-api-fields"),
  sourceGoogleUrl: root.querySelector("#source-google-url"),
  sourceGoogleId: root.querySelector("#source-google-id"),
  sourceGoogleGid: root.querySelector("#source-google-gid"),
  sourceGoogleSheetName: root.querySelector("#source-google-sheet-name"),
  sourceGoogleRange: root.querySelector("#source-google-range"),
  sourceGoogleAccessMode: root.querySelector("#source-google-access-mode"),
  sourceGoogleSyncInterval: root.querySelector("#source-google-sync-interval"),
  sourceGoogleFieldMap: root.querySelector("#source-google-field-map"),
  sourceGoogleFields: root.querySelector("#source-google-fields"),
  saveSourceConfig: root.querySelector("#save-source-config"),
  refreshSourceApi: root.querySelector("#refresh-source-api"),
  addManualContribution: root.querySelector("#add-manual-contribution"),
  manualContributionDialog: root.querySelector("#manual-contribution-dialog"),
  manualContributionForm: root.querySelector("#manual-contribution-form"),
  manualContributionEnteredBy: root.querySelector("#manual-contribution-entered-by"),
  manualContributionAmount: root.querySelector("#manual-contribution-amount"),
  manualContributionAttributedAt: root.querySelector("#manual-contribution-attributed-at"),
  manualContributionStatus: root.querySelector("#manual-contribution-status"),
  manualContributionCancel: root.querySelector("#manual-contribution-cancel"),
  insightAssistantForm: root.querySelector("#insight-assistant-form"),
  insightAssistantQuestion: root.querySelector("#insight-assistant-question"),
  insightAssistantSubmit: root.querySelector("#insight-assistant-submit"),
  insightAssistantStatus: root.querySelector("#insight-assistant-status"),
  insightAssistantAnswer: root.querySelector("#insight-assistant-answer"),
  insightAssistantAnswerText: root.querySelector("#insight-assistant-answer-text"),
  insightAssistantScope: root.querySelector("#insight-assistant-scope"),
  sourceConfigStatus: root.querySelector("#source-config-status"),
  analysisProjectStart: root.querySelector("#analysis-project-start"),
  analysisProjectEnd: root.querySelector("#analysis-project-end"),
  saveAnalysisProjectDates: root.querySelector("#save-analysis-project-dates"),
  analysisProjectDatesStatus: root.querySelector("#analysis-project-dates-status"),
  goalTotal: root.querySelector("#goal-total"),
  goalDaily: root.querySelector("#goal-daily"),
  dailyMetric: root.querySelector("#daily-metric-select"),
  heatmapMetric: root.querySelector("#heatmap-metric-select"),
  movementMetric: root.querySelector("#movement-metric-select"),
  exportFiltered: root.querySelector("#export-filtered"),
  clearCompare: root.querySelector("#clear-compare"),
  clearFilters: root.querySelector("#clear-filters"),
  resetWorkingData: root.querySelector("#reset-working-data"),
  ambassador: root.querySelector("#ambassador-filter"),
  projectDay: root.querySelector("#project-day-filter"),
  dateExact: root.querySelector("#date-exact"),
  dateFrom: root.querySelector("#date-from"),
  dateTo: root.querySelector("#date-to"),
  hour: root.querySelector("#hour-filter"),
  hourFrom: root.querySelector("#hour-from-filter"),
  hourTo: root.querySelector("#hour-to-filter"),
  timeFrom: root.querySelector("#time-from-filter"),
  timeTo: root.querySelector("#time-to-filter"),
  donor: root.querySelector("#donor-filter"),
  amountMin: root.querySelector("#amount-min-filter"),
  amountMax: root.querySelector("#amount-max-filter"),
  metrics: root.querySelector("#metrics-grid"),
  goalsBoard: root.querySelector("#goals-board"),
  goalsSummary: root.querySelector("#goals-summary"),
  validationBoard: root.querySelector("#validation-board"),
  validationSummary: root.querySelector("#validation-summary"),
  executiveBoard: root.querySelector("#executive-board"),
  executiveSummary: root.querySelector("#executive-summary"),
  qualityBoard: root.querySelector("#quality-board"),
  qualitySummary: root.querySelector("#quality-summary"),
  segmentBoard: root.querySelector("#segment-board"),
  segmentSummary: root.querySelector("#segment-summary"),
  comparisonBoard: root.querySelector("#comparison-board"),
  comparisonSummary: root.querySelector("#comparison-summary"),
  prizeBoard: root.querySelector("#prize-board"),
  prizeSummary: root.querySelector("#prize-summary"),
  prizeAmbassadorSearch: root.querySelector("#prize-ambassador-search"),
  prizeAmbassadorDirectory: root.querySelector("#prize-ambassador-directory"),
  dailyChart: root.querySelector("#daily-chart"),
  dailyTooltip: root.querySelector("#daily-tooltip"),
  dailySummary: root.querySelector("#daily-chart-summary"),
  heatmapSummary: root.querySelector("#heatmap-summary"),
  heatmapChart: root.querySelector("#heatmap-chart"),
  heatmapTooltip: root.querySelector("#heatmap-tooltip"),
  movementChart: root.querySelector("#movement-chart"),
  movementTooltip: root.querySelector("#movement-tooltip"),
  movementSummary: root.querySelector("#movement-summary"),
  tableRoot: root.querySelector("#table-root"),
  tableSummary: root.querySelector("#table-summary"),
  tablePanel: root.querySelector("#table-panel"),
  tableToggle: root.querySelector("#table-toggle"),
};

const weekdayFormatter = new Intl.DateTimeFormat("he-IL", { weekday: "short" });
const dateFormatter = new Intl.DateTimeFormat("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" });
const dateShortFormatter = new Intl.DateTimeFormat("he-IL", { day: "2-digit", month: "2-digit" });
const dateTimeFormatter = new Intl.DateTimeFormat("he-IL", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const currencyFormatter = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 0,
});
const numberFormatter = new Intl.NumberFormat("he-IL");

const initialCampaignRegistry = readStoredCampaignRegistry();
const initialActiveCampaignEntry = getCampaignRegistryActiveEntry(initialCampaignRegistry);
const initialCampaignPageSettings = buildCampaignPageSettingsFromSnapshot(
  initialActiveCampaignEntry?.config,
  readStoredCampaignPageSettings() || INITIAL_CAMPAIGN_PAGE_SETTINGS
);
const initialCampaignGoals = buildGoalsFromCampaignSnapshot(initialActiveCampaignEntry?.config, readStoredGoals());
const initialCampaignPrizeModel = buildPrizeModelFromCampaignSnapshot(initialActiveCampaignEntry?.config, readStoredPrizeModel() || INITIAL_PRIZES);
const initialCampaignSourceConfig = buildSourceConfigFromCampaignSnapshot(initialActiveCampaignEntry?.config, getDefaultSourceConfig());
const initialCampaignBuilderConfig = buildCampaignBuilderConfigFromSnapshot(initialActiveCampaignEntry?.config, readStoredCampaignBuilderConfig());
const initialCampaignAmbassadorDirectory = buildAmbassadorDirectoryFromCampaignSnapshot(
  initialActiveCampaignEntry?.config,
  readStoredAmbassadorDirectory()
);

const state = {
  rows: cloneSerializable(INITIAL_ROWS),
  meta: cloneSerializable(INITIAL_META),
  sourceLabel: INITIAL_SOURCE_LABEL,
  // Dataset freshness is the source read/snapshot time, not the newest donation timestamp.
  datasetFreshnessAt: String(INITIAL_META?.fetchedAt || INITIAL_META?.dataThroughAt || "").trim(),
  compare: {
    rows: [],
    meta: null,
    label: "",
  },
  validation: {
    base: null,
    compare: null,
  },
  goals: initialCampaignGoals,
  prizeModel: initialCampaignPrizeModel,
  sourceConfig: initialCampaignSourceConfig,
  campaignPage: initialCampaignPageSettings,
  campaignBuilder: initialCampaignBuilderConfig,
  ambassadorDirectory: initialCampaignAmbassadorDirectory,
  campaignRegistry: initialCampaignRegistry,
  activeCampaignId: initialCampaignRegistry.activeCampaignId,
  session: null,
  auth: {
    backendAvailable: false,
    setupMode: false,
    adminDatasetLoaded: false,
    publicDatasetStatus: "pending",
    publicDatasetError: "",
    campaignConfigLoaded: false,
    accessibleCampaigns: [],
    publicScope: {
      organizationId: "",
      campaignId: "",
    },
    currentScope: {
      organizationId: "",
      campaignId: "",
    },
  },
  filters: getDefaultFilters(cloneSerializable(INITIAL_META)),
  view: {
    dailyMetric: "amount",
    heatmapMetric: "amount",
    movementMetric: "amount",
  },
  donation: getDefaultDonationState(initialCampaignPageSettings),
  ui: {
    page: "project",
    tableExpanded: false,
    prizeAmbassadorSearch: "",
    ambassadorReportFilters: {
      search: "",
      fundraisingState: "zero",
      minimumAmount: "",
      maximumAmount: "",
    },
    adminTab: "insights",
    campaignBuilderStep: 1,
    campaignSettingsStatus: {
      message: "ההגדרות נשמרות מקומית בדפדפן זה בלבד.",
      tone: "neutral",
    },
    campaignBuilderStatus: {
      message: "טיוטת הקמפיין עדיין לא נשמרה בשרת.",
      tone: "neutral",
    },
    ambassadorDirectoryStatus: {
      message: "עדיין לא נטען קובץ שגרירים. אפשר להעלות CSV כדי לייצר לינקים אישיים.",
      tone: "neutral",
    },
    sourceConfigStatus: {
      message: "כרגע המערכת עובדת על בסיס קובץ. כשה-API יהיה מוכן, אפשר יהיה לעבור למצב משיכה ישירה.",
      tone: "neutral",
    },
  },
};
let manualContributionRequestId = "";

if (state.ambassadorDirectory.length) {
  setAmbassadorDirectoryStatus(`${state.ambassadorDirectory.length} שגרירים נטענו מהאחסון המקומי עם לינקים אישיים פעילים.`, "success");
}

function cloneSerializable(value) {
  return JSON.parse(JSON.stringify(value));
}

function getDefaultSourceFieldMap() {
  return {
    id: "id",
    created_at: "created_at",
    full_name: "full_name",
    email: "email",
    "Ambassador name": "Ambassador name",
    total: "total",
    city: "city",
    charged_success: "charged_success",
    charge_result: "charge_result",
  };
}

function getDefaultSourceConfig() {
  return {
    mode: "file",
    api: {
      endpoint: "",
      method: "GET",
      responseFormat: "csv",
      recordsPath: "",
      authType: "none",
      bearerToken: "",
      hasBearerToken: false,
      autoRefreshMinutes: 5,
      headersText: "",
      bodyText: "",
      fieldMapText: JSON.stringify(getDefaultSourceFieldMap(), null, 2),
    },
    googleSheets: {
      spreadsheetUrl: "",
      spreadsheetId: "",
      gid: "",
      sheetName: "",
      range: "",
      accessMode: "public_csv",
      syncEnabled: true,
      syncIntervalMinutes: 5,
      fieldMapText: JSON.stringify(getDefaultSourceFieldMap(), null, 2),
      lastSyncedAt: "",
      lastSuccessfulSyncAt: "",
      lastChecksum: "",
      lastRowCount: 0,
      lastStatus: "idle",
      lastMessage: "",
      lastSourceLabel: "",
    },
  };
}

function normalizePositiveInteger(value, fallback) {
  const numeric = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

function parseJsonObjectText(text, fallbackValue = {}) {
  const raw = String(text || "").trim();
  if (!raw) {
    return cloneSerializable(fallbackValue);
  }
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("יש להזין אובייקט JSON תקין במיפוי השדות.");
  }
  return parsed;
}

function normalizeSourceConfig(value) {
  const defaults = getDefaultSourceConfig();
  const candidate = value && typeof value === "object" ? value : {};
  const apiCandidate = candidate.api && typeof candidate.api === "object" ? candidate.api : {};
  const googleSheetsCandidate = candidate.googleSheets && typeof candidate.googleSheets === "object" ? candidate.googleSheets : {};
  let fieldMapText = defaults.api.fieldMapText;
  try {
    fieldMapText = JSON.stringify(parseJsonObjectText(apiCandidate.fieldMapText, getDefaultSourceFieldMap()), null, 2);
  } catch (_error) {
    fieldMapText = defaults.api.fieldMapText;
  }
  let googleFieldMapText = defaults.googleSheets.fieldMapText;
  try {
    googleFieldMapText = JSON.stringify(
      parseJsonObjectText(googleSheetsCandidate.fieldMapText, getDefaultSourceFieldMap()),
      null,
      2
    );
  } catch (_error) {
    googleFieldMapText = defaults.googleSheets.fieldMapText;
  }
  const bearerToken = String(apiCandidate.bearerToken || "").trim();
  return {
    mode: candidate.mode === "google_sheets" ? "google_sheets" : candidate.mode === "api" ? "api" : "file",
    api: {
      endpoint: String(apiCandidate.endpoint || "").trim(),
      method: String(apiCandidate.method || defaults.api.method).trim().toUpperCase() === "POST" ? "POST" : "GET",
      responseFormat: String(apiCandidate.responseFormat || defaults.api.responseFormat).trim().toLowerCase() === "json" ? "json" : "csv",
      recordsPath: String(apiCandidate.recordsPath || "").trim(),
      authType: String(apiCandidate.authType || defaults.api.authType).trim().toLowerCase() === "bearer" ? "bearer" : "none",
      bearerToken,
      hasBearerToken: Boolean(apiCandidate.hasBearerToken || bearerToken),
      autoRefreshMinutes: normalizePositiveInteger(apiCandidate.autoRefreshMinutes, defaults.api.autoRefreshMinutes),
      headersText: String(apiCandidate.headersText || "").replaceAll("\r\n", "\n").trim(),
      bodyText: String(apiCandidate.bodyText || "").replaceAll("\r\n", "\n").trim(),
      fieldMapText,
    },
    googleSheets: {
      spreadsheetUrl: String(googleSheetsCandidate.spreadsheetUrl || "").trim(),
      spreadsheetId: String(googleSheetsCandidate.spreadsheetId || "").trim(),
      gid: String(googleSheetsCandidate.gid || "").trim(),
      sheetName: String(googleSheetsCandidate.sheetName || "").trim(),
      range: String(googleSheetsCandidate.range || "").trim(),
      accessMode: String(googleSheetsCandidate.accessMode || defaults.googleSheets.accessMode).trim().toLowerCase() === "service_account"
        ? "service_account"
        : "public_csv",
      syncEnabled: googleSheetsCandidate.syncEnabled !== false,
      syncIntervalMinutes: normalizePositiveInteger(
        googleSheetsCandidate.syncIntervalMinutes,
        defaults.googleSheets.syncIntervalMinutes
      ),
      fieldMapText: googleFieldMapText,
      lastSyncedAt: String(googleSheetsCandidate.lastSyncedAt || "").trim(),
      lastSuccessfulSyncAt: String(googleSheetsCandidate.lastSuccessfulSyncAt || "").trim(),
      lastChecksum: String(googleSheetsCandidate.lastChecksum || "").trim(),
      lastRowCount: normalizePositiveInteger(googleSheetsCandidate.lastRowCount, 0),
      lastStatus: String(googleSheetsCandidate.lastStatus || "idle").trim().toLowerCase() || "idle",
      lastMessage: String(googleSheetsCandidate.lastMessage || "").trim(),
      lastSourceLabel: String(googleSheetsCandidate.lastSourceLabel || "").trim(),
    },
  };
}

function setSourceConfigStatus(message, tone = "neutral") {
  state.ui.sourceConfigStatus = {
    message: String(message || "כרגע המערכת עובדת על בסיס קובץ. כשה-API יהיה מוכן, אפשר יהיה לעבור למצב משיכה ישירה."),
    tone: String(tone || "neutral"),
  };
  if (!elements.sourceConfigStatus) {
    return;
  }
  elements.sourceConfigStatus.textContent = state.ui.sourceConfigStatus.message;
  elements.sourceConfigStatus.className = `status-note text-small${tone && tone !== "neutral" ? ` is-${tone}` : ""}`;
}

function getSourceConfigStatus() {
  return state.ui.sourceConfigStatus || {
    message: "כרגע המערכת עובדת על בסיס קובץ. כשה-API יהיה מוכן, אפשר יהיה לעבור למצב משיכה ישירה.",
    tone: "neutral",
  };
}

function buildBaseValidationSnapshot(rows, label) {
  return {
    label: label || "קובץ בסיס",
    totalRows: rows.length,
    validRows: rows,
    errors: [],
    warnings: [],
    missingColumns: [],
    invalidDateRows: 0,
    invalidAmountRows: 0,
    missingAmbassadorRows: rows.filter((row) => row.ambassador === "ללא שיוך").length,
    missingEmailRows: rows.filter((row) => !row.email).length,
    duplicateIdCount: 0,
  };
}

function restorePublicDataset() {
  state.rows = enrichRows(cloneSerializable(INITIAL_ROWS), cloneSerializable(INITIAL_META));
  state.meta = cloneSerializable(INITIAL_META);
  state.sourceLabel = INITIAL_SOURCE_LABEL;
  state.datasetFreshnessAt = String(INITIAL_META?.fetchedAt || INITIAL_META?.dataThroughAt || "").trim();
  state.compare = {
    rows: [],
    meta: null,
    label: "",
  };
  state.validation.compare = null;
  state.validation.base = buildBaseValidationSnapshot(state.rows, state.sourceLabel);
  state.auth.adminDatasetLoaded = false;
}

function restoreWorkingData() {
  restorePublicDataset();
  state.prizeModel = normalizePrizeModel(cloneSerializable(INITIAL_PRIZES));
  storePrizeModel(state.prizeModel);
  state.ambassadorDirectory = [];
  storeAmbassadorDirectory([]);
  setAmbassadorDirectoryStatus("רשימת השגרירים נוקתה. אפשר להעלות CSV חדש בכל עת.", "neutral");
  state.filters = getDefaultFilters(state.meta);
  state.donation = syncDonationStateWithCampaignPage(state.donation, state.campaignPage);
  applyAmbassadorContextFromUrl();
  if (elements.upload) {
    elements.upload.value = "";
  }
  if (elements.compareUpload) {
    elements.compareUpload.value = "";
  }
  if (elements.prizeUpload) {
    elements.prizeUpload.value = "";
  }
  const ambassadorUpload = elements.campaignDesignerPanel?.querySelector("#ambassador-directory-upload");
  if (ambassadorUpload) {
    ambassadorUpload.value = "";
  }
  resetFilterOptions();
  setImportMessage("נתוני העבודה אופסו. אפשר להעלות עכשיו קובץ עסקאות, קובץ השוואה, קובץ פרסים או קובץ שגרירים חדשים.", "success");
}

function getDefaultFilters(meta) {
  return {
    ambassador: "all",
    projectDay: "all",
    dateExact: "all",
    hour: "all",
    hourFrom: "all",
    hourTo: "all",
    timeFrom: "",
    timeTo: "",
    dateFrom: meta.defaultFrom || "",
    dateTo: meta.defaultTo || "",
    donor: "",
    amountMin: "",
    amountMax: "",
  };
}

function readStoredPrizeModel() {
  try {
    const raw = window.localStorage.getItem(PRIZE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_error) {
    return null;
  }
}

function storePrizeModel(model) {
  try {
    window.localStorage.setItem(PRIZE_STORAGE_KEY, JSON.stringify(model));
    return true;
  } catch (_error) {
    return false;
  }
}

function hasPrizeModelContent(model) {
  return Boolean(model?.placePrizes?.length || model?.tierPrizes?.length);
}

function getDefaultPrizeStatusMessage() {
  return hasPrizeModelContent(state.prizeModel)
    ? "טבלת הפרסים הקבועה כבר טעונה במערכת. העלאת קובץ פרסים היא אופציונלית בלבד ונועדה רק להחלפה יזומה."
    : "המערכת מוכנה לקבלת קבצים. קובץ לא תקין לא ידרוס את הנתונים הפעילים.";
}

function readStoredGoals() {
  try {
    const raw = window.localStorage.getItem(GOAL_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      total: Number(parsed?.total || 0),
      daily: Number(parsed?.daily || 0),
    };
  } catch (_error) {
    return { total: 0, daily: 0 };
  }
}

function storeGoals(goals) {
  try {
    window.localStorage.setItem(GOAL_STORAGE_KEY, JSON.stringify(goals));
    return true;
  } catch (_error) {
    return false;
  }
}

function getDefaultDonationState(campaignPage) {
  const firstAmount = Number(campaignPage?.amountCards?.[2]?.value || campaignPage?.amountCards?.[0]?.value || 0);
  return {
    frequency: "one_time",
    selectedAmount: firstAmount,
    customAmount: "",
    donorName: "",
    donorEmail: "",
    donorPhone: "",
    ambassador: "general",
    dedication: "",
    consent: true,
    message: "",
    tone: "",
  };
}

function syncDonationStateWithCampaignPage(currentDonation, campaignPage) {
  const next = {
    ...getDefaultDonationState(campaignPage),
    ...(currentDonation || {}),
  };
  const allowedAmounts = new Set((campaignPage?.amountCards || []).map((item) => Number(item.value || 0)));
  if (!campaignPage?.showRecurring) {
    next.frequency = "one_time";
  } else if (!["one_time", "monthly"].includes(String(next.frequency || ""))) {
    next.frequency = "one_time";
  }
  if (!allowedAmounts.has(Number(next.selectedAmount || 0))) {
    next.selectedAmount = Number(campaignPage?.amountCards?.[2]?.value || campaignPage?.amountCards?.[0]?.value || 0);
  }
  next.customAmount = String(next.customAmount || "");
  next.donorName = String(next.donorName || "");
  next.donorEmail = String(next.donorEmail || "");
  next.donorPhone = String(next.donorPhone || "");
  next.ambassador = String(next.ambassador || "general");
  next.dedication = String(next.dedication || "");
  next.message = "";
  next.tone = "";
  return next;
}

function readStoredCampaignPageSettings() {
  try {
    const raw = window.localStorage.getItem(CAMPAIGN_PAGE_SETTINGS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_error) {
    return null;
  }
}

function normalizeUrlSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
}

function deriveAmbassadorNicknameFromEmail(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const atIndex = normalizedEmail.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === normalizedEmail.length - 1) {
    return "";
  }
  return normalizeUrlSlug(normalizedEmail.slice(0, atIndex));
}

function normalizeAmbassadorDirectory(records) {
  if (!Array.isArray(records)) {
    return [];
  }
  const seen = new Set();
  return records
    .map((record) => {
      const fullName = String(record?.fullName || record?.name || "").trim();
      const email = String(record?.email || "").trim().toLowerCase();
      const phone = String(record?.phone || "").trim();
      const nickname = normalizeUrlSlug(record?.nickname || record?.slug || "") || deriveAmbassadorNicknameFromEmail(email);
      if (!fullName || !nickname) {
        return null;
      }
      return {
        fullName,
        email,
        phone,
        nickname,
        team: String(record?.team || "").trim(),
        personalTarget: Number(record?.personalTarget || 0),
        status: String(record?.status || "").trim().toLowerCase() || "active",
        registeredAt: String(record?.registeredAt || "").trim(),
        referredBy: String(record?.referredBy || "").trim(),
        wasAmbassadorBefore: record?.wasAmbassadorBefore ?? null,
        registrationSource: String(record?.registrationSource || "").trim(),
        isOver18: record?.isOver18 ?? null,
        understandsNotPacking: record?.understandsNotPacking ?? null,
        termsAccepted: record?.termsAccepted ?? null,
      };
    })
    .filter(Boolean)
    .filter((record) => {
      if (seen.has(record.nickname)) {
        return false;
      }
      seen.add(record.nickname);
      return true;
    });
}

function readStoredAmbassadorDirectory() {
  try {
    const raw = window.localStorage.getItem(AMBASSADOR_DIRECTORY_KEY);
    return raw ? normalizeAmbassadorDirectory(JSON.parse(raw)) : [];
  } catch (_error) {
    return [];
  }
}

function storeAmbassadorDirectory(records) {
  try {
    window.localStorage.setItem(AMBASSADOR_DIRECTORY_KEY, JSON.stringify(normalizeAmbassadorDirectory(records)));
    return true;
  } catch (_error) {
    return false;
  }
}

function setAmbassadorDirectoryStatus(message, tone = "neutral") {
  state.ui.ambassadorDirectoryStatus = {
    message: String(message || "עדיין לא נטען קובץ שגרירים. אפשר להעלות CSV כדי לייצר לינקים אישיים."),
    tone: String(tone || "neutral"),
  };
  const status = elements.campaignDesignerPanel?.querySelector("[data-ambassador-status]");
  if (!status) {
    return;
  }
  status.textContent = state.ui.ambassadorDirectoryStatus.message;
  if (state.ui.ambassadorDirectoryStatus.tone === "neutral") {
    status.removeAttribute("data-tone");
  } else {
    status.dataset.tone = state.ui.ambassadorDirectoryStatus.tone;
  }
}

function getAmbassadorDirectoryStatus() {
  return state.ui.ambassadorDirectoryStatus || {
    message: "עדיין לא נטען קובץ שגרירים. אפשר להעלות CSV כדי לייצר לינקים אישיים.",
    tone: "neutral",
  };
}

function getCampaignProjectSlug() {
  return normalizeUrlSlug(state.campaignPage?.projectSlug || INITIAL_CAMPAIGN_PAGE_SETTINGS.projectSlug || "campaign");
}

function getCampaignPlatformBaseUrl() {
  const fallback = String(INITIAL_CAMPAIGN_PAGE_SETTINGS.platformBaseUrl || window.location.origin || "").trim();
  const candidate = String(state.campaignPage?.platformBaseUrl || fallback).trim();
  try {
    return new URL(candidate, window.location.origin).toString().replace(/\/+$/, "");
  } catch (_error) {
    return String(window.location.origin || "").replace(/\/+$/, "");
  }
}

function buildAmbassadorPersonalUrl(record) {
  const baseUrl = getCampaignPlatformBaseUrl();
  const projectSlug = getCampaignProjectSlug();
  return `${baseUrl}/${projectSlug}/${normalizeUrlSlug(record?.nickname || "")}`;
}

function parseAmbassadorDirectoryCsv(text) {
  const rawRows = csvMatrixToRecords(parseCsv(text));
  const normalizeHeader = (value) => String(value || "")
    .replace(/^﻿/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  const pickValue = (row, keys) => {
    for (const key of keys) {
      if (row[key] !== undefined && row[key] !== null && String(row[key]).trim()) {
        return String(row[key]).trim();
      }
    }
    const aliases = keys.map(normalizeHeader);
    for (const [key, value] of Object.entries(row)) {
      const normalizedKey = normalizeHeader(key);
      if (value !== undefined && value !== null && String(value).trim() && aliases.some((alias) => normalizedKey === alias || normalizedKey.includes(alias))) {
        return String(value).trim();
      }
    }
    return "";
  };
  const parseRegistrationBoolean = (value) => {
    const normalized = String(value || "").trim().toLowerCase();
    if (["true", "1", "yes", "y", "כן", "מסכים", "מסכימה", "יודע", "יודעת"].includes(normalized) || /^(מסכימ|יודע)/.test(normalized)) return true;
    if (["false", "0", "no", "n", "לא"].includes(normalized)) return false;
    return null;
  };

  const missingRows = [];
  const duplicateNicknames = [];
  const generatedNicknames = [];
  const records = [];
  const seenNicknames = new Set();

  rawRows.forEach((row, index) => {
    const fullName = pickValue(row, ["full_name", "Full Name", "name", "Name", "שם מלא", "שם מלא של השגריר"]);
    const email = pickValue(row, ["email", "Email", "מייל", "דואל", "כתובת מייל"]);
    const phone = pickValue(row, ["phone", "Phone", "טלפון", "mobile", "מספר טלפון"]);
    const suppliedNickname = normalizeUrlSlug(pickValue(row, ["nickname", "Nickname", "alias", "slug", "כינוי"]));
    const nickname = suppliedNickname || deriveAmbassadorNicknameFromEmail(email);
    const team = pickValue(row, ["team", "Team", "group", "קבוצה", "צוות"]);
    const personalTarget = pickValue(row, ["personal_target", "target", "Target", "יעד אישי"]);
    const status = pickValue(row, ["status", "Status", "סטטוס"]);
    if (!fullName || !nickname) {
      missingRows.push(index + 2);
      return;
    }
    if (!suppliedNickname) {
      generatedNicknames.push(index + 2);
    }
    if (seenNicknames.has(nickname)) {
      duplicateNicknames.push(nickname);
      return;
    }
    seenNicknames.add(nickname);
    records.push({
      fullName,
      email,
      phone,
      nickname,
      team,
      personalTarget: Number(personalTarget || 0),
      status: String(status || "").trim().toLowerCase() || "active",
      registeredAt: pickValue(row, ["registered_at", "timestamp", "חותמת זמן"]),
      referredBy: pickValue(row, ["referred_by", "שם השגריר שהפנה אותך"]),
      wasAmbassadorBefore: parseRegistrationBoolean(pickValue(row, ["was_ambassador_before", "האם כבר היית שגריר בעבר"])),
      registrationSource: pickValue(row, ["registration_source", "איך הגעת לקישור הרשמה לשגרירים"]),
      isOver18: parseRegistrationBoolean(pickValue(row, ["is_over_18", "מעל גיל 18"])),
      understandsNotPacking: parseRegistrationBoolean(pickValue(row, ["understands_not_packing", "לא הקישור הרשמה לאריזות"])),
      termsAccepted: parseRegistrationBoolean(pickValue(row, ["terms_accepted", "מסכימ", "תקנון"])),
    });
  });

  return {
    records: normalizeAmbassadorDirectory(records),
    missingRows,
    duplicateNicknames,
    generatedNicknames,
    totalRows: rawRows.length,
  };
}

async function persistAmbassadorDirectoryToBackend(records, sourceLabel) {
  if (!canUseBackendAuth()) {
    return null;
  }
  if (!isManagerAuthenticated()) {
    throw new Error("נדרשת התחברות מנהל כדי לשמור שגרירים במסד הנתונים.");
  }
  const endpoint = buildScopedAdminEndpoint("ambassador-import", getActiveCampaignIdentity());
  if (!endpoint) {
    throw new Error("לא נמצאה זהות קמפיין לשמירת השגרירים.");
  }
  const { response, payload } = await authRequest(endpoint, {
    method: "POST",
    body: {
      records,
      sourceLabel: sourceLabel || "ambassador-registration-csv",
    },
  });
  if (!response.ok) {
    throw new Error(payload?.message || "שמירת השגרירים במסד הנתונים נכשלה.");
  }
  return payload;
}

function exportAmbassadorLinks(records) {
  const headers = ["full_name", "email", "phone", "nickname", "personal_url"];
  const lines = [headers.join(",")];
  records.forEach((record) => {
    const values = [
      record.fullName,
      record.email,
      record.phone,
      record.nickname,
      buildAmbassadorPersonalUrl(record),
    ].map((value) => `"${String(value || "").replaceAll('"', '""')}"`);
    lines.push(values.join(","));
  });
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${getCampaignProjectSlug()}-ambassador-links.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function buildAmbassadorFundraisingReport() {
  const raisedByAmbassador = new Map();
  // Apply the active time, donor, and amount filters to the ambassador report.
  // The report has its own ambassador search, so it intentionally keeps all ambassadors here.
  filterRows(state.rows, { includeAmbassador: false }).forEach((row) => {
    if (row?.status !== "success") return;
    const ambassador = normalizeSearchToken(row?.ambassador);
    const amount = Number(row?.amount || 0);
    if (!ambassador || !Number.isFinite(amount) || amount <= 0) return;
    raisedByAmbassador.set(ambassador, (raisedByAmbassador.get(ambassador) || 0) + amount);
  });
  return state.ambassadorDirectory
    .map((record) => {
      const ambassador = normalizeSearchToken(record.fullName);
      return {
        ...record,
        raisedAmount: Number((raisedByAmbassador.get(ambassador) || 0).toFixed(2)),
      };
    })
    .sort((left, right) => right.raisedAmount - left.raisedAmount || String(left.fullName || "").localeCompare(String(right.fullName || ""), "he"));
}

function getFilteredAmbassadorFundraisingReport() {
  const filters = state.ui.ambassadorReportFilters || {};
  const search = normalizeSearchToken(filters.search);
  const minimumAmount = Number(filters.minimumAmount || 0);
  const maximumAmount = filters.maximumAmount === "" ? null : Number(filters.maximumAmount);
  return buildAmbassadorFundraisingReport().filter((record) => {
    const searchable = normalizeSearchToken(`${record.fullName} ${record.email} ${record.phone} ${record.nickname}`);
    if (search && !searchable.includes(search)) return false;
    if (filters.fundraisingState === "zero" && record.raisedAmount !== 0) return false;
    if (filters.fundraisingState === "positive" && record.raisedAmount <= 0) return false;
    if (Number.isFinite(minimumAmount) && record.raisedAmount < minimumAmount) return false;
    if (maximumAmount !== null && Number.isFinite(maximumAmount) && record.raisedAmount > maximumAmount) return false;
    return true;
  });
}

function getAmbassadorsWithNoFundraising() {
  return buildAmbassadorFundraisingReport().filter((record) => {
    const ambassador = normalizeSearchToken(record.fullName);
    return ambassador && record.raisedAmount === 0;
  });
}

function exportAmbassadorFundraisingReport(records, fileName = "ambassador-fundraising-report.csv") {
  const headers = ["שם מלא", "מייל", "טלפון", "כינוי", "לינק אישי", "סכום גיוס"];
  const lines = [headers.join(",")];
  records.forEach((record) => {
    const values = [
      record.fullName,
      record.email,
      record.phone,
      record.nickname,
      buildAmbassadorPersonalUrl(record),
      record.raisedAmount,
    ].map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`);
    lines.push(values.join(","));
  });
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${getCampaignProjectSlug()}-${fileName}`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function getAmbassadorRecordByFullName(fullName) {
  const normalizedName = normalizeSearchToken(fullName);
  return state.ambassadorDirectory.find((record) => normalizeSearchToken(record.fullName) === normalizedName) || null;
}

function applyAmbassadorContextFromUrl() {
  const route = getCampaignRoute(window.location.href);
  const routeProjectSlug = normalizeUrlSlug(route.projectSlug);
  const routeAmbassadorSlug = normalizeUrlSlug(route.ambassadorSlug);
  if (!routeAmbassadorSlug) {
    return;
  }
  const currentProjectSlug = getCampaignProjectSlug();
  if (routeProjectSlug && currentProjectSlug && routeProjectSlug !== currentProjectSlug) {
    return;
  }
  const directoryMatch = state.ambassadorDirectory.find((record) => record.nickname === routeAmbassadorSlug);
  if (directoryMatch) {
    state.donation.ambassador = directoryMatch.fullName;
    return;
  }
  const fallbackMatch = buildLeaderboard(state.rows)
    .map((entry) => entry.ambassador)
    .find((ambassador) => normalizeUrlSlug(ambassador) === routeAmbassadorSlug);
  if (fallbackMatch) {
    state.donation.ambassador = fallbackMatch;
  }
}

function storeCampaignPageSettings(settings) {
  try {
    window.localStorage.setItem(CAMPAIGN_PAGE_SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch (_error) {
    return false;
  }
}

function setCampaignSettingsStatus(message, tone = "neutral") {
  state.ui.campaignSettingsStatus = {
    message: String(message || "ההגדרות נשמרות מקומית בדפדפן זה בלבד."),
    tone: String(tone || "neutral"),
  };
  const status = elements.campaignDesignerPanel?.querySelector("[data-settings-status]");
  if (!status) {
    return;
  }
  status.textContent = state.ui.campaignSettingsStatus.message;
  if (state.ui.campaignSettingsStatus.tone === "neutral") {
    status.removeAttribute("data-tone");
  } else {
    status.dataset.tone = state.ui.campaignSettingsStatus.tone;
  }
}

function getCampaignSettingsStatus() {
  return state.ui.campaignSettingsStatus || {
    message: "ההגדרות נשמרות מקומית בדפדפן זה בלבד.",
    tone: "neutral",
  };
}

function getCampaignBuilderStatus() {
  return state.ui.campaignBuilderStatus || {
    message: "טיוטת הקמפיין עדיין לא נשמרה בשרת.",
    tone: "neutral",
  };
}

function setCampaignBuilderStatus(message, tone = "neutral") {
  state.ui.campaignBuilderStatus = {
    message: String(message || "טיוטת הקמפיין עדיין לא נשמרה בשרת."),
    tone: String(tone || "neutral"),
  };
  const status = elements.campaignDesignerPanel?.querySelector("[data-builder-status]");
  if (!status) {
    return;
  }
  status.textContent = state.ui.campaignBuilderStatus.message;
  if (state.ui.campaignBuilderStatus.tone === "neutral") {
    status.removeAttribute("data-tone");
  } else {
    status.dataset.tone = state.ui.campaignBuilderStatus.tone;
  }
}

function setAnalysisProjectDatesStatus(message = "", tone = "neutral") {
  if (!elements.analysisProjectDatesStatus) {
    return;
  }
  elements.analysisProjectDatesStatus.textContent = String(message || "");
  if (!message || tone === "neutral") {
    elements.analysisProjectDatesStatus.removeAttribute("data-tone");
  } else {
    elements.analysisProjectDatesStatus.dataset.tone = tone;
  }
}

function getCampaignAnalysisDateValues() {
  const basics = state.campaignBuilder?.basics || {};
  return {
    startDate: String(basics.startDate || basics.startAt || "").slice(0, 10),
    endDate: String(basics.endDate || basics.endAt || "").slice(0, 10),
  };
}

function syncAnalysisProjectDateControls() {
  const { startDate, endDate } = getCampaignAnalysisDateValues();
  if (elements.analysisProjectStart) {
    elements.analysisProjectStart.value = startDate;
  }
  if (elements.analysisProjectEnd) {
    elements.analysisProjectEnd.value = endDate;
  }
}

function buildCampaignDateTime(date, time, fallbackTime) {
  const normalizedDate = String(date || "").trim();
  const normalizedTime = String(time || fallbackTime || "").trim().slice(0, 5);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalizedDate) && /^\d{2}:\d{2}$/.test(normalizedTime)
    ? `${normalizedDate}T${normalizedTime}:00`
    : "";
}

function applyAnalysisProjectWindowToMeta() {
  const { startDate, endDate } = getCampaignAnalysisDateValues();
  if (!startDate || !endDate || startDate > endDate) {
    return;
  }
  const projectDates = [];
  const cursor = new Date(`${startDate}T12:00:00.000Z`);
  const last = new Date(`${endDate}T12:00:00.000Z`);
  while (cursor <= last && projectDates.length < 730) {
    projectDates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  state.meta = {
    ...state.meta,
    projectDates,
    defaultFrom: projectDates[0],
    defaultTo: projectDates[projectDates.length - 1],
    projectWindowLabel: `${projectDates[0]} עד ${projectDates[projectDates.length - 1]}`,
  };
  state.rows = enrichRows(state.rows, state.meta);
}

async function saveAnalysisProjectDates() {
  const startDate = String(elements.analysisProjectStart?.value || "").trim();
  const endDate = String(elements.analysisProjectEnd?.value || "").trim();
  if (!startDate || !endDate) {
    throw new Error("יש לבחור תאריך התחלה ותאריך סיום לפרויקט.");
  }
  if (startDate > endDate) {
    throw new Error("תאריך סיום הפרויקט חייב להיות אחרי תאריך ההתחלה.");
  }

  const basics = state.campaignBuilder?.basics || {};
  state.campaignBuilder = normalizeCampaignBuilderConfig({
    ...state.campaignBuilder,
    basics: {
      ...basics,
      startDate,
      endDate,
      startAt: buildCampaignDateTime(startDate, basics.startTime, "00:00"),
      endAt: buildCampaignDateTime(endDate, basics.endTime, "23:59"),
    },
  });
  state.campaignPage = normalizeCampaignPageSettings({
    ...state.campaignPage,
    projectDatesLabel: buildProjectWindowLabelFromBasics(state.campaignBuilder.basics),
  });
  applyAnalysisProjectWindowToMeta();
  setAnalysisProjectDatesStatus("שומר את תאריכי הפרויקט...", "neutral");
  await saveCampaignBuilderConfig();
  await loadAdminDataset(getActiveCampaignIdentity());
  state.filters = getDefaultFilters(state.meta);
  resetFilterOptions();
  renderAll();
  setAnalysisProjectDatesStatus("תאריכי הפרויקט נשמרו והפילוחים עודכנו.", "success");
}

function persistCampaignPageSettings(
  settings,
  successMessage = "ההגדרות נשמרו מקומית בדפדפן זה.",
  failureMessage = "ההגדרות עודכנו בתצוגה הנוכחית, אבל לא נשמרו בדפדפן. ייתכן שנפח האחסון המקומי התמלא."
) {
  const persisted = storeCampaignPageSettings(settings);
  if (persisted) {
    setCampaignSettingsStatus(successMessage, "success");
    return true;
  }
  setCampaignSettingsStatus(failureMessage, "warning");
  return false;
}

function buildProjectWindowLabelFromBasics(basics) {
  const start = basics?.startDate ? formatDate(basics.startDate) : "";
  const end = basics?.endDate ? formatDate(basics.endDate) : "";
  if (start && end) {
    return `${start}–${end}`;
  }
  return start || end || INITIAL_CAMPAIGN_PAGE_SETTINGS.projectDatesLabel || "";
}

function createCampaignBuilderDefaults() {
  return {
    basics: {
      id: "",
      campaignName: String(INITIAL_CAMPAIGN_PAGE_SETTINGS.title || "").trim(),
      organizationId: "",
      organizationName: "",
      organizationSlug: "",
      slug: normalizeUrlSlug(INITIAL_CAMPAIGN_PAGE_SETTINGS.projectSlug || "campaign"),
      target: 0,
      currency: "ILS",
      startDate: String(INITIAL_META.defaultFrom || "").trim(),
      startTime: "00:00",
      endDate: String(INITIAL_META.defaultTo || "").trim(),
      endTime: "23:59",
      timeZone: "Asia/Jerusalem",
      status: "draft",
    },
    teams: {
      enabled: false,
      groups: [],
    },
    permissions: {
      admins: [],
      managers: [],
      viewers: [],
    },
    ambassadors: {
      importMode: "csv",
      personalTargetDefault: 0,
      manualDraft: {
        fullName: "",
        nickname: "",
        email: "",
        phone: "",
        team: "",
        personalTarget: "",
      },
    },
    goals: {
      ambassadorGoal: 0,
      teamGoal: 0,
      tierRuleNote: String(INITIAL_PRIZES?.tierRuleNote || "").trim(),
      sprintPrize: String(INITIAL_PRIZES?.sprintPrize || "").trim(),
      excludedAmbassadors: [...(INITIAL_PRIZES.excludedAmbassadors || [])],
    },
    templates: {
      type: "annual-recurring",
      duplicatedFromSlug: "",
    },
    review: {
      launchedAt: "",
    },
    ui: {
      previewMode: "desktop",
    },
    meta: {
      lastSavedAt: "",
      lastSavedBy: "",
    },
  };
}

function buildCampaignSnapshotFromStateParts(parts = {}) {
  const builder = normalizeCampaignBuilderConfig(parts.builderConfig);
  const campaignPage = normalizeCampaignPageSettings(parts.campaignPage || INITIAL_CAMPAIGN_PAGE_SETTINGS);
  const goals = {
    total: Number(parts.goals?.total || builder.basics.target || 0),
    daily: Number(parts.goals?.daily || 0),
  };
  const prizeModel = normalizePrizeModel(cloneSerializable(parts.prizeModel || INITIAL_PRIZES));
  const sourceConfig = normalizeSourceConfig(parts.sourceConfig || getDefaultSourceConfig());
  const ambassadorDirectory = normalizeAmbassadorDirectory(parts.ambassadorDirectory || []);
  return {
    basics: {
      ...builder.basics,
      slug: normalizeUrlSlug(builder.basics.slug || campaignPage.projectSlug || "campaign"),
      target: Number(goals.total || builder.basics.target || 0),
    },
    branding: {
      eyebrow: campaignPage.eyebrow,
      projectDatesLabel: campaignPage.projectDatesLabel,
      title: campaignPage.title,
      subtitle: campaignPage.subtitle,
      storyMarkdown: campaignPage.storyMarkdown,
      primaryCtaLabel: campaignPage.primaryCtaLabel,
      secondaryCtaLabel: campaignPage.secondaryCtaLabel,
      mediaType: campaignPage.mediaType,
      mediaUrl: campaignPage.mediaUrl,
      mediaAlt: campaignPage.mediaAlt,
      campaignLogoUrl: campaignPage.campaignLogoUrl,
      organizationLogoUrl: campaignPage.organizationLogoUrl,
      fontFamily: campaignPage.fontFamily,
      theme: cloneSerializable(campaignPage.theme),
    },
    donation: {
      externalDonationUrl: campaignPage.externalDonationUrl,
      trustNote: campaignPage.trustNote,
      successHint: campaignPage.successHint,
      showRecurring: campaignPage.showRecurring !== false,
      minimumDonation: Number(campaignPage.amountCards?.[0]?.value || 0),
      recommendedAmount: Number(campaignPage.amountCards?.[2]?.value || campaignPage.amountCards?.[0]?.value || 0),
      presets: cloneSerializable(campaignPage.amountCards || []),
    },
    ambassadors: {
      ...cloneSerializable(builder.ambassadors),
      records: cloneSerializable(ambassadorDirectory),
    },
    teams: cloneSerializable(builder.teams),
    goals: {
      ...cloneSerializable(builder.goals),
      campaignGoal: Number(goals.total || 0),
      dailyGoal: Number(goals.daily || 0),
      placePrizes: cloneSerializable(prizeModel.placePrizes || []),
      tierPrizes: cloneSerializable(prizeModel.tierPrizes || []),
      tierRuleNote: String(prizeModel.tierRuleNote || builder.goals?.tierRuleNote || "").trim(),
      sprintPrize: String(prizeModel.sprintPrize || builder.goals?.sprintPrize || "").trim(),
      excludedAmbassadors: [...(prizeModel.excludedAmbassadors || [])],
    },
    dataSource: cloneSerializable(sourceConfig),
    permissions: cloneSerializable(builder.permissions),
    templates: cloneSerializable(builder.templates),
    review: cloneSerializable(builder.review),
    ui: cloneSerializable(builder.ui),
    meta: cloneSerializable(builder.meta),
  };
}

function buildCampaignBuilderConfigFromSnapshot(snapshot, fallback = null) {
  if (!snapshot || typeof snapshot !== "object") {
    return normalizeCampaignBuilderConfig(fallback);
  }
  return normalizeCampaignBuilderConfig(snapshot);
}

function buildCampaignPageSettingsFromSnapshot(snapshot, fallback = null) {
  const base = normalizeCampaignPageSettings(fallback || INITIAL_CAMPAIGN_PAGE_SETTINGS);
  if (!snapshot || typeof snapshot !== "object") {
    return base;
  }
  const builder = normalizeCampaignBuilderConfig(snapshot);
  const branding = snapshot.branding && typeof snapshot.branding === "object" ? snapshot.branding : {};
  const donation = snapshot.donation && typeof snapshot.donation === "object" ? snapshot.donation : {};
  return normalizeCampaignPageSettings({
    ...base,
    projectSlug: builder.basics.slug || base.projectSlug,
    projectDatesLabel: buildProjectWindowLabelFromBasics(builder.basics) || branding.projectDatesLabel || base.projectDatesLabel,
    eyebrow: branding.eyebrow || base.eyebrow,
    title: branding.title || builder.basics.campaignName || base.title,
    subtitle: branding.subtitle || base.subtitle,
    storyMarkdown: branding.storyMarkdown || base.storyMarkdown,
    primaryCtaLabel: branding.primaryCtaLabel || base.primaryCtaLabel,
    secondaryCtaLabel: branding.secondaryCtaLabel || base.secondaryCtaLabel,
    externalDonationUrl: donation.externalDonationUrl || base.externalDonationUrl,
    trustNote: donation.trustNote || base.trustNote,
    successHint: donation.successHint || base.successHint,
    mediaType: branding.mediaType || base.mediaType,
    mediaUrl: branding.mediaUrl || base.mediaUrl,
    mediaAlt: branding.mediaAlt || base.mediaAlt,
    campaignLogoUrl: branding.campaignLogoUrl || base.campaignLogoUrl,
    organizationLogoUrl: branding.organizationLogoUrl || base.organizationLogoUrl,
    fontFamily: branding.fontFamily || base.fontFamily,
    theme: branding.theme || base.theme,
    amountCards: donation.presets || base.amountCards,
    showRecurring: donation.showRecurring !== false,
  });
}

function buildGoalsFromCampaignSnapshot(snapshot, fallback = null) {
  const base = {
    total: Number(fallback?.total || 0),
    daily: Number(fallback?.daily || 0),
  };
  if (!snapshot || typeof snapshot !== "object") {
    return base;
  }
  const builder = normalizeCampaignBuilderConfig(snapshot);
  const goals = snapshot.goals && typeof snapshot.goals === "object" ? snapshot.goals : {};
  return {
    total: Number(goals.campaignGoal || builder.basics.target || base.total || 0),
    daily: Number(goals.dailyGoal || base.daily || 0),
  };
}

function buildPrizeModelFromCampaignSnapshot(snapshot, fallback = null) {
  const base = normalizePrizeModel(cloneSerializable(fallback || INITIAL_PRIZES));
  if (!snapshot || typeof snapshot !== "object") {
    return base;
  }
  const goals = snapshot.goals && typeof snapshot.goals === "object" ? snapshot.goals : {};
  return normalizePrizeModel({
    placePrizes: cloneSerializable(goals.placePrizes || base.placePrizes || []),
    tierPrizes: cloneSerializable(goals.tierPrizes || base.tierPrizes || []),
    tierRuleNote: String(goals.tierRuleNote || base.tierRuleNote || "").trim(),
    sprintPrize: String(goals.sprintPrize || base.sprintPrize || "").trim(),
    excludedAmbassadors: [...(goals.excludedAmbassadors || base.excludedAmbassadors || [])],
  });
}

function buildSourceConfigFromCampaignSnapshot(snapshot, fallback = null) {
  if (!snapshot || typeof snapshot !== "object" || !snapshot.dataSource) {
    return normalizeSourceConfig(fallback || getDefaultSourceConfig());
  }
  return normalizeSourceConfig(snapshot.dataSource);
}

function buildAmbassadorDirectoryFromCampaignSnapshot(snapshot, fallback = null) {
  if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.ambassadors?.records)) {
    return normalizeAmbassadorDirectory(fallback || []);
  }
  return normalizeAmbassadorDirectory(snapshot.ambassadors.records);
}

function createDefaultCampaignSnapshot() {
  return buildCampaignSnapshotFromStateParts({
    builderConfig: normalizeCampaignBuilderConfig(null),
    campaignPage: normalizeCampaignPageSettings(cloneSerializable(INITIAL_CAMPAIGN_PAGE_SETTINGS)),
    goals: { total: 0, daily: 0 },
    prizeModel: cloneSerializable(INITIAL_PRIZES),
    sourceConfig: getDefaultSourceConfig(),
    ambassadorDirectory: [],
  });
}

function createCampaignRegistryEntry(config, overrides = {}) {
  const snapshot = buildCampaignSnapshotFromStateParts({
    builderConfig: buildCampaignBuilderConfigFromSnapshot(config),
    campaignPage: buildCampaignPageSettingsFromSnapshot(config, INITIAL_CAMPAIGN_PAGE_SETTINGS),
    goals: buildGoalsFromCampaignSnapshot(config),
    prizeModel: buildPrizeModelFromCampaignSnapshot(config),
    sourceConfig: buildSourceConfigFromCampaignSnapshot(config),
    ambassadorDirectory: buildAmbassadorDirectoryFromCampaignSnapshot(config),
  });
  const timestamp = new Date().toISOString();
  const campaignName = String(overrides.name || snapshot.basics.campaignName || "Campaign").trim() || "Campaign";
  const slug = normalizeUrlSlug(overrides.slug || snapshot.basics.slug || campaignName || "campaign") || "campaign";
  const idSeed = String(overrides.id || `${slug}-${Date.now()}`).trim();
  return {
    id: normalizeUrlSlug(idSeed) || `campaign-${Date.now()}`,
    name: campaignName,
    slug,
    updatedAt: String(overrides.updatedAt || snapshot.meta?.lastSavedAt || timestamp).trim(),
    updatedBy: normalizeSearchToken(overrides.updatedBy || snapshot.meta?.lastSavedBy || ""),
    config: snapshot,
  };
}

function normalizeCampaignRegistry(value) {
  const raw = value && typeof value === "object" ? value : {};
  const legacySnapshotCandidate =
    raw?.config && typeof raw.config === "object" && !Array.isArray(raw.config)
      ? raw.config
      : raw?.campaigns
        ? null
        : raw;
  const campaignCandidates = Array.isArray(raw.campaigns)
    ? raw.campaigns
    : legacySnapshotCandidate && Object.keys(legacySnapshotCandidate).length
      ? [
          {
            id: raw.id,
            name: raw.name,
            slug: raw.slug,
            updatedAt: raw.updatedAt,
            updatedBy: raw.updatedBy,
            config: legacySnapshotCandidate,
          },
        ]
      : [];
  const usedIds = new Set();
  const campaigns = campaignCandidates
    .map((item, index) => {
      const entry = createCampaignRegistryEntry(item?.config || item, {
        id: item?.id || `campaign-${index + 1}`,
        name: item?.name,
        slug: item?.slug,
        updatedAt: item?.updatedAt,
        updatedBy: item?.updatedBy,
      });
      let nextId = entry.id;
      let suffix = 2;
      while (!nextId || usedIds.has(nextId)) {
        nextId = `${entry.id || "campaign"}-${suffix}`;
        suffix += 1;
      }
      usedIds.add(nextId);
      return {
        ...entry,
        id: nextId,
      };
    })
    .filter((item) => item?.id && item?.config);
  const seededCampaigns = campaigns.length ? campaigns : [createCampaignRegistryEntry(createDefaultCampaignSnapshot())];
  const slugSet = new Set();
  seededCampaigns.forEach((item, index) => {
    let nextSlug = normalizeUrlSlug(item.slug || item.name || `campaign-${index + 1}`) || `campaign-${index + 1}`;
    let suffix = 2;
    while (slugSet.has(nextSlug)) {
      nextSlug = `${normalizeUrlSlug(item.slug || item.name || "campaign") || "campaign"}-${suffix}`;
      suffix += 1;
    }
    slugSet.add(nextSlug);
    item.slug = nextSlug;
    item.name = item.name || `Campaign ${index + 1}`;
    item.config = buildCampaignSnapshotFromStateParts({
      builderConfig: buildCampaignBuilderConfigFromSnapshot(item.config),
      campaignPage: buildCampaignPageSettingsFromSnapshot(item.config, INITIAL_CAMPAIGN_PAGE_SETTINGS),
      goals: buildGoalsFromCampaignSnapshot(item.config),
      prizeModel: buildPrizeModelFromCampaignSnapshot(item.config),
      sourceConfig: buildSourceConfigFromCampaignSnapshot(item.config),
      ambassadorDirectory: buildAmbassadorDirectoryFromCampaignSnapshot(item.config),
    });
    const organizationName = String(item.config.basics.organizationName || "").trim();
    const organizationSlug = normalizeUrlSlug(item.config.basics.organizationSlug || organizationName || "organization") || "organization";
    const organizationId = normalizeUrlSlug(item.config.basics.organizationId || organizationSlug) || organizationSlug;
    item.config.organization = {
      id: organizationId,
      slug: organizationSlug,
      name: organizationName || "Organization",
    };
    item.config.basics.id = item.id;
    item.config.basics.organizationId = organizationId;
    item.config.basics.organizationSlug = organizationSlug;
    item.config.basics.slug = item.slug;
    item.config.basics.campaignName = item.name;
    item.config.meta.lastSavedAt = String(item.updatedAt || item.config.meta?.lastSavedAt || "").trim();
    item.config.meta.lastSavedBy = normalizeSearchToken(item.updatedBy || item.config.meta?.lastSavedBy || "");
  });
  const activeCampaignId = seededCampaigns.some((item) => item.id === raw.activeCampaignId)
    ? raw.activeCampaignId
    : seededCampaigns[0].id;
  return {
    version: 1,
    activeCampaignId,
    campaigns: seededCampaigns,
  };
}

function readStoredCampaignRegistry() {
  try {
    const raw = window.localStorage.getItem(CAMPAIGN_REGISTRY_STORAGE_KEY);
    if (raw) {
      return normalizeCampaignRegistry(JSON.parse(raw));
    }
  } catch (_error) {
    return normalizeCampaignRegistry(null);
  }
  const legacySnapshot = buildCampaignSnapshotFromStateParts({
    builderConfig: readStoredCampaignBuilderConfig(),
    campaignPage: readStoredCampaignPageSettings() || INITIAL_CAMPAIGN_PAGE_SETTINGS,
    goals: readStoredGoals(),
    prizeModel: readStoredPrizeModel() || INITIAL_PRIZES,
    sourceConfig: getDefaultSourceConfig(),
    ambassadorDirectory: readStoredAmbassadorDirectory(),
  });
  return normalizeCampaignRegistry(legacySnapshot);
}

function storeCampaignRegistry(registry) {
  try {
    window.localStorage.setItem(CAMPAIGN_REGISTRY_STORAGE_KEY, JSON.stringify(normalizeCampaignRegistry(registry)));
    return true;
  } catch (_error) {
    return false;
  }
}

function getCampaignRegistryActiveEntry(registry = state?.campaignRegistry) {
  const normalized = normalizeCampaignRegistry(registry);
  return normalized.campaigns.find((item) => item.id === normalized.activeCampaignId) || normalized.campaigns[0] || null;
}

function getActiveCampaignIdentity(registry = state?.campaignRegistry, campaignId = state?.activeCampaignId || "") {
  const normalized = normalizeCampaignRegistry(registry);
  const serverScope = state?.auth?.currentScope && typeof state.auth.currentScope === "object" ? state.auth.currentScope : {};
  const targetEntry =
    normalized.campaigns.find((item) => item.id === String(campaignId || "").trim()) ||
    normalized.campaigns.find((item) => item.id === normalized.activeCampaignId) ||
    normalized.campaigns[0] ||
    null;
  const basics = targetEntry?.config?.basics && typeof targetEntry.config.basics === "object" ? targetEntry.config.basics : {};
  const organization = targetEntry?.config?.organization && typeof targetEntry.config.organization === "object" ? targetEntry.config.organization : {};
  const organizationName = String(organization.name || basics.organizationName || "").trim();
  const organizationSlug = String(
    organization.slug || basics.organizationSlug || normalizeUrlSlug(organizationName || "organization")
  ).trim();
  const campaignName = String(targetEntry?.name || basics.campaignName || "").trim();
  const campaignSlug = String(
    targetEntry?.slug || basics.slug || serverScope.campaignId || normalizeUrlSlug(campaignName || "campaign")
  ).trim();
  return {
    organizationId: String(serverScope.organizationId || organization.id || basics.organizationId || organizationSlug || "organization").trim(),
    organizationSlug,
    organizationName: organizationName || "Organization",
    campaignId: String(serverScope.campaignId || targetEntry?.id || basics.id || campaignSlug || "campaign").trim(),
    campaignSlug,
    campaignName: campaignName || "Campaign",
  };
}

function normalizeCampaignBuilderConfig(value) {
  const defaults = createCampaignBuilderDefaults();
  const candidate = value && typeof value === "object" ? value : {};
  const basics = candidate.basics && typeof candidate.basics === "object" ? candidate.basics : {};
  const teams = candidate.teams && typeof candidate.teams === "object" ? candidate.teams : {};
  const permissions = candidate.permissions && typeof candidate.permissions === "object" ? candidate.permissions : {};
  const ambassadors = candidate.ambassadors && typeof candidate.ambassadors === "object" ? candidate.ambassadors : {};
  const goals = candidate.goals && typeof candidate.goals === "object" ? candidate.goals : {};
  const templates = candidate.templates && typeof candidate.templates === "object" ? candidate.templates : {};
  const review = candidate.review && typeof candidate.review === "object" ? candidate.review : {};
  const uiState = candidate.ui && typeof candidate.ui === "object" ? candidate.ui : {};
  const meta = candidate.meta && typeof candidate.meta === "object" ? candidate.meta : {};
  return {
    basics: {
      id: normalizeUrlSlug(basics.id || ""),
      campaignName: String(basics.campaignName || defaults.basics.campaignName || "").trim(),
      organizationId: normalizeUrlSlug(basics.organizationId || ""),
      organizationName: String(basics.organizationName || defaults.basics.organizationName || "").trim(),
      organizationSlug: normalizeUrlSlug(basics.organizationSlug || ""),
      slug: normalizeUrlSlug(basics.slug || defaults.basics.slug || "campaign"),
      target: Number(basics.target || defaults.basics.target || 0),
      currency: ["ILS", "USD", "EUR"].includes(String(basics.currency || "").trim().toUpperCase())
        ? String(basics.currency).trim().toUpperCase()
        : defaults.basics.currency,
      startDate: String(basics.startDate || defaults.basics.startDate || "").trim(),
      startTime: String(basics.startTime || defaults.basics.startTime || "00:00").trim(),
      endDate: String(basics.endDate || defaults.basics.endDate || "").trim(),
      endTime: String(basics.endTime || defaults.basics.endTime || "23:59").trim(),
      startAt: String(basics.startAt || "").trim(),
      endAt: String(basics.endAt || "").trim(),
      timeZone: String(basics.timeZone || defaults.basics.timeZone || "Asia/Jerusalem").trim(),
      status: ["draft", "scheduled", "live", "paused", "completed", "archived"].includes(String(basics.status || "").trim().toLowerCase())
        ? String(basics.status).trim().toLowerCase()
        : defaults.basics.status,
    },
    teams: {
      enabled: Boolean(teams.enabled),
      groups: Array.isArray(teams.groups)
        ? teams.groups
            .map((group) => ({
              name: String(group?.name || "").trim(),
              manager: String(group?.manager || "").trim(),
              target: Number(group?.target || 0),
            }))
            .filter((group) => group.name)
        : [],
    },
    permissions: {
      admins: Array.isArray(permissions.admins) ? permissions.admins.map((item) => normalizeSearchToken(item)).filter(Boolean) : [],
      managers: Array.isArray(permissions.managers) ? permissions.managers.map((item) => normalizeSearchToken(item)).filter(Boolean) : [],
      viewers: Array.isArray(permissions.viewers) ? permissions.viewers.map((item) => normalizeSearchToken(item)).filter(Boolean) : [],
    },
    ambassadors: {
      importMode: String(ambassadors.importMode || defaults.ambassadors.importMode || "csv").trim().toLowerCase() === "manual" ? "manual" : "csv",
      personalTargetDefault: Number(ambassadors.personalTargetDefault || 0),
      manualDraft: {
        fullName: String(ambassadors.manualDraft?.fullName || "").trim(),
        nickname: normalizeUrlSlug(ambassadors.manualDraft?.nickname || ""),
        email: normalizeSearchToken(ambassadors.manualDraft?.email || ""),
        phone: String(ambassadors.manualDraft?.phone || "").trim(),
        team: String(ambassadors.manualDraft?.team || "").trim(),
        personalTarget: String(ambassadors.manualDraft?.personalTarget || "").trim(),
      },
    },
    goals: {
      ambassadorGoal: Number(goals.ambassadorGoal || 0),
      teamGoal: Number(goals.teamGoal || 0),
      tierRuleNote: String(goals.tierRuleNote || defaults.goals.tierRuleNote || "").trim(),
      sprintPrize: String(goals.sprintPrize || defaults.goals.sprintPrize || "").trim(),
      excludedAmbassadors: [...(goals.excludedAmbassadors || [])],
    },
    templates: {
      type: ["ambassador", "community", "emergency", "annual-recurring", "short", "long-running"].includes(String(templates.type || "").trim())
        ? String(templates.type).trim()
        : defaults.templates.type,
      duplicatedFromSlug: normalizeUrlSlug(templates.duplicatedFromSlug || ""),
    },
    review: {
      launchedAt: String(review.launchedAt || "").trim(),
    },
    ui: {
      previewMode: String(uiState.previewMode || defaults.ui.previewMode || "desktop").trim().toLowerCase() === "mobile" ? "mobile" : "desktop",
    },
    meta: {
      lastSavedAt: String(meta.lastSavedAt || "").trim(),
      lastSavedBy: normalizeSearchToken(meta.lastSavedBy || ""),
    },
  };
}

function readStoredCampaignBuilderConfig() {
  try {
    const raw = window.localStorage.getItem(CAMPAIGN_BUILDER_CONFIG_KEY);
    return raw ? normalizeCampaignBuilderConfig(JSON.parse(raw)) : normalizeCampaignBuilderConfig(null);
  } catch (_error) {
    return normalizeCampaignBuilderConfig(null);
  }
}

function storeCampaignBuilderConfig(config) {
  try {
    window.localStorage.setItem(CAMPAIGN_BUILDER_CONFIG_KEY, JSON.stringify(normalizeCampaignBuilderConfig(config)));
    return true;
  } catch (_error) {
    return false;
  }
}

function getCampaignBuilderSnapshot() {
  return buildCampaignSnapshotFromStateParts({
    builderConfig: state.campaignBuilder,
    campaignPage: state.campaignPage,
    goals: state.goals,
    prizeModel: state.prizeModel,
    sourceConfig: state.sourceConfig,
    ambassadorDirectory: state.ambassadorDirectory,
  });
}

function applyCampaignBuilderConfig(config, options = {}) {
  const raw = config && typeof config === "object" ? config : {};
  const normalized = normalizeCampaignBuilderConfig(raw);
  const branding = raw.branding && typeof raw.branding === "object" ? raw.branding : {};
  const donation = raw.donation && typeof raw.donation === "object" ? raw.donation : {};
  const goals = raw.goals && typeof raw.goals === "object" ? raw.goals : {};
  state.campaignBuilder = normalized;
  state.campaignPage = normalizeCampaignPageSettings({
    ...state.campaignPage,
    projectSlug: normalized.basics.slug,
    projectDatesLabel: buildProjectWindowLabelFromBasics(normalized.basics),
    eyebrow: branding.eyebrow || state.campaignPage.eyebrow,
    title: branding.title || normalized.basics.campaignName || state.campaignPage.title,
    subtitle: branding.subtitle || state.campaignPage.subtitle,
    storyMarkdown: branding.storyMarkdown || state.campaignPage.storyMarkdown,
    primaryCtaLabel: branding.primaryCtaLabel || state.campaignPage.primaryCtaLabel,
    secondaryCtaLabel: branding.secondaryCtaLabel || state.campaignPage.secondaryCtaLabel,
    externalDonationUrl: donation.externalDonationUrl || state.campaignPage.externalDonationUrl,
    trustNote: donation.trustNote || state.campaignPage.trustNote,
    successHint: donation.successHint || state.campaignPage.successHint,
    mediaType: branding.mediaType || state.campaignPage.mediaType,
    mediaUrl: branding.mediaUrl || state.campaignPage.mediaUrl,
    mediaAlt: branding.mediaAlt || state.campaignPage.mediaAlt,
    campaignLogoUrl: branding.campaignLogoUrl || state.campaignPage.campaignLogoUrl,
    organizationLogoUrl: branding.organizationLogoUrl || state.campaignPage.organizationLogoUrl,
    fontFamily: branding.fontFamily || state.campaignPage.fontFamily,
    theme: branding.theme || state.campaignPage.theme,
    amountCards: donation.presets || state.campaignPage.amountCards,
    showRecurring: donation.showRecurring !== false,
  });
  state.goals = {
    total: Number(goals.campaignGoal || normalized.basics.target || 0),
    daily: Number(goals.dailyGoal || 0),
  };
  state.prizeModel = normalizePrizeModel({
    placePrizes: cloneSerializable(goals.placePrizes || state.prizeModel?.placePrizes || []),
    tierPrizes: cloneSerializable(goals.tierPrizes || state.prizeModel?.tierPrizes || []),
    tierRuleNote: String(goals.tierRuleNote || state.prizeModel?.tierRuleNote || "").trim(),
    sprintPrize: String(goals.sprintPrize || state.prizeModel?.sprintPrize || "").trim(),
    excludedAmbassadors: [...(goals.excludedAmbassadors || [])],
  });
  if (!options.preserveSourceConfig && raw.dataSource) {
    state.sourceConfig = normalizeSourceConfig(raw.dataSource);
  }
  if (Array.isArray(raw.ambassadors?.records)) {
    state.ambassadorDirectory = normalizeAmbassadorDirectory(raw.ambassadors.records);
  }
  state.donation = syncDonationStateWithCampaignPage(state.donation, state.campaignPage);
}

function persistActiveCampaignLegacyState() {
  return [
    storeCampaignBuilderConfig(state.campaignBuilder),
    storeCampaignPageSettings(state.campaignPage),
    storeGoals(state.goals),
    storePrizeModel(state.prizeModel),
    storeAmbassadorDirectory(state.ambassadorDirectory),
  ].every(Boolean);
}

function syncCampaignRegistryFromState(options = {}) {
  const normalized = normalizeCampaignRegistry(state.campaignRegistry);
  const activeId = String(options.campaignId || state.activeCampaignId || normalized.activeCampaignId || "").trim();
  const snapshot = getCampaignBuilderSnapshot();
  const campaigns = normalized.campaigns.map((item) => {
    if (item.id !== activeId) {
      return item;
    }
    const nextEntry = createCampaignRegistryEntry(snapshot, {
      id: item.id,
      name: snapshot.basics.campaignName || item.name,
      slug: snapshot.basics.slug || item.slug,
      updatedAt: options.updatedAt || snapshot.meta?.lastSavedAt || item.updatedAt,
      updatedBy: options.updatedBy || snapshot.meta?.lastSavedBy || item.updatedBy,
    });
    nextEntry.config.meta.lastSavedAt = String(nextEntry.updatedAt || "").trim();
    nextEntry.config.meta.lastSavedBy = normalizeSearchToken(nextEntry.updatedBy || "");
    return nextEntry;
  });
  const nextRegistry = normalizeCampaignRegistry({
    ...normalized,
    activeCampaignId: activeId || normalized.activeCampaignId,
    campaigns,
  });
  state.campaignRegistry = nextRegistry;
  state.activeCampaignId = nextRegistry.activeCampaignId;
  if (options.persistRegistry !== false) {
    storeCampaignRegistry(nextRegistry);
  }
  if (options.persistLegacy !== false) {
    persistActiveCampaignLegacyState();
  }
  return nextRegistry;
}

async function switchActiveCampaign(campaignId, options = {}) {
  const currentRegistry = options.skipCurrentSync ? normalizeCampaignRegistry(state.campaignRegistry) : syncCampaignRegistryFromState({ persistRegistry: false });
  const nextRegistry = normalizeCampaignRegistry({
    ...currentRegistry,
    activeCampaignId: campaignId,
  });
  const targetEntry = getCampaignRegistryActiveEntry(nextRegistry);
  if (!targetEntry) {
    return false;
  }
  state.campaignRegistry = nextRegistry;
  state.activeCampaignId = targetEntry.id;
  applyCampaignBuilderConfig(targetEntry.config, { preserveSourceConfig: false });
  persistActiveCampaignLegacyState();
  storeCampaignRegistry(state.campaignRegistry);
  if (canUseBackendAuth() && isManagerAuthenticated()) {
    await loadProtectedManagerData(getActiveCampaignIdentity(nextRegistry, targetEntry.id));
  }
  if (options.message) {
    setCampaignBuilderStatus(options.message, "success");
  }
  return true;
}

function getUniqueCampaignName(baseName, registry = state.campaignRegistry) {
  const normalized = normalizeCampaignRegistry(registry);
  const preferred = String(baseName || "Campaign").trim() || "Campaign";
  const used = new Set(normalized.campaigns.map((item) => String(item.name || "").trim()));
  if (!used.has(preferred)) {
    return preferred;
  }
  let index = 2;
  while (used.has(`${preferred} ${index}`)) {
    index += 1;
  }
  return `${preferred} ${index}`;
}

function getUniqueCampaignSlug(baseSlug, registry = state.campaignRegistry) {
  const normalized = normalizeCampaignRegistry(registry);
  const preferred = normalizeUrlSlug(baseSlug || "campaign") || "campaign";
  const used = new Set(normalized.campaigns.map((item) => normalizeUrlSlug(item.slug || "")));
  if (!used.has(preferred)) {
    return preferred;
  }
  let index = 2;
  while (used.has(`${preferred}-${index}`)) {
    index += 1;
  }
  return `${preferred}-${index}`;
}

function createNewCampaignDraft() {
  const currentRegistry = syncCampaignRegistryFromState({ persistRegistry: false });
  const currentScope = getActiveCampaignIdentity(currentRegistry, currentRegistry.activeCampaignId);
  const snapshot = createDefaultCampaignSnapshot();
  const name = getUniqueCampaignName("קמפיין חדש", currentRegistry);
  const slug = getUniqueCampaignSlug("new-campaign", currentRegistry);
  snapshot.basics.campaignName = name;
  snapshot.basics.slug = slug;
  snapshot.organization = {
    ...(snapshot.organization || {}),
    id: currentScope.organizationId,
    slug: currentScope.organizationSlug,
    name: currentScope.organizationName,
  };
  snapshot.basics.organizationId = currentScope.organizationId;
  snapshot.basics.organizationSlug = currentScope.organizationSlug;
  snapshot.basics.organizationName = currentScope.organizationName;
  snapshot.branding.title = name;
  snapshot.branding.projectDatesLabel = buildProjectWindowLabelFromBasics(snapshot.basics);
  const entry = createCampaignRegistryEntry(snapshot, { name, slug });
  const nextRegistry = normalizeCampaignRegistry({
    ...currentRegistry,
    activeCampaignId: entry.id,
    campaigns: [...currentRegistry.campaigns, entry],
  });
  state.campaignRegistry = nextRegistry;
  state.activeCampaignId = entry.id;
  applyCampaignBuilderConfig(entry.config, { preserveSourceConfig: false });
  persistActiveCampaignLegacyState();
  storeCampaignRegistry(nextRegistry);
  setCampaignBuilderStatus(`נוצר קמפיין חדש: ${name}.`, "success");
  return entry;
}

function formatCampaignSavedAt(isoText) {
  if (!isoText) {
    return "טרם נשמר";
  }
  return formatDateTime(isoText);
}

function buildCampaignPreflight(snapshot) {
  const ready = [];
  const warnings = [];
  const blocking = [];
  const basics = snapshot.basics || {};
  const donation = snapshot.donation || {};
  const ambassadors = snapshot.ambassadors || {};
  const goals = snapshot.goals || {};
  const dataSource = snapshot.dataSource || {};
  const permissions = snapshot.permissions || {};

  if (basics.campaignName) {
    ready.push(`זהות קמפיין: ${basics.campaignName}`);
  } else {
    blocking.push("חסרה כותרת קמפיין.");
  }
  if (basics.slug) {
    ready.push(`Slug ציבורי: ${basics.slug}`);
  } else {
    blocking.push("חסר slug ציבורי.");
  }
  if (Number(basics.target || 0) > 0) {
    ready.push(`יעד קמפיין: ${formatAmount(basics.target)}`);
  } else {
    blocking.push("יש להגדיר יעד גיוס גדול מ־0.");
  }
  if (basics.startDate && basics.endDate) {
    ready.push(`חלון קמפיין: ${formatDate(basics.startDate)} עד ${formatDate(basics.endDate)}`);
    if (`${basics.endDate}T${basics.endTime || "23:59"}` < `${basics.startDate}T${basics.startTime || "00:00"}`) {
      blocking.push("תאריך/שעת הסיום מוקדמים מתאריך/שעת ההתחלה.");
    }
  } else {
    blocking.push("יש להגדיר תאריכי התחלה וסיום.");
  }
  if (donation.presets?.length) {
    ready.push(`${formatNumber(donation.presets.length)} סכומי תרומה מוכנים.`);
  } else {
    blocking.push("אין סכומי תרומה מוגדרים.");
  }
  if (donation.externalDonationUrl) {
    ready.push("קיים handoff לסליקה חיצונית.");
  } else {
    blocking.push("חסר קישור חיצוני להמשך התרומה.");
  }
  if (ambassadors.records?.length) {
    ready.push(`${formatNumber(ambassadors.records.length)} שגרירים מוכנים.`);
  } else {
    warnings.push("עדיין לא נטענו שגרירים.");
  }
  if (goals.placePrizes?.length || goals.tierPrizes?.length) {
    ready.push("מודל פרסים פעיל.");
  } else {
    warnings.push("אין טבלת פרסים פעילה.");
  }
  if (dataSource.mode === "api") {
    if (dataSource.api?.endpoint) {
      ready.push("חיבור API הוגדר.");
    } else {
      blocking.push("מצב API נבחר אך חסר endpoint.");
    }
  } else {
    warnings.push("המערכת במצב טעינת קובץ ולא במצב API.");
  }
  if ((permissions.admins?.length || 0) + (permissions.managers?.length || 0) > 0) {
    ready.push("הוגדרו בעלי גישה ניהולית לקמפיין.");
  } else {
    warnings.push("לא הוגדרו עדיין תפקידי מנהלים בתוך ה־builder.");
  }
  return { ready, warnings, blocking };
}

function setValueAtPath(target, path, rawValue) {
  const segments = String(path || "").split(".").filter(Boolean);
  if (!segments.length || !target || typeof target !== "object") {
    return;
  }
  let current = target;
  while (segments.length > 1) {
    const segment = segments.shift();
    if (!current[segment] || typeof current[segment] !== "object") {
      current[segment] = {};
    }
    current = current[segment];
  }
  current[segments[0]] = rawValue;
}

function parseEmailLines(text) {
  return String(text || "")
    .split(/\r?\n|,/)
    .map((item) => normalizeSearchToken(item))
    .filter(Boolean);
}

function serializeEmailLines(items) {
  return Array.isArray(items) ? items.join("\n") : "";
}

function applyCampaignTemplate(templateType) {
  const template = String(templateType || "").trim();
  const nextBuilder = normalizeCampaignBuilderConfig(state.campaignBuilder);
  nextBuilder.templates.type = template;
  if (template === "emergency") {
    nextBuilder.basics.status = "scheduled";
    nextBuilder.basics.endDate = nextBuilder.basics.startDate || nextBuilder.basics.endDate;
    state.campaignPage.primaryCtaLabel = "לתרומה מיידית";
  } else if (template === "community") {
    state.campaignPage.primaryCtaLabel = "מצטרפים לקמפיין הקהילתי";
  } else if (template === "long-running") {
    nextBuilder.basics.status = "live";
  } else {
    state.campaignPage.primaryCtaLabel = INITIAL_CAMPAIGN_PAGE_SETTINGS.primaryCtaLabel;
  }
  state.campaignBuilder = normalizeCampaignBuilderConfig(nextBuilder);
  queueCampaignBuilderAutosave("תבנית הקמפיין עודכנה ונשמרת בטיוטה.");
}

function duplicateCampaignBuilderDraft() {
  const currentRegistry = syncCampaignRegistryFromState({ persistRegistry: false });
  const snapshot = getCampaignBuilderSnapshot();
  const copyName = getUniqueCampaignName(`${snapshot.basics.campaignName || "Campaign"} Copy`, currentRegistry);
  const copySlug = getUniqueCampaignSlug(`${snapshot.basics.slug || "campaign"}-copy`, currentRegistry);
  snapshot.basics.campaignName = copyName;
  snapshot.basics.slug = copySlug;
  snapshot.basics.status = "draft";
  snapshot.templates = {
    ...snapshot.templates,
    duplicatedFromSlug: getCampaignProjectSlug(),
  };
  snapshot.review = {
    ...snapshot.review,
    launchedAt: "",
  };
  snapshot.meta = {
    ...snapshot.meta,
    lastSavedAt: "",
    lastSavedBy: "",
  };
  snapshot.branding.title = copyName;
  const entry = createCampaignRegistryEntry(snapshot, { name: copyName, slug: copySlug });
  const nextRegistry = normalizeCampaignRegistry({
    ...currentRegistry,
    activeCampaignId: entry.id,
    campaigns: [...currentRegistry.campaigns, entry],
  });
  state.campaignRegistry = nextRegistry;
  state.activeCampaignId = entry.id;
  applyCampaignBuilderConfig(entry.config, { preserveSourceConfig: false });
  persistActiveCampaignLegacyState();
  storeCampaignRegistry(nextRegistry);
  setCampaignBuilderStatus(`נוצר קמפיין משוכפל חדש עבור ${copyName}.`, "success");
  renderCampaignDesigner(true);
  renderProjectPage();
}

let campaignBuilderAutosaveTimerId = 0;

function clearCampaignBuilderAutosaveTimer() {
  if (campaignBuilderAutosaveTimerId) {
    window.clearTimeout(campaignBuilderAutosaveTimerId);
    campaignBuilderAutosaveTimerId = 0;
  }
}

function queueCampaignBuilderAutosave(message = "טיוטת הקמפיין נשמרת...") {
  clearCampaignBuilderAutosaveTimer();
  setCampaignBuilderStatus(message, "neutral");
  campaignBuilderAutosaveTimerId = window.setTimeout(() => {
    void saveCampaignBuilderConfig({ silent: true });
  }, 700);
}

async function saveCampaignBuilderConfig(options = {}) {
  const snapshot = getCampaignBuilderSnapshot();
  const localRegistry = syncCampaignRegistryFromState({ persistRegistry: false, persistLegacy: false });
  const scope = getActiveCampaignIdentity(localRegistry, localRegistry.activeCampaignId);
  const persistedLocal = [storeCampaignRegistry(localRegistry), persistActiveCampaignLegacyState()].every(Boolean);
  if (!persistedLocal && !options.silent) {
    setCampaignBuilderStatus("חלק מהטיוטה לא נשמר מקומית בדפדפן.", "warning");
  }
  const endpoint = buildScopedAdminEndpoint("campaign-config", scope);
  if (!canUseBackendAuth() || !endpoint || !isManagerAuthenticated()) {
    state.campaignBuilder.meta.lastSavedAt = new Date().toISOString();
    state.campaignBuilder.meta.lastSavedBy = state.session?.email || "";
    syncCampaignRegistryFromState({
      updatedAt: state.campaignBuilder.meta.lastSavedAt,
      updatedBy: state.campaignBuilder.meta.lastSavedBy,
    });
    setCampaignBuilderStatus(`טיוטת קמפיין נשמרה מקומית | ${formatCampaignSavedAt(state.campaignBuilder.meta.lastSavedAt)}`, "success");
    return snapshot;
  }
  const { response, payload } = await authRequest(endpoint, {
    method: "POST",
    body: { config: localRegistry },
  });
  if (!response.ok) {
    throw new Error(payload?.message || "שמירת טיוטת הקמפיין בשרת נכשלה.");
  }
  applyServerScope(payload, scope);
  state.campaignBuilder.meta.lastSavedAt = payload?.updatedAt || new Date().toISOString();
  state.campaignBuilder.meta.lastSavedBy = payload?.updatedBy || state.session?.email || "";
  state.campaignRegistry = normalizeCampaignRegistry(payload?.config || localRegistry);
  state.activeCampaignId = state.campaignRegistry.activeCampaignId;
  syncCampaignRegistryFromState({
    updatedAt: state.campaignBuilder.meta.lastSavedAt,
    updatedBy: state.campaignBuilder.meta.lastSavedBy,
  });
  setCampaignBuilderStatus(`נשמר בשרת | ${formatCampaignSavedAt(state.campaignBuilder.meta.lastSavedAt)}`, "success");
  return getCampaignRegistryActiveEntry(state.campaignRegistry)?.config || snapshot;
}

async function hydrateCampaignBuilderConfig(scope = getActiveCampaignIdentity()) {
  const localRegistry = readStoredCampaignRegistry();
  state.campaignRegistry = localRegistry;
  state.activeCampaignId = localRegistry.activeCampaignId;
  const localEntry = getCampaignRegistryActiveEntry(localRegistry);
  if (localEntry?.config) {
    applyCampaignBuilderConfig(localEntry.config, { preserveSourceConfig: false });
  } else {
    const localConfig = readStoredCampaignBuilderConfig();
    state.campaignBuilder = normalizeCampaignBuilderConfig(localConfig);
    applyCampaignBuilderConfig(getCampaignBuilderSnapshot(), { preserveSourceConfig: false });
  }
  persistActiveCampaignLegacyState();
  storeCampaignRegistry(state.campaignRegistry);
  const endpoint = buildScopedAdminEndpoint("campaign-config", scope);
  if (!canUseBackendAuth() || !endpoint || !isManagerAuthenticated()) {
    state.auth.campaignConfigLoaded = false;
    return state.campaignBuilder;
  }
  try {
    const { response, payload } = await authRequest(endpoint);
    if (response.ok && payload?.config) {
      applyServerScope(payload, scope);
      state.campaignRegistry = normalizeCampaignRegistry(payload.config);
      state.activeCampaignId = state.campaignRegistry.activeCampaignId;
      const activeEntry = getCampaignRegistryActiveEntry(state.campaignRegistry);
      if (activeEntry?.config) {
        applyCampaignBuilderConfig(activeEntry.config, { preserveSourceConfig: false });
      }
      state.auth.campaignConfigLoaded = true;
      state.campaignBuilder.meta.lastSavedAt = String(payload.updatedAt || "").trim();
      state.campaignBuilder.meta.lastSavedBy = normalizeSearchToken(payload.updatedBy || "");
      syncCampaignRegistryFromState({
        updatedAt: state.campaignBuilder.meta.lastSavedAt,
        updatedBy: state.campaignBuilder.meta.lastSavedBy,
      });
      setCampaignBuilderStatus(`נטען מהשרת | ${formatCampaignSavedAt(state.campaignBuilder.meta.lastSavedAt)}`, "success");
      return state.campaignBuilder;
    }
  } catch (_error) {
    state.auth.campaignConfigLoaded = false;
  }
  setCampaignBuilderStatus("לא נטענה טיוטת שרת. עובדים כרגע על הגדרות מקומיות.", "warning");
  return state.campaignBuilder;
}

function readStoredAdminEmail() {
  try {
    return normalizeSearchToken(window.localStorage.getItem(LAST_ADMIN_EMAIL_KEY) || "");
  } catch (_error) {
    return "";
  }
}

function storeAdminEmail(email) {
  try {
    const normalized = normalizeSearchToken(email || "");
    if (!normalized) {
      window.localStorage.removeItem(LAST_ADMIN_EMAIL_KEY);
      return;
    }
    window.localStorage.setItem(LAST_ADMIN_EMAIL_KEY, normalized);
  } catch (_error) {
    return;
  }
}

function sanitizeHexColor(value, fallback) {
  const normalized = String(value || "").trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(normalized) ? normalized : fallback;
}

function normalizeAmountCards(rawCards) {
  if (!Array.isArray(rawCards)) {
    return cloneSerializable(INITIAL_CAMPAIGN_PAGE_SETTINGS.amountCards || []);
  }
  const normalized = rawCards
    .map((item) => ({
      value: Number(item?.value || 0),
      label: String(item?.label || "").trim(),
      description: String(item?.description || "").trim(),
    }))
    .filter((item) => Number.isFinite(item.value) && item.value > 0 && item.label);
  return normalized.length ? normalized : cloneSerializable(INITIAL_CAMPAIGN_PAGE_SETTINGS.amountCards || []);
}

function normalizeStats(rawStats) {
  if (!Array.isArray(rawStats)) {
    return cloneSerializable(INITIAL_CAMPAIGN_PAGE_SETTINGS.stats || []);
  }
  const normalized = rawStats
    .map((item) => ({
      value: String(item?.value || "").trim(),
      label: String(item?.label || "").trim(),
    }))
    .filter((item) => item.value && item.label);
  return normalized.length ? normalized : cloneSerializable(INITIAL_CAMPAIGN_PAGE_SETTINGS.stats || []);
}

function normalizeCampaignPageSettings(value) {
  const defaults = cloneSerializable(INITIAL_CAMPAIGN_PAGE_SETTINGS);
  const candidate = value && typeof value === "object" ? value : {};
  return {
    projectDatesLabel: String(candidate.projectDatesLabel || defaults.projectDatesLabel || "").trim(),
    platformBaseUrl: String(candidate.platformBaseUrl || defaults.platformBaseUrl || "").trim(),
    projectSlug: normalizeUrlSlug(candidate.projectSlug || defaults.projectSlug || "campaign"),
    eyebrow: String(candidate.eyebrow || defaults.eyebrow || "").trim(),
    title: String(candidate.title || defaults.title || "").trim(),
    subtitle: String(candidate.subtitle || defaults.subtitle || "").trim(),
    storyMarkdown: String(candidate.storyMarkdown || defaults.storyMarkdown || "").trim(),
    primaryCtaLabel: String(candidate.primaryCtaLabel || defaults.primaryCtaLabel || "").trim(),
    secondaryCtaLabel: String(candidate.secondaryCtaLabel || defaults.secondaryCtaLabel || "").trim(),
    externalDonationUrl: String(candidate.externalDonationUrl || defaults.externalDonationUrl || "").trim(),
    trustNote: String(candidate.trustNote || defaults.trustNote || "").trim(),
    successHint: String(candidate.successHint || defaults.successHint || "").trim(),
    mediaType: candidate.mediaType === "video" ? "video" : "image",
    mediaUrl: String(candidate.mediaUrl || defaults.mediaUrl || "").trim(),
    mediaAlt: String(candidate.mediaAlt || defaults.mediaAlt || "").trim(),
    campaignLogoUrl: String(candidate.campaignLogoUrl || defaults.campaignLogoUrl || "").trim(),
    organizationLogoUrl: String(candidate.organizationLogoUrl || defaults.organizationLogoUrl || "").trim(),
    fontFamily: ["Assistant", "Heebo", "Rubik", "Arial"].includes(String(candidate.fontFamily || ""))
      ? String(candidate.fontFamily)
      : defaults.fontFamily,
    theme: {
      primary: sanitizeHexColor(candidate.theme?.primary, defaults.theme.primary),
      secondary: sanitizeHexColor(candidate.theme?.secondary, defaults.theme.secondary),
      accent: sanitizeHexColor(candidate.theme?.accent, defaults.theme.accent),
      surface: sanitizeHexColor(candidate.theme?.surface, defaults.theme.surface),
      text: sanitizeHexColor(candidate.theme?.text, defaults.theme.text),
    },
    amountCards: normalizeAmountCards(candidate.amountCards),
    stats: normalizeStats(candidate.stats),
    showRecurring: candidate.showRecurring !== false,
  };
}

function parseAmountCardText(text) {
  const cards = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [valueText, labelText = "", descriptionText = ""] = line.split("|");
      return {
        value: Number(valueText),
        label: labelText.trim(),
        description: descriptionText.trim(),
      };
    })
    .filter((item) => Number.isFinite(item.value) && item.value > 0 && item.label);
  return normalizeAmountCards(cards);
}

function formatAmountCardText(cards) {
  return (cards || [])
    .map((item) => `${Number(item.value)}|${item.label}|${item.description || ""}`)
    .join("\n");
}

function canUseBackendAuth() {
  return AUTH_CONFIG?.mode === "backend" && ["http:", "https:"].includes(window.location.protocol);
}

function getLocalAdminEntryHint() {
  return "כדי להיכנס לפאנל הניהול יש לפתוח את המערכת דרך כתובת המערכת בדפדפן ולא דרך קובץ file:// מקומי.";
}

function buildAuthUrl(path) {
  const baseUrl = String(AUTH_CONFIG?.baseUrl || "").trim().replace(/\/$/, "");
  return baseUrl ? `${baseUrl}${path}` : path;
}

function getFallbackAdminEndpoint(kind) {
  if (kind === "dataset") {
    return AUTH_CONFIG?.datasetEndpoint || "";
  }
  if (kind === "campaign-config") {
    return AUTH_CONFIG?.campaignConfigEndpoint || "";
  }
  if (kind === "source-config") {
    return AUTH_CONFIG?.sourceConfigEndpoint || "";
  }
  if (kind === "source-refresh") {
    return AUTH_CONFIG?.sourceRefreshEndpoint || "";
  }
  return "";
}

function buildScopedAdminEndpoint(kind, scope = getActiveCampaignIdentity()) {
  if (!canUseBackendAuth()) {
    return getFallbackAdminEndpoint(kind);
  }
  const organizationId = String(scope?.organizationId || "").trim();
  const campaignId = String(scope?.campaignId || "").trim();
  if (!organizationId || !campaignId) {
    return getFallbackAdminEndpoint(kind);
  }
  const encodedOrganizationId = encodeURIComponent(organizationId);
  const encodedCampaignId = encodeURIComponent(campaignId);
  const basePath = `/api/organizations/${encodedOrganizationId}/campaigns/${encodedCampaignId}`;
  if (kind === "campaign-config") {
    return buildAuthUrl(basePath);
  }
  if (kind === "dataset") {
    return buildAuthUrl(`${basePath}/dataset`);
  }
  if (kind === "source-config") {
    return buildAuthUrl(`${basePath}/source`);
  }
  if (kind === "source-refresh") {
    return buildAuthUrl(`${basePath}/source/refresh`);
  }
  if (kind === "ambassador-import") {
    return buildAuthUrl(`${basePath}/ambassadors/import`);
  }
  if (kind === "manual-contribution") {
    return buildAuthUrl(`${basePath}/manual-contributions`);
  }
  if (kind === "insight-question") {
    return buildAuthUrl(`${basePath}/insights/questions`);
  }
  return getFallbackAdminEndpoint(kind);
}

async function fetchPublicContext(options = {}) {
  if (!isManagerAuthenticated()) return null;
  const contextEndpoint = String(AUTH_CONFIG?.publicContextEndpoint || "").trim();
  if (!contextEndpoint) {
    return null;
  }
  const endpoint = new URL(contextEndpoint, window.location.origin);
  const route = getCampaignRoute(window.location.href);
  if (route.projectSlug) endpoint.searchParams.set("project", route.projectSlug);
  const query = new URLSearchParams(window.location.search);
  for (const key of ["organization", "organizationId", "campaignId"]) {
    if (query.has(key)) endpoint.searchParams.set(key, query.get(key));
  }
  if (!options.refresh && state?.auth?.publicScope?.organizationId && state?.auth?.publicScope?.campaignId) {
    return {
      organizationId: state.auth.publicScope.organizationId,
      campaignId: state.auth.publicScope.campaignId,
    };
  }
  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        "cache-control": "no-store",
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return null;
    }
    const scope = resolvePreferredCampaignScope(payload, { organizationId: "", campaignId: "" });
    if (!scope.organizationId || !scope.campaignId) {
      return null;
    }
    applyServerScope(payload, scope);
    state.auth.publicScope = {
      organizationId: scope.organizationId,
      campaignId: scope.campaignId,
    };
    return scope;
  } catch (_error) {
    return null;
  }
}

function applyServerScope(payload = {}, fallbackScope = getActiveCampaignIdentity()) {
  const summaries = Array.isArray(payload?.accessibleCampaigns)
    ? payload.accessibleCampaigns
    : Array.isArray(payload?.portfolio)
      ? payload.portfolio
      : [];
  const preferredScope = resolvePreferredCampaignScope(payload, fallbackScope);
  const firstSummaryScope = summaries.length ? buildScopeFromCampaignSummary(summaries[0]) : { organizationId: "", campaignId: "" };
  const organizationId = String(
    payload?.organizationId ||
    payload?.organization?.id ||
    payload?.activeCampaign?.organizationId ||
    preferredScope.organizationId ||
    firstSummaryScope.organizationId ||
    fallbackScope?.organizationId ||
    ""
  ).trim();
  const campaignId = String(
    payload?.campaignId ||
    payload?.campaign?.id ||
    payload?.activeCampaign?.campaignId ||
    preferredScope.campaignId ||
    firstSummaryScope.campaignId ||
    fallbackScope?.campaignId ||
    ""
  ).trim();
  state.auth.currentScope = {
    organizationId,
    campaignId,
  };
  state.auth.accessibleCampaigns = summaries;
  syncActiveCampaignRegistryWithScope(state.auth.currentScope);
  // Real links also retain the selected campaign when opened in another tab.
  root.querySelectorAll(".site-header [data-page-target]").forEach((link) => {
    const url = new URL(`/${link.dataset.pageTarget}`, window.location.origin);
    if (organizationId && campaignId) {
      url.searchParams.set("organizationId", organizationId);
      url.searchParams.set("campaignId", campaignId);
    }
    const ambassador = getCampaignRoute(window.location.href).ambassadorSlug;
    if (ambassador) url.searchParams.set("ambassador", ambassador);
    link.href = `${url.pathname}${url.search}`;
  });
}

function buildScopeFromCampaignSummary(summary = {}) {
  return {
    organizationId: String(summary?.organizationId || summary?.organizationSlug || "").trim(),
    campaignId: String(summary?.campaignId || summary?.campaignSlug || "").trim(),
  };
}

function getCampaignStatusPriority(status) {
  switch (String(status || "").trim().toLowerCase()) {
    case "live":
      return 40;
    case "completed":
      return 32;
    case "scheduled":
      return 18;
    case "paused":
      return 8;
    case "draft":
      return 0;
    case "archived":
      return -20;
    default:
      return 0;
  }
}

function scoreCampaignSummary(summary = {}, fallbackScope = {}) {
  const scope = buildScopeFromCampaignSummary(summary);
  if (!scope.organizationId || !scope.campaignId) {
    return Number.NEGATIVE_INFINITY;
  }

  const fallbackOrganizationId = String(fallbackScope?.organizationId || "").trim();
  const fallbackCampaignId = String(fallbackScope?.campaignId || "").trim();
  const currentProjectSlug = getCampaignProjectSlug();
  const activeRegistryEntry = getCampaignRegistryActiveEntry();
  const activeRegistrySlug = normalizeUrlSlug(
    activeRegistryEntry?.slug ||
    activeRegistryEntry?.config?.basics?.slug ||
    ""
  );
  const summaryCampaignSlug = normalizeUrlSlug(summary?.campaignSlug || summary?.slug || "");
  const rowCount = Number(summary?.rowCount ?? summary?.datasetRecordCount ?? 0) || 0;
  const raised = Number(summary?.raised ?? 0) || 0;
  let score = 0;

  if (
    fallbackOrganizationId &&
    fallbackCampaignId &&
    scope.organizationId === fallbackOrganizationId &&
    scope.campaignId === fallbackCampaignId
  ) {
    score += 80;
  }
  if (summaryCampaignSlug && currentProjectSlug && summaryCampaignSlug === currentProjectSlug) {
    score += 260;
  }
  if (summaryCampaignSlug && activeRegistrySlug && summaryCampaignSlug === activeRegistrySlug) {
    score += 120;
  }
  if (rowCount > 0) {
    score += 220 + Math.min(rowCount, 500);
  }
  if (raised > 0) {
    score += 140 + Math.min(raised, 1000000) / 1000;
  }
  score += getCampaignStatusPriority(summary?.status);
  return score;
}

function syncActiveCampaignRegistryWithScope(scope = state?.auth?.currentScope) {
  const organizationId = String(scope?.organizationId || "").trim();
  const campaignId = String(scope?.campaignId || "").trim();
  if (!organizationId || !campaignId) {
    return;
  }
  const normalized = normalizeCampaignRegistry(state.campaignRegistry);
  const matchedEntry = normalized.campaigns.find((item) => {
    const basics = item?.config?.basics && typeof item.config.basics === "object" ? item.config.basics : {};
    const candidateIds = [
      item?.id,
      item?.slug,
      basics?.id,
      basics?.slug,
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    return candidateIds.includes(campaignId);
  });
  if (!matchedEntry || normalized.activeCampaignId === matchedEntry.id) {
    return;
  }
  normalized.activeCampaignId = matchedEntry.id;
  state.campaignRegistry = normalized;
  state.activeCampaignId = matchedEntry.id;
  persistActiveCampaignLegacyState();
  storeCampaignRegistry(normalized);
}

function resolvePreferredCampaignScope(payload = {}, fallbackScope = getActiveCampaignIdentity()) {
  const directScope = {
    organizationId: String(payload?.organizationId || payload?.organization?.id || payload?.activeCampaign?.organizationId || "").trim(),
    campaignId: String(payload?.campaignId || payload?.campaign?.id || payload?.activeCampaign?.campaignId || "").trim(),
  };
  if (directScope.organizationId && directScope.campaignId) {
    return directScope;
  }

  const summaries = Array.isArray(payload?.accessibleCampaigns)
    ? payload.accessibleCampaigns
    : Array.isArray(payload?.portfolio)
      ? payload.portfolio
      : [];
  if (summaries.length) {
    const rankedSummaries = [...summaries]
      .map((summary) => ({
        summary,
        score: scoreCampaignSummary(summary, fallbackScope),
      }))
      .sort((left, right) => right.score - left.score);
    const summaryScope = buildScopeFromCampaignSummary(rankedSummaries[0]?.summary || summaries[0]);
    if (summaryScope.organizationId && summaryScope.campaignId) {
      return summaryScope;
    }
  }

  return {
    organizationId: String(fallbackScope?.organizationId || "").trim(),
    campaignId: String(fallbackScope?.campaignId || "").trim(),
  };
}

function canUseLocalPasswordReset() {
  if (!canUseBackendAuth() || !AUTH_CONFIG?.resetEndpoint) {
    return false;
  }
  return ["127.0.0.1", "localhost"].includes(window.location.hostname);
}

function setSetupMode(enabled) {
  state.auth.setupMode = Boolean(enabled);
  if (elements.loginPasswordConfirmLabel) {
    elements.loginPasswordConfirmLabel.hidden = !state.auth.setupMode;
    elements.loginPasswordConfirmLabel.style.display = state.auth.setupMode ? "" : "none";
  }
  if (elements.loginPasswordConfirm) {
    elements.loginPasswordConfirm.required = state.auth.setupMode;
    elements.loginPasswordConfirm.hidden = !state.auth.setupMode;
    elements.loginPasswordConfirm.style.display = state.auth.setupMode ? "" : "none";
    if (!state.auth.setupMode) {
      elements.loginPasswordConfirm.value = "";
    }
  }
  if (elements.loginPasswordSetupNote) {
    elements.loginPasswordSetupNote.hidden = !state.auth.setupMode;
    elements.loginPasswordSetupNote.style.display = state.auth.setupMode ? "" : "none";
  }
  if (elements.loginButton) {
    elements.loginButton.textContent = state.auth.setupMode ? "שמירת סיסמה וכניסה" : "כניסה לפאנל הניהול";
  }
  if (elements.loginModeHint) {
    if (!canUseBackendAuth()) {
      elements.loginModeHint.textContent = getLocalAdminEntryHint();
    } else {
      elements.loginModeHint.textContent = state.auth.setupMode
        ? "זו כניסה ראשונה למייל הזה. בחרו סיסמה אישית, אשרו אותה והמערכת תשמור אותה באופן מאובטח."
        : "הגישה לנתוני הקמפיין זמינה למנהלים מורשים בלבד.";
    }
  }
  if (elements.loginPassword) {
    elements.loginPassword.autocomplete = state.auth.setupMode ? "new-password" : "current-password";
  }
  if (elements.loginResetButton) {
    elements.loginResetButton.hidden = !canUseLocalPasswordReset();
  }
}

function setAuthenticatedSession(payload) {
  const normalized = payload?.authenticated && payload?.email ? normalizeSearchToken(payload.email) : "";
  state.session = normalized ? { ...payload, email: normalized } : null;
  setSiteSession(state.session);
  if (normalized) {
    storeAdminEmail(normalized);
    if (elements.loginEmail) {
      elements.loginEmail.value = normalized;
    }
  }
}

function clearSessionState() {
  state.session = null;
  setSiteSession(null);
  state.auth.campaignAccessError = "";
  state.auth.accessibleCampaigns = [];
  state.auth.publicScope = {
    organizationId: "",
    campaignId: "",
  };
  state.auth.currentScope = {
    organizationId: "",
    campaignId: "",
  };
  state.auth.campaignConfigLoaded = false;
  setSetupMode(false);
  clearSourceRefreshTimer();
  restorePublicDataset();
}

function isManagerAuthenticated() {
  return canAccessManagerPages(state.session);
}

async function authRequest(endpoint, options = {}) {
  const result = await requestJson(endpoint, options, signal);
  if (result.response.status === 401 && state.session) {
    clearSessionState();
    setPage("admin");
    renderAll();
  }
  return result;
}

async function hydrateAuthSession(session = null, campaignData = null) {
  clearSessionState();
  if (!canUseBackendAuth()) {
    state.auth.backendAvailable = false;
    setLoginMessage(getLocalAdminEntryHint(), "warning");
    renderSourceConfigControls();
    return;
  }
  try {
    const { response, payload } = session
      ? { response: { ok: true }, payload: session }
      : await authRequest(`${AUTH_CONFIG.statusEndpoint}?includeCampaigns=false`);
    state.auth.backendAvailable = response.ok;
    if (response.ok && payload?.authenticated && payload?.email) {
      setAuthenticatedSession(payload);
      if (!isManagerAuthenticated()) return;
      if (["project", "prizes"].includes(getInitialPage(window.location.pathname, true))) {
        if (campaignData) applyCampaignViewData(campaignData);
        else await loadPublicDataset();
        return;
      }
      const publicScope = await fetchPublicContext();
      if (!publicScope) {
        state.auth.campaignAccessError = "הקמפיין המבוקש אינו זמין או שאין לך הרשאה לצפות בו.";
        return;
      }
      const scope = publicScope;
      applyServerScope(payload, scope);
      try {
        await loadProtectedManagerData(scope);
      } catch (error) {
        // Never leave an authenticated manager looking at embedded sample data.
        const loadedPublicDataset = await loadPublicDataset(scope).catch(() => false);
        if (!loadedPublicDataset) {
          throw error;
        }
        setImportMessage(
          "טעינת נתוני הניהול נכשלה זמנית. מוצגים כעת נתוני אמת מעודכנים ממקור הקמפיין ללא פרטי תורמים.",
          "warning"
        );
      }
      syncSourceAutoRefresh();
    }
  } catch (_error) {
    state.auth.backendAvailable = false;
  }
  renderSourceConfigControls();
}

async function loadAdminDataset(scope = getActiveCampaignIdentity()) {
  const endpoint = buildScopedAdminEndpoint("dataset", scope);
  if (!canUseBackendAuth() || !endpoint || !isManagerAuthenticated()) {
    state.auth.adminDatasetLoaded = false;
    return false;
  }

  const { response, payload } = await authRequest(endpoint);
  if (!response.ok || !Array.isArray(payload?.rows) || !payload?.meta) {
    state.auth.adminDatasetLoaded = false;
    throw new Error(payload?.message || "טעינת הנתונים המוגנים נכשלה.");
  }

  applyServerScope(payload, scope);
  state.rows = enrichRows(payload.rows, payload.meta);
  state.meta = payload.meta;
  state.sourceLabel = payload.sourceLabel || "קובץ בסיס מאובטח";
  state.datasetFreshnessAt = String(payload.generatedAt || payload.meta?.fetchedAt || payload.meta?.dataThroughAt || "").trim();
  state.validation.base = buildBaseValidationSnapshot(state.rows, state.sourceLabel);
  state.auth.adminDatasetLoaded = true;
  state.filters = getDefaultFilters(state.meta);
  resetFilterOptions();
  return true;
}

async function loadPublicDataset(scope = getActiveCampaignIdentity(), options = {}) {
  if (!isManagerAuthenticated() || state.auth.campaignAccessError) return false;
  state.auth.publicDatasetStatus = "loading";
  state.auth.publicDatasetError = "";
  const endpoint = new URL(getCampaignViewEndpoint(window.location.href), window.location.origin);
  if (options.preferRequestedScope && scope.organizationId && scope.campaignId) {
    endpoint.search = new URLSearchParams({ organizationId: scope.organizationId, campaignId: scope.campaignId }).toString();
  }
  const { response, payload } = await authRequest(`${endpoint.pathname}${endpoint.search}`);
  if (options.isCurrent && !options.isCurrent()) return false;
  if (!response.ok || !Array.isArray(payload?.rows) || !payload?.meta) {
    state.auth.publicDatasetStatus = "unavailable";
    state.auth.publicDatasetError = payload?.message || "טעינת הקמפיין נכשלה. נסו שוב.";
    if (response.status === 401 || response.status === 403) {
      clearSessionState();
      setPage("admin");
    }
    return false;
  }
  applyCampaignViewData(payload);
  return true;
}

function applyCampaignViewData(payload) {
  applyServerScope(payload);
  state.auth.adminDatasetLoaded = false;
  state.rows = enrichRows(payload.rows, payload.meta);
  state.meta = payload.meta;
  state.sourceLabel = payload.sourceLabel || "קובץ בסיס ציבורי";
  state.datasetFreshnessAt = String(payload.generatedAt || payload.meta?.fetchedAt || payload.meta?.dataThroughAt || "").trim();
  if (payload.campaignConfig && typeof payload.campaignConfig === "object") {
    applyCampaignBuilderConfig(payload.campaignConfig, { preserveSourceConfig: true });
  }
  state.validation.base = buildBaseValidationSnapshot(state.rows, state.sourceLabel);
  state.filters = getDefaultFilters(state.meta);
  resetFilterOptions();
  state.auth.publicDatasetStatus = "live";
  applyAmbassadorContextFromUrl();
  return true;
}

function renderSourceConfigControls() {
  if (!elements.sourceMode) {
    return;
  }
  const config = normalizeSourceConfig(state.sourceConfig);
  state.sourceConfig = config;
  elements.sourceMode.value = config.mode;
  elements.sourceApiEndpoint.value = config.api.endpoint;
  elements.sourceApiMethod.value = config.api.method;
  elements.sourceApiFormat.value = config.api.responseFormat;
  elements.sourceApiRecordsPath.value = config.api.recordsPath;
  elements.sourceApiAuthType.value = config.api.authType;
  elements.sourceApiAutoRefresh.value = String(config.api.autoRefreshMinutes ?? 5);
  elements.sourceApiBearerToken.value = "";
  elements.sourceApiBearerToken.placeholder = config.api.hasBearerToken
    ? "קיים token שמור בשרת. הזן/י ערך חדש רק אם רוצים להחליף."
    : "השאר/י ריק כדי לעבוד ללא token";
  elements.sourceApiHeaders.value = config.api.headersText;
  elements.sourceApiBody.value = config.api.bodyText;
  elements.sourceApiFieldMap.value = config.api.fieldMapText;
  elements.sourceGoogleUrl.value = config.googleSheets.spreadsheetUrl;
  elements.sourceGoogleId.value = config.googleSheets.spreadsheetId;
  elements.sourceGoogleGid.value = config.googleSheets.gid;
  elements.sourceGoogleSheetName.value = config.googleSheets.sheetName;
  elements.sourceGoogleRange.value = config.googleSheets.range;
  elements.sourceGoogleAccessMode.value = config.googleSheets.accessMode;
  elements.sourceGoogleSyncInterval.value = String(config.googleSheets.syncIntervalMinutes ?? 5);
  elements.sourceGoogleFieldMap.value = config.googleSheets.fieldMapText;
  if (elements.sourceApiFields) {
    elements.sourceApiFields.hidden = config.mode !== "api";
  }
  if (elements.sourceGoogleFields) {
    elements.sourceGoogleFields.hidden = config.mode !== "google_sheets";
  }
  if (elements.refreshSourceApi) {
    elements.refreshSourceApi.disabled = config.mode === "file";
  }
  const status = getSourceConfigStatus();
  setSourceConfigStatus(status.message, status.tone);
}

async function hydrateSourceConfig(scope = getActiveCampaignIdentity()) {
  state.sourceConfig = normalizeSourceConfig(state.sourceConfig);
  const endpoint = buildScopedAdminEndpoint("source-config", scope);
  if (!canUseBackendAuth() || !endpoint || !isManagerAuthenticated()) {
    renderSourceConfigControls();
    return state.sourceConfig;
  }
  try {
    const { response, payload } = await authRequest(endpoint);
    if (response.ok && payload?.config) {
      applyServerScope(payload, scope);
      state.sourceConfig = normalizeSourceConfig(payload.config);
      setSourceConfigStatus(
        state.sourceConfig.mode === "api"
          ? "חיבור ה-API נטען מהשרת ומוכן למשיכה או לרענון אוטומטי."
          : state.sourceConfig.mode === "google_sheets"
            ? "חיבור Google Sheets נטען מהשרת ומוכן לסנכרון ידני או מתוזמן."
            : "מקור הנתונים הפעיל נשאר על טעינת קובץ ידנית.",
        "success"
      );
    } else {
      setSourceConfigStatus(payload?.message || "לא ניתן היה לטעון את הגדרות מקור הנתונים מהשרת.", "warning");
    }
  } catch (_error) {
    setSourceConfigStatus("השרת זמין לחיבור מנהלים, אך הגדרות מקור הנתונים לא נטענו כרגע.", "warning");
  }
  renderSourceConfigControls();
  return state.sourceConfig;
}

function collectSourceConfigFromControls() {
  const nextConfig = normalizeSourceConfig({
    mode: elements.sourceMode?.value || state.sourceConfig.mode,
    api: {
      endpoint: elements.sourceApiEndpoint?.value || "",
      method: elements.sourceApiMethod?.value || "GET",
      responseFormat: elements.sourceApiFormat?.value || "csv",
      recordsPath: elements.sourceApiRecordsPath?.value || "",
      authType: elements.sourceApiAuthType?.value || "none",
      bearerToken: elements.sourceApiBearerToken?.value || "",
      hasBearerToken: state.sourceConfig.api.hasBearerToken,
      autoRefreshMinutes: elements.sourceApiAutoRefresh?.value || state.sourceConfig.api.autoRefreshMinutes,
      headersText: elements.sourceApiHeaders?.value || "",
      bodyText: elements.sourceApiBody?.value || "",
      fieldMapText: elements.sourceApiFieldMap?.value || "",
    },
    googleSheets: {
      spreadsheetUrl: elements.sourceGoogleUrl?.value || "",
      spreadsheetId: elements.sourceGoogleId?.value || "",
      gid: elements.sourceGoogleGid?.value || "",
      sheetName: elements.sourceGoogleSheetName?.value || "",
      range: elements.sourceGoogleRange?.value || "",
      accessMode: elements.sourceGoogleAccessMode?.value || "public_csv",
      syncEnabled: true,
      syncIntervalMinutes: elements.sourceGoogleSyncInterval?.value || state.sourceConfig.googleSheets.syncIntervalMinutes,
      fieldMapText: elements.sourceGoogleFieldMap?.value || "",
      lastSyncedAt: state.sourceConfig.googleSheets.lastSyncedAt,
      lastSuccessfulSyncAt: state.sourceConfig.googleSheets.lastSuccessfulSyncAt,
      lastChecksum: state.sourceConfig.googleSheets.lastChecksum,
      lastRowCount: state.sourceConfig.googleSheets.lastRowCount,
      lastStatus: state.sourceConfig.googleSheets.lastStatus,
      lastMessage: state.sourceConfig.googleSheets.lastMessage,
      lastSourceLabel: state.sourceConfig.googleSheets.lastSourceLabel,
    },
  });
  parseJsonObjectText(nextConfig.api.fieldMapText, getDefaultSourceFieldMap());
  parseJsonObjectText(nextConfig.googleSheets.fieldMapText, getDefaultSourceFieldMap());
  return nextConfig;
}

async function saveSourceConfigFromControls(options = {}) {
  const scope = options.scope || getActiveCampaignIdentity();
  const endpoint = buildScopedAdminEndpoint("source-config", scope);
  if (!canUseBackendAuth() || !endpoint || !isManagerAuthenticated()) {
    throw new Error("שמירת חיבור API זמינה רק למנהלים מחוברים דרך שרת הניהול.");
  }
  const nextConfig = collectSourceConfigFromControls();
  const { response, payload } = await authRequest(endpoint, {
    method: "POST",
    body: { config: nextConfig },
  });
  if (!response.ok) {
    throw new Error(payload?.message || "שמירת הגדרות מקור הנתונים נכשלה.");
  }
  applyServerScope(payload, scope);
  state.sourceConfig = normalizeSourceConfig(payload?.config || nextConfig);
  renderSourceConfigControls();
  syncSourceAutoRefresh();
  if (!options.silent) {
    setSourceConfigStatus(payload?.message || "חיבור מקור הנתונים נשמר בהצלחה.", "success");
  }
  return state.sourceConfig;
}

function readPathValue(record, path) {
  return String(path || "")
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .reduce((current, segment) => {
      if (current == null) {
        return undefined;
      }
      if (Array.isArray(current) && /^\d+$/.test(segment)) {
        return current[Number(segment)];
      }
      return current?.[segment];
    }, record);
}

function extractApiRecords(payload, recordsPath) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (recordsPath) {
    const resolved = readPathValue(payload, recordsPath);
    if (Array.isArray(resolved)) {
      return resolved;
    }
  }
  if (Array.isArray(payload?.rows)) {
    return payload.rows;
  }
  if (Array.isArray(payload?.data)) {
    return payload.data;
  }
  if (Array.isArray(payload?.items)) {
    return payload.items;
  }
  throw new Error("תגובת ה-API לא כוללת מערך רשומות. יש לעדכן את recordsPath או את מבנה התגובה.");
}

function mapJsonRecordsToRawRows(records, fieldMapText) {
  const fieldMap = parseJsonObjectText(fieldMapText, getDefaultSourceFieldMap());
  return records.map((record) =>
    Object.fromEntries(
      Object.entries(fieldMap).map(([targetField, sourcePath]) => [
        targetField,
        readPathValue(record, sourcePath) ?? "",
      ])
    )
  );
}

function ingestApiRefreshPayload(payload) {
  const sourceLabel = payload?.sourceLabel || "API source";
  const format = String(payload?.format || state.sourceConfig.api.responseFormat || "csv").toLowerCase();
  if (format === "csv") {
    return ingestCsvText(String(payload?.payload || ""), sourceLabel);
  }
  const records = extractApiRecords(payload?.payload, payload?.recordsPath || state.sourceConfig.api.recordsPath);
  const rawRows = mapJsonRecordsToRawRows(records, payload?.fieldMapText || state.sourceConfig.api.fieldMapText);
  const validation = validateRawRows(rawRows, sourceLabel);
  const normalized = normalizeUploadRows(validation.validRows);
  const meta = ensureMeta(normalized);
  return {
    rawRows,
    validation,
    normalized,
    meta,
  };
}

let sourceRefreshTimerId = 0;
let sourceRefreshInFlight = false;

function clearSourceRefreshTimer() {
  if (sourceRefreshTimerId) {
    window.clearInterval(sourceRefreshTimerId);
    sourceRefreshTimerId = 0;
  }
}

async function refreshSourceDataFromApi(options = {}) {
  const scope = options.scope || getActiveCampaignIdentity();
  const endpoint = buildScopedAdminEndpoint("source-refresh", scope);
  if (!canUseBackendAuth() || !endpoint || !isManagerAuthenticated()) {
    throw new Error("משיכת נתונים ממקור חיצוני זמינה רק למנהלים מחוברים דרך שרת הניהול.");
  }
  if (sourceRefreshInFlight) {
    return false;
  }
  sourceRefreshInFlight = true;
  try {
    const { response, payload } = await authRequest(endpoint, { method: "POST" });
    if (!response.ok) {
      throw new Error(payload?.message || "משיכת הנתונים ממערכת המקור נכשלה.");
    }
    const syncWasSkipped = Boolean(payload?.skipped || payload?.reason === "sync_in_progress");
    applyServerScope(payload, scope);
    // Source sync persists Google Sheets rows server-side and returns an
    // empty compatibility array. Only parse an inline payload when one
    // was explicitly provided; otherwise reload the scoped dataset.
    if (Object.prototype.hasOwnProperty.call(payload || {}, "payload")) {
      const ingested = ingestApiRefreshPayload(payload);
      state.validation.base = ingested.validation;
      if (hasBlockingValidation(ingested.validation)) {
        throw new Error("מערכת המקור החזירה נתונים, אך הם לא עומדים במבנה הנדרש לדשבורד.");
      }
      state.meta = ingested.meta;
      state.rows = enrichRows(ingested.normalized, ingested.meta);
      state.sourceLabel = payload?.sourceLabel || "Source sync";
      state.datasetFreshnessAt = String(payload?.generatedAt || payload?.fetchedAt || ingested.meta?.fetchedAt || new Date().toISOString()).trim();
      state.filters = getDefaultFilters(ingested.meta);
      state.auth.adminDatasetLoaded = true;
      resetFilterOptions();
    } else {
      await loadAdminDataset(scope);
    }
    setSourceConfigStatus(
      syncWasSkipped
        ? (payload?.message || "סנכרון אחר עדיין מתבצע. הנתונים הקיימים נשארו מוצגים.")
        : (payload?.message || `הנתונים סונכרנו בהצלחה${payload?.fetchedAt ? ` · עדכון אחרון ${formatDateTime(payload.fetchedAt)}` : ""}.`),
      syncWasSkipped ? "warning" : "success"
    );
    if (!options.silent) {
      setImportMessage(
        syncWasSkipped
          ? (payload?.message || "סנכרון אחר עדיין מתבצע; לא הוצגו נתונים חדשים עדיין.")
          : "הנתונים נמשכו בהצלחה ממערכת המקור במקום טעינת קובץ ידנית.",
        syncWasSkipped ? "warning" : "success"
      );
    }
    if (options.render !== false) {
      renderAll();
    }
    return true;
  } finally {
    sourceRefreshInFlight = false;
  }
}

function setManualContributionStatus(message = "", tone = "") {
  if (!elements.manualContributionStatus) {
    return;
  }
  elements.manualContributionStatus.textContent = message;
  elements.manualContributionStatus.dataset.tone = tone;
}

function openManualContributionDialog() {
  if (!isManagerAuthenticated() || !canUseBackendAuth()) {
    throw new Error("הוספת הכפלה ידנית זמינה רק למנהל מחובר דרך שרת הניהול.");
  }
  if (!elements.manualContributionDialog?.showModal) {
    throw new Error("לא ניתן לפתוח את חלונית ההכפלה בדפדפן זה.");
  }
  elements.manualContributionForm?.reset();
  if (elements.manualContributionAttributedAt) {
    const now = new Date();
    const localNow = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16);
    elements.manualContributionAttributedAt.value = localNow;
  }
  manualContributionRequestId = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  setManualContributionStatus("");
  elements.manualContributionDialog.showModal();
  window.setTimeout(() => elements.manualContributionEnteredBy?.focus(), 0);
}

async function submitManualContribution() {
  const enteredBy = String(elements.manualContributionEnteredBy?.value || "").trim().replace(/\s+/g, " ");
  const amount = Number(elements.manualContributionAmount?.value || 0);
  const attributedAtInput = String(elements.manualContributionAttributedAt?.value || "").trim();
  if (!enteredBy) {
    throw new Error("יש להזין את שם המכניס/ה.");
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("יש להזין סכום חיובי.");
  }
  const attributedAtDate = new Date(attributedAtInput);
  if (!attributedAtInput || Number.isNaN(attributedAtDate.getTime())) {
    throw new Error("יש להזין תאריך ושעת שיוך תקינים.");
  }
  const scope = getActiveCampaignIdentity();
  const endpoint = buildScopedAdminEndpoint("manual-contribution", scope);
  if (!endpoint) {
    throw new Error("לא נמצאה זהות קמפיין לשמירת ההכפלה.");
  }
  const { response, payload } = await authRequest(endpoint, {
    method: "POST",
    body: {
      enteredBy,
      amount,
      attributedAt: attributedAtDate.toISOString(),
      requestId: manualContributionRequestId,
    },
  });
  if (!response.ok) {
    throw new Error(payload?.message || "שמירת ההכפלה נכשלה.");
  }
  applyServerScope(payload, scope);
  await loadAdminDataset(scope);
  renderAll();
  setImportMessage(payload?.message || "ההכפלה נוספה לסכום הקמפיין.", "success");
  return payload;
}

function setInsightAssistantStatus(message = "", tone = "") {
  if (!elements.insightAssistantStatus) {
    return;
  }
  elements.insightAssistantStatus.textContent = message;
  elements.insightAssistantStatus.dataset.tone = tone;
}

function setInsightAssistantScope(scope = {}) {
  if (!elements.insightAssistantScope) {
    return;
  }
  const currentScope = scope.organizationId && scope.campaignId ? scope : getActiveCampaignIdentity();
  const campaignName = String(state.activeCampaign?.name || state.campaignConfig?.campaign?.name || "הקמפיין הפעיל").trim();
  const rowCount = Array.isArray(state.rows) ? state.rows.filter((row) => row?.status === "success").length : 0;
  elements.insightAssistantScope.textContent = `${campaignName} · ${formatNumber(rowCount)} תרומות תקינות`;
  elements.insightAssistantScope.dataset.organizationId = currentScope.organizationId || "";
  elements.insightAssistantScope.dataset.campaignId = currentScope.campaignId || "";
}

async function submitInsightAssistantQuestion() {
  if (!isManagerAuthenticated() || !canUseBackendAuth()) {
    throw new Error("שאלות על הנתונים זמינות רק למנהל מחובר דרך שרת הניהול.");
  }
  const question = String(elements.insightAssistantQuestion?.value || "").trim();
  if (question.length < 3 || question.length > 500) {
    throw new Error("יש להזין שאלה באורך 3 עד 500 תווים.");
  }
  const scope = getActiveCampaignIdentity();
  const endpoint = buildScopedAdminEndpoint("insight-question", scope);
  if (!endpoint) {
    throw new Error("לא נמצאה זהות קמפיין לשאילתה.");
  }
  const { response, payload } = await authRequest(endpoint, {
    method: "POST",
    body: { question },
  });
  if (!response.ok) {
    throw new Error(payload?.message || "לא ניתן לקבל תשובה מהנתונים כרגע.");
  }
  if (elements.insightAssistantAnswerText) {
    elements.insightAssistantAnswerText.textContent = String(payload?.answer || "לא התקבלה תשובה.");
  }
  if (elements.insightAssistantAnswer) {
    elements.insightAssistantAnswer.hidden = false;
  }
  const updatedAt = formatDateTime(payload?.dataScope?.sourceUpdatedAt);
  const count = formatNumber(payload?.dataScope?.successfulTransactions || 0);
  setInsightAssistantStatus(
    `התשובה חושבה על ${count} תרומות תקינות${updatedAt ? ` · עדכון מקור: ${updatedAt}` : ""}.`,
    "success"
  );
  return payload;
}

function syncSourceAutoRefresh() {
  clearSourceRefreshTimer();
  const config = normalizeSourceConfig(state.sourceConfig);
  state.sourceConfig = config;
  if (!isManagerAuthenticated() || config.mode === "file") {
    return;
  }
  const refreshMinutes = Number(
    config.mode === "google_sheets"
      ? config.googleSheets.syncIntervalMinutes || 0
      : config.api.autoRefreshMinutes || 0
  );
  if (!Number.isFinite(refreshMinutes) || refreshMinutes < 1) {
    return;
  }
  sourceRefreshTimerId = window.setInterval(async () => {
    try {
      if (config.mode === "google_sheets") {
        // The manager session is a safe fallback for live campaigns:
        // pull the source first, then render the fresh persisted dataset.
        await refreshSourceDataFromApi({ silent: true });
      } else {
        await refreshSourceDataFromApi({ silent: true });
      }
    } catch (error) {
      setSourceConfigStatus(`הרענון האוטומטי ממקור הנתונים נכשל: ${error?.message || "שגיאה לא ידועה"}`, "warning");
    }
  }, refreshMinutes * 60 * 1000);
}

async function ensureCampaignBuilderConfigLoaded(scope = getActiveCampaignIdentity()) {
  if (state.auth.campaignConfigLoaded) {
    return state.campaignBuilder;
  }
  return hydrateCampaignBuilderConfig(scope);
}

async function loadProtectedManagerData(scope = getActiveCampaignIdentity()) {
  const dataset = loadAdminDataset(scope);
  // Builder snapshots can contain an older source copy. Apply the authoritative
  // source response last so loading design settings cannot switch the connector.
  const settings = ensureCampaignBuilderConfigLoaded(scope).then(() => hydrateSourceConfig(scope));
  const [loaded] = await Promise.all([dataset, settings]);
  return loaded;
}

function setLoginMessage(message, tone = "") {
  elements.loginMessage.textContent = message;
  elements.loginMessage.className = `login-message text-small${tone ? ` is-${tone}` : ""}`;
}

function setImportMessage(message, tone = "") {
  if (!elements.importStatus) {
    return;
  }
  elements.importStatus.textContent = message;
  elements.importStatus.className = `status-note text-small${tone ? ` is-${tone}` : ""}`;
}

function hasBlockingValidation(validation) {
  return Boolean(validation.missingColumns.length || !validation.validRows.length);
}

function updateTableVisibility() {
  if (!elements.tablePanel || !elements.tableToggle) {
    return;
  }
  elements.tablePanel.hidden = !state.ui.tableExpanded;
  elements.tableToggle.setAttribute("aria-expanded", String(state.ui.tableExpanded));
  elements.tableToggle.textContent = state.ui.tableExpanded ? "הסתר רשומות" : "הצג רשומות";
}

function renderBrandAssets() {
  const settings = normalizeCampaignPageSettings(isManagerAuthenticated() ? state.campaignPage : INITIAL_CAMPAIGN_PAGE_SETTINGS);
  const campaignLogo = String(settings.campaignLogoUrl || INITIAL_CAMPAIGN_LOGO || "").trim();
  const organizationLogo = String(settings.organizationLogoUrl || INITIAL_ORG_LOGO || "").trim();
  const organizationName = (isManagerAuthenticated() ? String(state.campaignBuilder?.basics?.organizationName || "").trim() : "") || "הארגון";
  root.style.setProperty("--brand-pattern-campaign", campaignLogo ? `url("${campaignLogo}")` : "none");
  root.style.setProperty("--brand-pattern-organization", organizationLogo ? `url("${organizationLogo}")` : "none");
  if (elements.publicLogo) {
    elements.publicLogo.src = campaignLogo;
    elements.publicLogo.alt = settings.title ? `לוגו ${settings.title}` : "לוגו הקמפיין";
  }
  if (elements.publicOrgLogo) {
    elements.publicOrgLogo.src = organizationLogo;
    elements.publicOrgLogo.alt = `לוגו ${organizationName}`;
  }
  if (elements.loginCampaignLogo) {
    elements.loginCampaignLogo.src = campaignLogo;
    elements.loginCampaignLogo.alt = settings.title ? `לוגו ${settings.title}` : "לוגו הקמפיין";
  }
  if (elements.loginOrgLogo) {
    elements.loginOrgLogo.src = organizationLogo;
    elements.loginOrgLogo.alt = `לוגו ${organizationName}`;
  }
  if (elements.logo) {
    elements.logo.src = campaignLogo;
    elements.logo.alt = settings.title ? `לוגו ${settings.title}` : "לוגו הקמפיין";
  }
  if (elements.brandOrgLogo) {
    elements.brandOrgLogo.src = organizationLogo;
    elements.brandOrgLogo.alt = `לוגו ${organizationName}`;
  }
}

function hydrateRulesPage() {
  // Legal pages are React components, with no campaign-specific default policy.
}

function setPage(page) {
  let nextPage = ["project", "prizes", "rules", "privacy", "admin"].includes(page) ? page : "project";
  if (["project", "prizes"].includes(nextPage) && (!isManagerAuthenticated() || state.auth.campaignAccessError)) {
    nextPage = "admin";
  }
  state.ui.page = nextPage;
  const pageMap = {
    project: elements.pageProject,
    prizes: elements.pagePrizes,
    rules: elements.pageRules,
    privacy: elements.pagePrivacy,
    admin: elements.pageAdmin,
  };
  Object.entries(pageMap).forEach(([key, element]) => {
    element.classList.toggle("is-active", key === nextPage);
  });
  elements.navButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.pageTarget === nextPage);
    if (button.dataset.pageTarget === nextPage) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  refreshAccessUi();
}

let navigationRevision = 0;
async function navigateToPage(page, { updateHistory = false } = {}) {
  const revision = ++navigationRevision;
  const publicPage = page === "project" || page === "prizes";
  // Revalidate the selected campaign in one request without rebooting the app.
  if (publicPage) {
    const loaded = await loadPublicDataset(getActiveCampaignIdentity(), { preferRequestedScope: updateHistory, isCurrent: () => revision === navigationRevision }).catch(() => false);
    if (revision !== navigationRevision) return;
    if (!loaded) { renderAll(); return; }
  }
  if (updateHistory) {
    const link = root.querySelector(`.site-header [data-page-target="${page}"]`);
    window.history.pushState(null, "", link?.getAttribute("href") || `/${page}`);
  }
  setPage(page);
  renderAll();
}

function setAdminTab(tab) {
  const nextTab = tab === "design" ? "design" : "insights";
  state.ui.adminTab = nextTab;
  const panelMap = {
    insights: elements.adminTabPanelInsights,
    design: elements.adminTabPanelDesign,
  };
  Object.entries(panelMap).forEach(([key, panel]) => {
    if (!panel) {
      return;
    }
    panel.hidden = key !== nextTab;
  });
  elements.adminTabButtons.forEach((button) => {
    const isActive = button.dataset.adminTabTarget === nextTab;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  if (nextTab === "design" && state.ui.page === "admin") {
    if (isManagerAuthenticated() && !state.auth.campaignConfigLoaded) {
      setCampaignBuilderStatus("טוענים את הגדרות הקמפיין מהשרת...", "warning");
      ensureCampaignBuilderConfigLoaded()
        .then(() => {
          renderAll();
        })
        .catch((error) => {
          setCampaignBuilderStatus(
            error?.message || "טעינת הגדרות הקמפיין נכשלה. מוצגות בינתיים ההגדרות המקומיות.",
            "warning"
          );
          renderCampaignDesigner();
        });
      return;
    }
    renderCampaignDesigner();
  }
}

function refreshAccessUi() {
  const isManager = isManagerAuthenticated();
  const hasAccess = isManager && !state.auth.campaignAccessError;
  const isAdminPage = state.ui.page === "admin";
  elements.sessionStatus.textContent = state.session ? `מחובר/ת: ${state.session.email}` : "מצב ניהול: אורח/ת";
  elements.sessionStatus.hidden = !isAdminPage;
  elements.logoutButton.hidden = !state.session;
  elements.adminLock.hidden = hasAccess;
  elements.adminContent.hidden = !hasAccess;
  if (isAdminPage && !hasAccess) {
    setLoginMessage(state.auth.campaignAccessError || (state.session
      ? "אין לחשבון זה הרשאת מנהל. דף הפרויקט, הפרסים והניהול זמינים כרגע למנהלים בלבד."
      : "יש להיכנס עם חשבון מנהל מורשה כדי לצפות בדף הפרויקט, בפרסים ובדשבורד."), state.session ? "error" : "");
  }
  if (hasAccess && isAdminPage) {
    setAdminTab(state.ui.adminTab);
  }
}

function getLatestCreatedIso(rows) {
  return [...rows]
    .map((row) => row.createdIso)
    .filter(Boolean)
    .sort()
    .slice(-1)[0] || "";
}

function getDatasetFreshnessIso() {
  return String(
    state.datasetFreshnessAt || state.meta?.fetchedAt || state.meta?.dataThroughAt || ""
  ).trim();
}

function formatAmount(value) {
  return currencyFormatter.format(value || 0);
}

function formatNumber(value) {
  return numberFormatter.format(value || 0);
}

function formatDate(value) {
  const date = value ? new Date(`${value}T00:00:00`) : null;
  return date && Number.isFinite(date.getTime()) ? dateFormatter.format(date) : "";
}

function formatShortDate(value) {
  const date = value ? new Date(`${value}T00:00:00`) : null;
  return date && Number.isFinite(date.getTime()) ? dateShortFormatter.format(date) : "";
}

function formatDateTime(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? dateTimeFormatter.format(date) : "";
}

function formatHourLabel(value) {
  return `${String(value).padStart(2, "0")}:00`;
}

function getWeekdayLabel(dateString) {
  const date = dateString ? new Date(`${dateString}T00:00:00`) : null;
  return date && Number.isFinite(date.getTime()) ? weekdayFormatter.format(date) : "";
}

function normalizeSearchToken(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("he-IL");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function ensureMeta(rows) {
  const uniqueDates = [...new Set(rows.map((row) => row.date))].sort();
  const projectDates = uniqueDates;
  return {
    uniqueDates,
    projectDates,
    minDate: uniqueDates[0] || "",
    maxDate: uniqueDates[uniqueDates.length - 1] || "",
    defaultFrom: projectDates[0] || uniqueDates[0] || "",
    defaultTo: projectDates[projectDates.length - 1] || uniqueDates[uniqueDates.length - 1] || "",
    rowCount: rows.length,
    projectWindowLabel: projectDates.length ? `${projectDates[0]} עד ${projectDates[projectDates.length - 1]}` : "",
  };
}

function getFilterMeta() {
  const metas = [state.meta, state.compare.meta].filter(Boolean);
  const uniqueDates = [...new Set(metas.flatMap((meta) => meta.uniqueDates || []))].sort();
  const projectDates = (state.meta?.projectDates?.length ? state.meta.projectDates : state.compare.meta?.projectDates) || [];
  return {
    uniqueDates,
    projectDates,
    minDate: uniqueDates[0] || "",
    maxDate: uniqueDates[uniqueDates.length - 1] || "",
  };
}

function enrichRows(rows, meta) {
  const projectIndex = new Map(meta.projectDates.map((date, index) => [date, index + 1]));
  return rows.map((row) => {
    const date = row.date;
    const dayIndex = projectIndex.get(date) || null;
    return {
      ...row,
      ambassador: row.ambassador && row.ambassador.trim() ? row.ambassador.trim() : "ללא שיוך",
      donor: row.donor && row.donor.trim() ? row.donor.trim() : "ללא שם",
      city: row.city && row.city.trim() ? row.city.trim() : "ללא עיר",
      projectDay: dayIndex,
      projectDayLabel: dayIndex ? `יום ${dayIndex}` : "מחוץ לחלון",
    };
  });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((cell) => String(cell || "").trim()));
}

function csvMatrixToRecords(matrix) {
  if (!matrix.length) {
    return [];
  }
  const headers = matrix[0].map((header, index) => (index === 0 ? String(header || "").replace(/^\uFEFF/, "") : String(header || "")));
  return matrix.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""])));
}

function validateRawRows(rawRows, label) {
  const requiredColumns = ["id", "created_at", "full_name", "total", "Ambassador name", "charged_success", "charge_result"];
  const availableColumns = rawRows.length ? Object.keys(rawRows[0]) : [];
  const missingColumns = requiredColumns.filter((column) => !availableColumns.includes(column));
  const invalidDateRows = [];
  const invalidAmountRows = [];
  const missingAmbassadorRows = [];
  const missingEmailRows = [];
  const duplicateIds = new Map();
  const validRows = [];

  rawRows.forEach((row, index) => {
    const rowNumber = index + 2;
    const createdAt = String(row["created_at"] || "").trim();
    const totalText = String(row["total"] || "").trim();
    const ambassador = String(row["Ambassador name"] || "").trim();
    const email = String(row["email"] || "").trim();
    const id = String(row["id"] || "").trim();

    if (!createdAt) {
      invalidDateRows.push(rowNumber);
    }
    if (!createdAt || !/^\d{2}\/\d{2}\/\d{2}\s\d{2}:\d{2}$/.test(createdAt)) {
      if (!invalidDateRows.includes(rowNumber)) {
        invalidDateRows.push(rowNumber);
      }
    }

    const amount = Number.parseFloat(totalText || "0");
    if (!totalText || Number.isNaN(amount)) {
      invalidAmountRows.push(rowNumber);
    }

    if (!ambassador) {
      missingAmbassadorRows.push(rowNumber);
    }

    if (!email) {
      missingEmailRows.push(rowNumber);
    }

    if (id) {
      duplicateIds.set(id, (duplicateIds.get(id) || 0) + 1);
    }

    if (createdAt && !Number.isNaN(amount)) {
      validRows.push(row);
    }
  });

  const duplicateIdCount = [...duplicateIds.values()].filter((count) => count > 1).reduce((sum, count) => sum + count, 0);
  const errors = [];
  const warnings = [];

  if (missingColumns.length) {
    errors.push(`חסרות עמודות חובה: ${missingColumns.join(", ")}`);
  }
  if (invalidDateRows.length) {
    errors.push(`${invalidDateRows.length} רשומות עם תאריך/שעה לא תקין בקובץ ${label}.`);
  }
  if (invalidAmountRows.length) {
    errors.push(`${invalidAmountRows.length} רשומות עם סכום חסר או לא מספרי בקובץ ${label}.`);
  }
  if (missingAmbassadorRows.length) {
    warnings.push(`${missingAmbassadorRows.length} רשומות ללא שיוך שגריר/ה.`);
  }
  if (missingEmailRows.length) {
    warnings.push(`${missingEmailRows.length} רשומות ללא אימייל תורם.`);
  }
  if (duplicateIdCount) {
    warnings.push(`${duplicateIdCount} רשומות עם מזהי עסקה כפולים אפשריים.`);
  }

  return {
    label,
    totalRows: rawRows.length,
    validRows,
    errors,
    warnings,
    missingColumns,
    invalidDateRows: invalidDateRows.length,
    invalidAmountRows: invalidAmountRows.length,
    missingAmbassadorRows: missingAmbassadorRows.length,
    missingEmailRows: missingEmailRows.length,
    duplicateIdCount,
  };
}

function ingestCsvText(text, label) {
  const rawRows = csvMatrixToRecords(parseCsv(text));
  const validation = validateRawRows(rawRows, label);
  const normalized = normalizeUploadRows(validation.validRows);
  const meta = ensureMeta(normalized);
  return {
    rawRows,
    validation,
    normalized,
    meta,
  };
}

function normalizeUploadRows(rawRows) {
  return rawRows
    .map((raw) => {
      const createdAt = String(raw["created_at"] || "").trim();
      if (!createdAt) {
        return null;
      }
      const [datePart, timePart] = createdAt.split(" ");
      const [day, month, year] = datePart.split("/");
      const isoYear = Number(year) < 70 ? `20${year}` : `19${year}`;
      const createdIso = `${isoYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${timePart}:00`;
      return {
        id: String(raw["id"] || "").trim(),
        createdIso,
        date: createdIso.slice(0, 10),
        hour: Number(timePart.split(":")[0]),
        email: String(raw["email"] || "").trim().toLowerCase(),
        donor: String(raw["full_name"] || "").trim() || "ללא שם",
        ambassador: String(raw["Ambassador name"] || "").trim() || "ללא שיוך",
        amount: Number.parseFloat(String(raw["total"] || "0").trim() || "0") || 0,
        city: String(raw["city"] || "").trim() || "ללא עיר",
        status: String(raw["charged_success"] || "").trim().toLowerCase() === "true" ? "success" : "failed",
        chargeResult: String(raw["charge_result"] || "").trim(),
      };
    })
    .filter(Boolean);
}

function coerceNumber(value) {
  const text = String(value ?? "").replaceAll(",", "").trim();
  if (!text) {
    return null;
  }
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizePrizeModel(model) {
  const placePrizes = (model.placePrizes || [])
    .map((item) => ({
      place: Number(item.place),
      label: String(item.label || `מקום ${item.place}`),
      prize: String(item.prize || "").trim(),
    }))
    .filter((item) => item.place && item.prize)
    .sort((left, right) => left.place - right.place);

  const tierPrizes = (model.tierPrizes || [])
    .map((item) => ({
      threshold: Number(item.threshold),
      prize: String(item.prize || "").trim(),
    }))
    .filter((item) => Number.isFinite(item.threshold) && item.prize)
    .sort((left, right) => left.threshold - right.threshold);

  return {
    placePrizes,
    tierPrizes,
    tierRuleNote: String(model.tierRuleNote || "").trim(),
    sprintPrize: String(model.sprintPrize || "").trim(),
    excludedAmbassadors: Array.isArray(model.excludedAmbassadors) ? model.excludedAmbassadors.map(String).map(value => value.trim()).filter(Boolean) : [],
  };
}

function validatePrizeModelUpload(model, label) {
  const normalized = normalizePrizeModel(model);
  const warnings = [];
  const errors = [];

  if (!normalized.placePrizes.length) {
    warnings.push("לא זוהו פרסי מיקומים תקפים.");
  }
  if (!normalized.tierPrizes.length) {
    warnings.push("לא זוהו מדרגות פרס תקפות.");
  }
  if (!normalized.placePrizes.length && !normalized.tierPrizes.length) {
    errors.push(`לא נמצאו פרסים תקפים בקובץ ${label}.`);
  }

  return {
    normalized,
    warnings,
    errors,
  };
}

function buildPrizeModelFromMatrix(matrix) {
  const rows = matrix.map((cells) => cells.map((cell) => String(cell ?? "").trim()));
  if (!rows.length || !rows[0].length) {
    return normalizePrizeModel({ placePrizes: [], tierPrizes: [], tierRuleNote: "" });
  }

  const placePrizes = [];
  const firstRow = rows[0];
  if (firstRow[0] && firstRow[1]) {
    placePrizes.push({ place: 1, label: firstRow[0], prize: firstRow[1] });
  }

  let tierRuleNote = "";
  let inTiers = false;

  rows.slice(1).forEach((cells) => {
    const left = cells[0] || "";
    const right = cells[1] || "";

    if (!inTiers && left.startsWith("מקום")) {
      const digits = left.replace(/\D+/g, "");
      if (digits) {
        placePrizes.push({ place: Number(digits), label: left, prize: right });
      }
      return;
    }

    if (left === "מדרגות פרס") {
      inTiers = true;
      return;
    }

    if (inTiers) {
      const threshold = coerceNumber(left);
      if (threshold !== null && right) {
        placePrizes.sort((a, b) => a.place - b.place);
      } else if (left.includes("לא ניתן לקבל יותר מפרס אחד")) {
        tierRuleNote = left;
      }
    }
  });

  const tierPrizes = [];
  inTiers = false;
  rows.slice(1).forEach((cells) => {
    const left = cells[0] || "";
    const right = cells[1] || "";
    if (left === "מדרגות פרס") {
      inTiers = true;
      return;
    }
    if (!inTiers) {
      return;
    }
    const threshold = coerceNumber(left);
    if (threshold !== null && right) {
      tierPrizes.push({ threshold, prize: right });
    }
  });

  return normalizePrizeModel({ placePrizes, tierPrizes, tierRuleNote });
}

function resetFilterOptions() {
  const allRows = [...state.rows, ...state.compare.rows];
  const filterMeta = getFilterMeta();
  const ambassadors = [...new Set(allRows.map((row) => row.ambassador))].sort((left, right) =>
    left.localeCompare(right, "he")
  );
  const hourOptions = Array.from({ length: 24 }, (_, hour) => `<option value="${hour}">${formatHourLabel(hour)}</option>`);
  const dayOptions = [
    { value: "all", label: "כל הימים" },
    ...filterMeta.projectDates.map((date, index) => ({
      value: String(index + 1),
      label: `יום ${index + 1} | ${formatShortDate(date)}`,
    })),
  ];

  if (filterMeta.uniqueDates.length > filterMeta.projectDates.length) {
    dayOptions.push({ value: "overflow", label: "מחוץ לעשרת הימים" });
  }

  elements.ambassador.innerHTML = [
    `<option value="all">כל השגרירים</option>`,
    ...ambassadors.map((value) => `<option value="${escapeAttribute(value)}">${escapeHtml(value)}</option>`),
  ].join("");

  elements.projectDay.innerHTML = dayOptions
    .map((option) => `<option value="${option.value}">${escapeHtml(option.label)}</option>`)
    .join("");

  elements.dateExact.innerHTML = [
    `<option value="all">כל התאריכים</option>`,
    ...filterMeta.uniqueDates.map((date) => `<option value="${date}">${escapeHtml(formatDate(date))}</option>`),
  ].join("");

  elements.hour.innerHTML = [
    `<option value="all">כל השעות</option>`,
    ...hourOptions,
  ].join("");

  elements.hourFrom.innerHTML = [
    `<option value="all">משעה כלשהי</option>`,
    ...hourOptions,
  ].join("");

  elements.hourTo.innerHTML = [
    `<option value="all">עד שעה כלשהי</option>`,
    ...hourOptions,
  ].join("");

  elements.dateFrom.min = filterMeta.minDate;
  elements.dateFrom.max = filterMeta.maxDate;
  elements.dateTo.min = filterMeta.minDate;
  elements.dateTo.max = filterMeta.maxDate;
  elements.dateExact.value = state.filters.dateExact;
  elements.dateFrom.value = state.filters.dateFrom;
  elements.dateTo.value = state.filters.dateTo;
  elements.ambassador.value = state.filters.ambassador;
  elements.projectDay.value = state.filters.projectDay;
  elements.hour.value = state.filters.hour;
  elements.hourFrom.value = state.filters.hourFrom;
  elements.hourTo.value = state.filters.hourTo;
  elements.timeFrom.value = state.filters.timeFrom;
  elements.timeTo.value = state.filters.timeTo;
  elements.donor.value = state.filters.donor;
  elements.amountMin.value = state.filters.amountMin;
  elements.amountMax.value = state.filters.amountMax;
  elements.dailyMetric.value = state.view.dailyMetric;
  elements.heatmapMetric.value = state.view.heatmapMetric;
  elements.movementMetric.value = state.view.movementMetric;
  syncAnalysisProjectDateControls();
}

function syncFiltersFromInputs() {
  state.filters.ambassador = elements.ambassador.value;
  state.filters.projectDay = elements.projectDay.value;
  state.filters.dateExact = elements.dateExact.value;
  state.filters.hour = elements.hour.value;
  state.filters.hourFrom = elements.hourFrom.value;
  state.filters.hourTo = elements.hourTo.value;
  state.filters.timeFrom = elements.timeFrom.value;
  state.filters.timeTo = elements.timeTo.value;
  state.filters.dateFrom = elements.dateFrom.value;
  state.filters.dateTo = elements.dateTo.value;
  state.filters.donor = elements.donor.value;
  state.filters.amountMin = elements.amountMin.value;
  state.filters.amountMax = elements.amountMax.value;
}

function filterRows(rows, options = {}) {
  const { includeAmbassador = true } = options;
  const { ambassador, projectDay, dateExact, hour, hourFrom, hourTo, timeFrom, timeTo, dateFrom, dateTo, donor, amountMin, amountMax } = state.filters;
  const donorQuery = normalizeSearchToken(donor);
  const minimumAmount = amountMin === "" ? null : Number(amountMin);
  const maximumAmount = amountMax === "" ? null : Number(amountMax);
  const parseTimeMinutes = (value) => {
    const match = String(value || "").match(/^([0-9]{2}):([0-9]{2})$/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  };
  const timeFromMinutes = parseTimeMinutes(timeFrom);
  const timeToMinutes = parseTimeMinutes(timeTo);
  return rows.filter((row) => {
    if (includeAmbassador && ambassador !== "all" && row.ambassador !== ambassador) {
      return false;
    }
    if (projectDay !== "all") {
      if (projectDay === "overflow" && row.projectDay !== null) {
        return false;
      }
      if (projectDay !== "overflow" && String(row.projectDay) !== projectDay) {
        return false;
      }
    }
    if (dateExact !== "all" && row.date !== dateExact) {
      return false;
    }
    if (hour !== "all" && row.hour !== Number(hour)) {
      return false;
    }
    if (hourFrom !== "all" && row.hour < Number(hourFrom)) {
      return false;
    }
    if (hourTo !== "all" && row.hour > Number(hourTo)) {
      return false;
    }
    const rowTimeMatch = String(row.createdIso || "").match(/T([0-9]{2}):([0-9]{2})/);
    const rowTimeMinutes = rowTimeMatch ? Number(rowTimeMatch[1]) * 60 + Number(rowTimeMatch[2]) : Number(row.hour || 0) * 60;
    if (timeFromMinutes !== null && rowTimeMinutes < timeFromMinutes) {
      return false;
    }
    if (timeToMinutes !== null && rowTimeMinutes > timeToMinutes) {
      return false;
    }
    if (dateFrom && row.date < dateFrom) {
      return false;
    }
    if (dateTo && row.date > dateTo) {
      return false;
    }
    if (minimumAmount !== null && row.amount < minimumAmount) {
      return false;
    }
    if (maximumAmount !== null && row.amount > maximumAmount) {
      return false;
    }
    if (donorQuery && !normalizeSearchToken(row.donor).includes(donorQuery)) {
      return false;
    }
    return true;
  });
}

function getFilteredRows() {
  return filterRows(state.rows);
}

function getComparisonRows() {
  return filterRows(state.compare.rows);
}

function getPrizeScopeRows() {
  if (!state.auth.adminDatasetLoaded && state.auth.publicDatasetStatus === "unavailable") {
    return [];
  }
  const configuredDates = new Set(state.meta?.projectDates || []);
  return state.rows.filter((row) => {
    if (row.status !== "success") {
      return false;
    }
    return !configuredDates.size || configuredDates.has(row.date);
  });
}

function getSprintScopeRows() {
  const window = getSprintWindow();
  if (!window) {
    return [];
  }
  const parseTimeMinutes = (value) => {
    const match = String(value || "").match(/^([0-9]{2}):([0-9]{2})$/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  };
  const fromMinutes = parseTimeMinutes(window.from);
  const toMinutes = parseTimeMinutes(window.to);
  return getPrizeScopeRows().filter((row) => {
    if (row.date !== window.date) {
      return false;
    }
    const match = String(row.createdIso || "").match(/T([0-9]{2}):([0-9]{2})/);
    const rowMinutes = match ? Number(match[1]) * 60 + Number(match[2]) : Number(row.hour || 0) * 60;
    return (fromMinutes === null || rowMinutes >= fromMinutes) && (toMinutes === null || rowMinutes <= toMinutes);
  });
}

function sumAmount(rows) {
  return rows.reduce((sum, row) => sum + row.amount, 0);
}

function groupBy(rows, getKey) {
  const map = new Map();
  rows.forEach((row) => {
    const key = getKey(row);
    const items = map.get(key) || [];
    items.push(row);
    map.set(key, items);
  });
  return map;
}

function buildLeaderboard(rows) {
  const grouped = new Map();
  rows.forEach((row) => {
    if (!row.ambassador || row.ambassador === "ללא שיוך") {
      return;
    }
    const current = grouped.get(row.ambassador) || { ambassador: row.ambassador, total: 0, deals: 0 };
    current.total += row.amount;
    current.deals += 1;
    grouped.set(row.ambassador, current);
  });
  return [...grouped.values()].sort((left, right) => right.total - left.total);
}

// These campaign ambassadors' donations remain in every financial total, but they
// are excluded from the prizes and competition rankings by campaign policy.


function normalizePrizeCompetitionAmbassador(value) {
  return normalizeSearchToken(value)
    .replace(/[-"'׳״`.,;:!?–—_(){}]+/g, " ")
    .replaceAll("[", " ")
    .replaceAll("]", " ")
    .replace(new RegExp("\\s+", "g"), " ")
    .trim();
}

function isPrizeCompetitionEligibleAmbassador(ambassador) {
  const normalized = normalizePrizeCompetitionAmbassador(ambassador);
  return Boolean(normalized) && normalized !== "ללא שיוך" && !(state.prizeModel.excludedAmbassadors || []).map(normalizePrizeCompetitionAmbassador).includes(normalized);
}

function buildPrizeCompetitionLeaderboard(rows) {
  return buildLeaderboard(rows).filter((entry) => isPrizeCompetitionEligibleAmbassador(entry.ambassador));
}

function formatSignedNumber(value) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${prefix}${numberFormatter.format(Math.abs(Math.round(value)))}`;
}

function formatSignedCurrency(value) {
  if (!Number.isFinite(value)) {
    return formatAmount(0);
  }
  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${prefix}${formatAmount(Math.abs(value))}`;
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatSignedPercentPoints(value) {
  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${prefix}${Math.abs(value * 100).toFixed(1)} נק'`;
}

function formatSignedPercent(value) {
  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${prefix}${Math.abs(value * 100).toFixed(1)}%`;
}

function buildDatasetSummary(rows, label) {
  const total = sumAmount(rows);
  const deals = rows.length;
  const successCount = rows.filter((row) => row.status === "success").length;
  const successRate = deals ? successCount / deals : 0;
  const ambassadorSet = new Set(rows.map((row) => row.ambassador).filter((value) => value && value !== "ללא שיוך"));
  const leaderboard = buildLeaderboard(rows);
  const topAmbassador = leaderboard[0] || null;
  const topAmbassadorShare = topAmbassador && total ? topAmbassador.total / total : 0;
  const topDay =
    [...groupBy(rows, (row) => row.date).entries()]
      .map(([date, items]) => ({ date, total: sumAmount(items), count: items.length }))
      .sort((left, right) => right.total - left.total)[0] || null;
  const peakHour =
    [...groupBy(rows, (row) => row.hour).entries()]
      .map(([hour, items]) => ({ hour, total: sumAmount(items), count: items.length }))
      .sort((left, right) => right.total - left.total)[0] || null;

  return {
    label,
    total,
    deals,
    average: deals ? total / deals : 0,
    successRate,
    ambassadorCount: ambassadorSet.size,
    ambassadorSet,
    topAmbassador,
    topAmbassadorShare,
    topDay,
    peakHour,
  };
}

function buildComparisonModel(baseRows, compareRows) {
  const base = buildDatasetSummary(baseRows, state.sourceLabel || "קובץ בסיס");
  const compare = buildDatasetSummary(compareRows, state.compare.label || "קובץ השוואה");
  const overlap = [...base.ambassadorSet].filter((ambassador) => compare.ambassadorSet.has(ambassador));
  const totalDelta = compare.total - base.total;
  const dealsDelta = compare.deals - base.deals;
  const averageDelta = compare.average - base.average;
  const successDelta = compare.successRate - base.successRate;
  const ambassadorDelta = compare.ambassadorCount - base.ambassadorCount;
  const strongerLabel = totalDelta >= 0 ? compare.label : base.label;
  const weakerLabel = totalDelta >= 0 ? base.label : compare.label;

  const facts = [
    `${strongerLabel} מוביל בסך הגיוס בפער של ${formatSignedCurrency(totalDelta)} לעומת ${weakerLabel}.`,
    `${compare.label} מציג ${formatSignedNumber(dealsDelta)} עסקאות ביחס ל-${base.label}, וממוצע לעסקה של ${formatAmount(compare.average)} מול ${formatAmount(base.average)}.`,
    `יש ${formatNumber(overlap.length)} שגרירים משותפים בין שני הקבצים, מתוך ${formatNumber(base.ambassadorCount)} ו-${formatNumber(compare.ambassadorCount)} שגרירים פעילים.`,
  ];

  const critical = [];
  if (base.total > 0 && compare.total < base.total * 0.85) {
    critical.push(`${compare.label} נמוך ביותר מ-15% בסך הגיוס מול ${base.label}. כדאי לבדוק אם חסרות רשומות, שעות פעילות או שגרירים פעילים.`);
  }
  if (compare.successRate + 0.03 < base.successRate) {
    critical.push(`שיעור ההצלחה של ${compare.label} נמוך ב-${formatSignedPercentPoints(successDelta)} לעומת ${base.label}. זה פער שמצדיק בדיקת כשלי גבייה.`);
  }
  if (compare.ambassadorCount + 2 < base.ambassadorCount) {
    critical.push(`${compare.label} מפעיל פחות שגרירים פעילים ב-${formatSignedNumber(ambassadorDelta)} לעומת ${base.label}. זה יכול להסביר האטה בקצב הגיוס.`);
  }
  if (!critical.length) {
    critical.push(`לא זוהתה חריגה אחת חדה, אבל עדיין יש פער של ${formatSignedCurrency(totalDelta)} בסך הגיוס ו-${formatSignedNumber(dealsDelta)} עסקאות בין שני הקבצים.`);
  }

  const insights = [];
  if (base.topAmbassador && compare.topAmbassador) {
    insights.push(`השגריר המוביל ב-${base.label} הוא ${base.topAmbassador.ambassador} עם ${formatAmount(base.topAmbassador.total)}, בעוד שב-${compare.label} מוביל/ה ${compare.topAmbassador.ambassador} עם ${formatAmount(compare.topAmbassador.total)}.`);
  }
  if (base.topDay && compare.topDay) {
    insights.push(`יום השיא ב-${base.label} הוא ${formatDate(base.topDay.date)}, וב-${compare.label} יום השיא הוא ${formatDate(compare.topDay.date)}. זה עוזר לזהות אם המומנטום זז ליום אחר.`);
  }
  if (base.peakHour && compare.peakHour) {
    insights.push(`שעת השיא השתנתה מ-${String(base.peakHour.hour).padStart(2, "0")}:00 ב-${base.label} ל-${String(compare.peakHour.hour).padStart(2, "0")}:00 ב-${compare.label}.`);
  }
  const concentrationDelta = compare.topAmbassadorShare - base.topAmbassadorShare;
  if (Math.abs(concentrationDelta) >= 0.08) {
    insights.push(`${compare.label} ${concentrationDelta > 0 ? "תלוי יותר" : "מפוזר יותר"} בשגריר מוביל, עם שינוי של ${formatSignedPercentPoints(concentrationDelta)} בחלקו של המוביל מתוך כלל הגיוס.`);
  }
  if (!insights.length) {
    insights.push(`שני הקבצים דומים יחסית במבנה הפעילות שלהם, ולכן עיקר הקריאה צריך להתמקד בפערי הסכום, העסקאות ושיעור ההצלחה.`);
  }

  return {
    base,
    compare,
    overlapCount: overlap.length,
    totalDelta,
    dealsDelta,
    averageDelta,
    successDelta,
    ambassadorDelta,
    facts,
    critical,
    insights,
  };
}

const intelligenceEngine = createGoodRaiseIntelligence({
  groupBy,
  sumAmount,
  buildLeaderboard,
});

function buildIntelligenceContext(rows) {
  const activeScope = getActiveCampaignIdentity();
  return {
    organizationId: activeScope.organizationId,
    campaignId: activeScope.campaignId,
    rows,
    meta: state.meta,
    goals: state.goals,
    prizeModel: state.prizeModel,
    ambassadorDirectory: state.ambassadorDirectory,
    campaignBuilder: state.campaignBuilder,
  };
}

function computePrizeStandings(referenceRows) {
  const prizeModel = normalizePrizeModel(state.prizeModel);
  const leaderboard = buildPrizeCompetitionLeaderboard(referenceRows);
  const placeWinners = prizeModel.placePrizes.map((item) => ({
    ...item,
    winner: leaderboard[item.place - 1] || null,
  }));

  const tiers = prizeModel.tierPrizes.map((tier) => ({ ...tier, active: [], carryover: [] }));
  const firstTierThreshold = tiers[0] ? tiers[0].threshold : null;

  leaderboard.forEach((entry) => {
    let highestTierIndex = -1;
    tiers.forEach((tier, index) => {
      if (entry.total >= tier.threshold) {
        highestTierIndex = index;
      }
    });
    if (highestTierIndex >= 0) {
      tiers[highestTierIndex].active.push(entry);
      if (highestTierIndex > 0 && firstTierThreshold !== null && entry.total >= firstTierThreshold) {
        tiers[0].carryover.push(entry);
      }
    }
  });

  tiers.forEach((tier) => {
    tier.active.sort((left, right) => right.total - left.total);
    tier.carryover.sort((left, right) => right.total - left.total);
  });

  const selectedAmbassador =
    state.filters.ambassador !== "all"
      ? leaderboard.find((entry) => entry.ambassador === state.filters.ambassador) || null
      : null;

  let selectedFocus = null;
  if (selectedAmbassador) {
    const currentTier = [...tiers].reverse().find((tier) => selectedAmbassador.total >= tier.threshold) || null;
    const nextTier = tiers.find((tier) => tier.threshold > selectedAmbassador.total) || null;
    selectedFocus = {
      ambassador: selectedAmbassador.ambassador,
      total: selectedAmbassador.total,
      currentPrize: currentTier ? currentTier.prize : "עדיין ללא פרס",
      nextPrize: nextTier ? nextTier.prize : "",
      gap: nextTier ? nextTier.threshold - selectedAmbassador.total : 0,
    };
  }

  return {
    prizeModel,
    leaderboard,
    placeWinners,
    tiers,
    selectedFocus,
  };
}

function computeDailyWinners(referenceRows) {
  const projectDates = state.meta.projectDates?.length ? state.meta.projectDates : state.meta.uniqueDates || [];
  const groupedByDate = new Map();
  referenceRows.forEach((row) => {
    const dateKey = row.date;
    if (!dateKey) {
      return;
    }
    if (!groupedByDate.has(dateKey)) {
      groupedByDate.set(dateKey, new Map());
    }
    const byAmbassador = groupedByDate.get(dateKey);
    const ambassador = row.ambassador || "ללא שיוך";
    if (!isPrizeCompetitionEligibleAmbassador(ambassador)) {
      return;
    }
    const current = byAmbassador.get(ambassador) || { ambassador, total: 0, deals: 0 };
    current.total += Number(row.amount || 0);
    current.deals += 1;
    byAmbassador.set(ambassador, current);
  });

  const usedAmbassadors = new Set();
  return projectDates.map((dateKey, index) => {
    const candidates = Array.from((groupedByDate.get(dateKey) || new Map()).values())
      .filter((candidate) => candidate.total >= 20)
      .sort((left, right) => {
        if (right.total !== left.total) {
          return right.total - left.total;
        }
        if (right.deals !== left.deals) {
          return right.deals - left.deals;
        }
        return left.ambassador.localeCompare(right.ambassador, "he");
      });
    // A campaign ambassador may go on the field only once. When the daily
    // leader has already been selected, advance to the next eligible person.
    const uniqueCandidate = candidates.find((candidate) => !usedAmbassadors.has(candidate.ambassador)) || null;
    if (uniqueCandidate) {
      usedAmbassadors.add(uniqueCandidate.ambassador);
    }
    return {
      date: dateKey,
      dayNumber: index + 1,
      winner: uniqueCandidate,
      dailyRank: uniqueCandidate ? candidates.indexOf(uniqueCandidate) + 1 : null,
      fieldPosition: uniqueCandidate ? usedAmbassadors.size : null,
    };
  });
}

function getSprintWindow() {
  const from = state.filters.timeFrom || (state.filters.hourFrom !== "all" ? `${String(state.filters.hourFrom).padStart(2, "0")}:00` : "");
  const to = state.filters.timeTo || (state.filters.hourTo !== "all" ? `${String(state.filters.hourTo).padStart(2, "0")}:00` : "");
  const hasSingleDate =
    state.filters.dateExact !== "all" ||
    (state.filters.dateFrom && state.filters.dateFrom === state.filters.dateTo) ||
    (state.filters.projectDay !== "all" && state.filters.projectDay !== "overflow");
  if (!from || !to || !hasSingleDate) {
    return null;
  }
  const date =
    state.filters.dateExact !== "all"
      ? state.filters.dateExact
      : state.filters.dateFrom && state.filters.dateFrom === state.filters.dateTo
        ? state.filters.dateFrom
        : state.meta?.projectDates?.[Number(state.filters.projectDay) - 1] || "";
  if (!date) {
    return null;
  }
  return { from, to, date, dateLabel: formatDate(date) };
}

function computeSprintStandings(referenceRows) {
  const window = getSprintWindow();
  if (!window) {
    return null;
  }
  const leaderboard = buildPrizeCompetitionLeaderboard(referenceRows);
  const winner = leaderboard[0] || null;
  const runnerUp = leaderboard[1] || null;
  return {
    ...window,
    winner,
    runnerUp,
    dealCount: referenceRows.length,
    total: sumAmount(referenceRows),
    leadGap: winner && runnerUp ? Math.max(winner.total - runnerUp.total, 0) : 0,
  };
}

function getActiveFilters() {
  const summary = [];
  if (state.filters.ambassador !== "all") {
    summary.push(`שגריר: ${state.filters.ambassador}`);
  }
  if (state.filters.projectDay !== "all") {
    summary.push(
      state.filters.projectDay === "overflow"
        ? "יום פרויקט: מחוץ לעשרת הימים"
        : `יום פרויקט: ${state.filters.projectDay}`
    );
  }
  if (state.filters.dateExact !== "all") {
    summary.push(`תאריך: ${formatDate(state.filters.dateExact)}`);
  }
  if (state.filters.dateFrom || state.filters.dateTo) {
    summary.push(`טווח תאריכים: ${state.filters.dateFrom || "התחלה פתוחה"} עד ${state.filters.dateTo || "סיום פתוח"}`);
  }
  if (state.filters.hour !== "all") {
    summary.push(`שעה: ${formatHourLabel(state.filters.hour)}`);
  }
  if (state.filters.hourFrom !== "all" || state.filters.hourTo !== "all") {
    summary.push(`טווח שעות: ${state.filters.hourFrom !== "all" ? formatHourLabel(state.filters.hourFrom) : "ללא התחלה"} עד ${state.filters.hourTo !== "all" ? formatHourLabel(state.filters.hourTo) : "ללא סוף"}`);
  }
  if (state.filters.timeFrom || state.filters.timeTo) {
    summary.push(`חלון ספרינט: ${state.filters.timeFrom || "ללא התחלה"} עד ${state.filters.timeTo || "ללא סוף"}`);
  }
  if (state.filters.amountMin !== "" || state.filters.amountMax !== "") {
    summary.push(`סכום: ${state.filters.amountMin || "0"} עד ${state.filters.amountMax || "ללא תקרה"} ₪`);
  }
  if (state.filters.donor.trim()) {
    summary.push(`תורם: ${state.filters.donor.trim()}`);
  }
  return summary;
}

function getActiveFilterSummary() {
  const summary = getActiveFilters();
  return summary.length ? ` | פילוחים פעילים: ${summary.join(" • ")}` : "";
}

function renderActiveFilterSummary() {
  const summary = getActiveFilters();
  elements.activeFilterSummary.textContent = summary.length ? `מסננים פעילים: ${summary.join(" • ")}` : "אין מסננים פעילים";
}

function updateMetricToolbarState() {
  elements.metricButtons.forEach((button) => {
    const selectId = button.dataset.metricSelect;
    const targetSelect = root.querySelector(`#${selectId}`);
    button.classList.toggle("is-active", Boolean(targetSelect) && targetSelect.value === button.dataset.value);
  });
}

function isResetDataState() {
  return Number(state.meta?.rowCount || 0) === 0 && state.rows.length === 0 && state.compare.rows.length === 0;
}

function setControlNote(filteredRows, prizeRows) {
  const compareText = state.compare.rows.length ? ` | השוואה: ${state.compare.label} (${formatNumber(state.compare.rows.length)} רשומות)` : "";
  const resetPrefix = isResetDataState() ? "מאופס | " : "";
  elements.controlNote.textContent = `${resetPrefix}בסיס: ${state.sourceLabel} | חלון ברירת מחדל: ${state.meta.projectWindowLabel || "לא זוהה"} | מוצגות ${formatNumber(filteredRows.length)} עסקאות במסנן | פרסים מחושבים על ${formatNumber(prizeRows.length)} עסקאות בטווח הזמן הנבחר${compareText}${getActiveFilterSummary()}`;
}

function renderPublicHeroBadges(prizeRows) {
  const leaderboard = buildPrizeCompetitionLeaderboard(prizeRows);
  const topLeader = leaderboard[0];
  const total = sumAmount(prizeRows);
  const resetState = isResetDataState();
  const campaignStatus = resetState ? "מאופס" : (prizeRows.length ? "פעיל על בסיס הקובץ הנוכחי" : "ממתין לנתונים");
  const sourceWindow = state.meta.projectWindowLabel || "לא זוהה";
  const leaderValue = topLeader ? escapeHtml(topLeader.ambassador) : "טרם נקבע";
  const leaderMeta = topLeader
    ? `הוביל/ה עד כה עם ${escapeHtml(formatAmount(topLeader.total))}`
    : (resetState ? "כל נתוני התרומות נוקו. אפשר להתחיל להזרים נתוני בדיקה חדשים." : "ברגע שייקלטו נתונים יופיע כאן מוביל/ה נוכחי/ת");
  const datasetFreshnessAt = getDatasetFreshnessIso();
  const updatedText = datasetFreshnessAt ? escapeHtml(formatDateTime(datasetFreshnessAt)) : "אין עדכון";
  const publicBadges = [
    `
      <article class="public-snapshot-card public-snapshot-card--primary">
        <div class="public-snapshot-label">סך גיוס נוכחי</div>
        <div class="public-snapshot-value">${escapeHtml(formatAmount(total))}</div>
        <div class="public-snapshot-meta">זהו הסכום המחושב כרגע מתוך טווח הנתונים הפעיל.</div>
      </article>
    `,
    `
      <article class="public-snapshot-card public-snapshot-card--wide">
        <div class="public-snapshot-label">מוביל/ה כרגע</div>
        <div class="public-snapshot-value">${leaderValue}</div>
        <div class="public-snapshot-meta">${leaderMeta}</div>
      </article>
    `,
    `
      <article class="public-snapshot-card">
        <div class="public-snapshot-label">שגרירים פעילים</div>
        <div class="public-snapshot-value">${escapeHtml(formatNumber(leaderboard.length))}</div>
        <div class="public-snapshot-meta">מספר השגרירים עם גיוס בפועל בטווח המוצג.</div>
      </article>
    `,
    `
      <article class="public-snapshot-card">
        <div class="public-snapshot-label">חלון פרויקט פעיל</div>
        <div class="public-snapshot-value">${escapeHtml(sourceWindow)}</div>
        <div class="public-snapshot-meta">הנתונים מוצגים עבור הטווח הפעיל בקובץ הנוכחי.</div>
      </article>
    `,
    `
      <article class="public-snapshot-card">
        <div class="public-snapshot-label">סטטוס הפרויקט</div>
        <div class="public-snapshot-status">${escapeHtml(campaignStatus)}</div>
        <div class="public-snapshot-meta">התצוגה הציבורית משקפת את מצב הנתונים הזמין כרגע.</div>
      </article>
    `,
    `
      <article class="public-snapshot-card">
        <div class="public-snapshot-label">עדכון נתונים אחרון</div>
        <div class="public-snapshot-value">${updatedText}</div>
        <div class="public-snapshot-meta">זמן הקריאה האחרון ממקור הנתונים.</div>
      </article>
    `,
  ];
  elements.publicHeroBadges.innerHTML = `<div class="public-snapshot-grid">${publicBadges.join("")}</div>`;
}

function renderHeroBadges(filteredRows, prizeRows, compareRows) {
  const filteredTotal = sumAmount(filteredRows);
  const prizeTotal = sumAmount(prizeRows);
  const ambassadorCount = new Set(prizeRows.map((row) => row.ambassador).filter((value) => value && value !== "ללא שיוך")).size;
  const datasetFreshnessAt = getDatasetFreshnessIso();
  const resetState = isResetDataState();
  renderBrandAssets();
  const badges = [
    ...(resetState ? [`<span class="hero-badge">מאופס</span>`] : []),
    `<span class="hero-badge">${escapeHtml(formatAmount(filteredTotal))} בתצוגה הפעילה</span>`,
    `<span class="hero-badge">${escapeHtml(formatNumber(ambassadorCount))} שגרירים פעילים בטווח</span>`,
    `<span class="hero-badge">טווח פרויקט: ${escapeHtml(state.meta.projectWindowLabel || "טווח לא זוהה")}</span>`,
    `<span class="hero-badge">בסיס פרסים: ${escapeHtml(formatAmount(prizeTotal))}</span>`,
  ];
  if (state.compare.rows.length) {
    badges.push(`<span class="hero-badge">השוואה: ${escapeHtml(state.compare.label)} | ${escapeHtml(formatAmount(sumAmount(compareRows)))}</span>`);
  }
  if (datasetFreshnessAt) {
    badges.push(`<span class="hero-badge">עדכון נתונים: ${escapeHtml(formatDateTime(datasetFreshnessAt))}</span>`);
  }
  elements.adminWindowLabel.textContent = state.meta.projectWindowLabel || "לא זוהה";
  elements.adminLastUpdated.textContent = datasetFreshnessAt
    ? formatDateTime(datasetFreshnessAt)
    : (resetState ? "מאופס" : "אין נתונים");
  elements.adminSourceFile.textContent = state.sourceLabel || "קובץ בסיס";
  elements.adminRecordCount.textContent = resetState ? "מאופס" : formatNumber(filteredRows.length);
  elements.heroBadges.innerHTML = badges.join("");
}

function renderMetrics(rows) {
  const context = buildIntelligenceContext(rows);
  const total = sumAmount(rows);
  const totalGoal = Number(state.goals.total || 0);
  const health = intelligenceEngine.buildHealthModel(rows, context);
  const velocity = intelligenceEngine.buildVelocityModel(rows, context);
  const forecast = intelligenceEngine.buildForecastModel(rows, context);
  const ambassadors = intelligenceEngine.buildAmbassadorModels(rows, context);
  const activeAmbassadors = ambassadors.filter((item) => item.hasStarted).length;
  const average = rows.length ? total / rows.length : 0;
  const targetPct = totalGoal > 0 ? total / totalGoal : 0;
  const timeRemainingHours = Math.max(0, Math.round(velocity.bounds.remainingHours));
  const stats = [
    { label: "סכום שגויס", value: totalGoal ? `${formatAmount(total)} / ${formatAmount(totalGoal)}` : formatAmount(total), detail: totalGoal ? `${formatPercent(targetPct)} מהיעד` : "עדיין לא הוגדר יעד" },
    { label: "תחזית סיום", value: formatAmount(forecast.projectedFinal), detail: totalGoal ? `${formatPercent(forecast.projectedTargetPct)} מהיעד | ${forecast.confidence}` : forecast.confidenceReason },
    { label: "זמן שנותר", value: `${formatNumber(timeRemainingHours)} שעות`, detail: `חלון קמפיין: ${formatPercent(velocity.bounds.elapsedRatio)} הושלם` },
    { label: "תרומות", value: formatNumber(rows.length), detail: `ממוצע לתרומה ${formatAmount(average)}` },
    { label: "שגרירים פעילים", value: formatNumber(activeAmbassadors), detail: `${formatNumber(ambassadors.length)} שגרירים מזוהים` },
    { label: "קצב גיוס נוכחי", value: `${formatAmount(velocity.last3Hours.amountPerHour)}/שעה`, detail: `שינוי ${formatSignedPercent(velocity.changeVsPrevious3Hours.amountRatio)} מול 3 השעות הקודמות` },
    { label: "Campaign Health", value: `${formatNumber(health.score)}/100`, detail: health.label },
    { label: "כשלי סליקה", value: formatNumber(rows.filter((row) => row.status === "failed").length), detail: `${formatPercent(rows.length ? rows.filter((row) => row.status === "failed").length / rows.length : 0)} מכלל העסקאות` },
  ];

  elements.metrics.innerHTML = stats
    .map(
      (stat) => `
        <article class="metric-card kpi-card app-card">
          <div class="metric-label">${escapeHtml(stat.label)}</div>
          <div class="metric-value">${escapeHtml(stat.value)}</div>
          <div class="metric-detail">${escapeHtml(stat.detail)}</div>
        </article>
      `
    )
    .join("");
}

function renderGoalsBoard(rows) {
  const totalGoal = Number(state.goals.total || 0);
  const dailyGoal = Number(state.goals.daily || 0);
  const totalRaised = sumAmount(rows);
  const uniqueDates = [...new Set(rows.map((row) => row.date))];
  const activeDays = uniqueDates.length;
  const currentDailyAverage = activeDays ? totalRaised / activeDays : 0;
  const totalProgress = totalGoal > 0 ? totalRaised / totalGoal : 0;
  const dailyProgress = dailyGoal > 0 ? currentDailyAverage / dailyGoal : 0;
  const remainingToTotal = Math.max(0, totalGoal - totalRaised);
  const remainingToDaily = Math.max(0, dailyGoal - currentDailyAverage);

  elements.goalTotal.value = totalGoal || "";
  elements.goalDaily.value = dailyGoal || "";
  elements.goalsSummary.textContent =
    totalGoal || dailyGoal
      ? `יעד כולל: ${formatAmount(totalGoal)} | יעד יומי: ${formatAmount(dailyGoal)}`
      : "עדיין לא הוגדרו יעדים. אפשר להזין יעד כולל ויעד יומי בלוח הבקרה.";

  elements.goalsBoard.innerHTML = `
    <div class="signal-grid">
      <section class="analysis-card">
        <h4>יעד כולל</h4>
        <ul>
          <li>ביצוע בפועל: ${escapeHtml(formatAmount(totalRaised))}</li>
          <li>התקדמות מול יעד: ${escapeHtml(totalGoal ? formatPercent(totalProgress) : "לא הוגדר יעד")}</li>
          <li>יתרה להשגה: ${escapeHtml(totalGoal ? formatAmount(remainingToTotal) : "לא הוגדר יעד")}</li>
        </ul>
      </section>
      <section class="analysis-card">
        <h4>יעד יומי</h4>
        <ul>
          <li>ממוצע יומי במסנן: ${escapeHtml(formatAmount(currentDailyAverage))}</li>
          <li>התקדמות מול יעד יומי: ${escapeHtml(dailyGoal ? formatPercent(dailyProgress) : "לא הוגדר יעד")}</li>
          <li>פער יומי נוכחי: ${escapeHtml(dailyGoal ? formatAmount(remainingToDaily) : "לא הוגדר יעד")}</li>
        </ul>
      </section>
      <section class="analysis-card">
        <h4>קריאה ניהולית</h4>
        <ul>
          <li>${escapeHtml(activeDays ? `המסנן מכסה ${formatNumber(activeDays)} ימי פעילות.` : "אין ימי פעילות בטווח הנבחר.")}</li>
          <li>${escapeHtml(totalGoal ? (totalRaised >= totalGoal ? "היעד הכולל הושג או נעקף." : `נדרש עוד ${formatAmount(remainingToTotal)} כדי להגיע ליעד הכולל.`) : "כדאי להגדיר יעד כולל כדי למדוד פער לביצוע.")}</li>
          <li>${escapeHtml(dailyGoal ? (currentDailyAverage >= dailyGoal ? "הקצב היומי נמצא מעל היעד." : `הקצב היומי נמוך ב-${formatAmount(remainingToDaily)} מהיעד.`) : "כדאי להגדיר יעד יומי כדי להבין אם הקצב בריא.")}</li>
        </ul>
      </section>
    </div>
  `;
}

function renderValidationBoard() {
  const items = [state.validation.base, state.validation.compare].filter(Boolean);
  if (!items.length) {
    elements.validationSummary.textContent = "";
    elements.validationBoard.innerHTML = `<div class="empty-state">העלה קובץ כדי לקבל דוח ולידציה, שגיאות ואזהרות.</div>`;
    return;
  }

  const totalErrors = items.reduce((sum, item) => sum + item.errors.length, 0);
  const totalWarnings = items.reduce((sum, item) => sum + item.warnings.length, 0);
  elements.validationSummary.textContent = `${formatNumber(totalErrors)} שגיאות | ${formatNumber(totalWarnings)} אזהרות | ${items.length} קובצי קלט מנותחים`;

  elements.validationBoard.innerHTML = `
    <div class="signal-grid">
      ${items
        .map(
          (item) => `
            <section class="analysis-card quality">
              <h4>${escapeHtml(item.label)}</h4>
              <ul>
                <li>שורות מקור: ${escapeHtml(formatNumber(item.totalRows))} | שורות תקינות לטעינה: ${escapeHtml(formatNumber(item.validRows.length))}</li>
                <li>שגיאות: ${escapeHtml(item.errors.length ? item.errors.join(" | ") : "לא זוהו שגיאות חסימה")}</li>
                <li>אזהרות: ${escapeHtml(item.warnings.length ? item.warnings.join(" | ") : "לא זוהו אזהרות")}</li>
              </ul>
            </section>
          `
        )
        .join("")}
    </div>
  `;
}

function buildExecutiveModel(rows) {
  const summary = buildDatasetSummary(rows, "current");
  const failedCount = rows.filter((row) => row.status === "failed").length;
  const lastDate = [...new Set(rows.map((row) => row.date))].sort().slice(-1)[0] || "";
  return {
    ...summary,
    failedCount,
    lastDate,
  };
}

function renderExecutiveBoard(rows) {
  if (!rows.length) {
    elements.executiveSummary.textContent = "";
    elements.executiveBoard.innerHTML = `<div class="empty-state">אין נתונים להצגה עבור הסיכום הניהולי.</div>`;
    return;
  }

  const context = buildIntelligenceContext(rows);
  const velocity = intelligenceEngine.buildVelocityModel(rows, context);
  const health = intelligenceEngine.buildHealthModel(rows, context);
  const forecast = intelligenceEngine.buildForecastModel(rows, context);
  const attentionItems = intelligenceEngine.buildAttentionNow(rows, context);
  const model = buildExecutiveModel(rows);
  elements.executiveSummary.textContent = `${health.label} | תחזית ${formatAmount(forecast.projectedFinal)} | ${attentionItems.length} נקודות טיפול פתוחות`;

  const cards = [
    {
      title: "Campaign Health",
      items: [
        `ציון בריאות הקמפיין עומד על ${formatNumber(health.score)} מתוך 100 ומסווג כ-${health.label}.`,
        ...health.reasons.map((item) => item.text),
      ],
    },
    {
      title: "Forecast & Trajectory",
      items: [
        `תחזית הסיום הנוכחית היא ${formatAmount(forecast.projectedFinal)}.`,
        Number(state.goals.total || 0) > 0
          ? `המשמעות היא ${formatPercent(forecast.projectedTargetPct)} מהיעד הכולל ו-${forecast.gapOrSurplus >= 0 ? "עודף" : "פער"} של ${formatAmount(Math.abs(forecast.gapOrSurplus))}.`
          : "טרם הוגדר יעד כולל, ולכן התחזית מוצגת ללא אחוז יעד.",
        `מהירות 3 השעות האחרונות: ${formatAmount(velocity.last3Hours.amountPerHour)}/שעה מול ממוצע קמפיין של ${formatAmount(velocity.campaignAverage.amountPerHour)}/שעה.`,
      ],
    },
    {
      title: "מה דורש טיפול עכשיו?",
      items: attentionItems.length
        ? attentionItems.slice(0, 3).map((item) => `${item.issue} ${item.evidence ? `| ${item.evidence}` : ""} | פעולה: ${item.action}`)
        : ["לא זוהו כרגע חריגות משמעותיות שמחייבות פעולה מיידית."],
    },
    {
      title: "תמונת מצב מנהלית",
      items: [
        `סך הגיוס כרגע הוא ${formatAmount(model.total)} מתוך ${formatNumber(model.deals)} עסקאות.`,
        model.topAmbassador ? `המוביל/ה כרגע: ${model.topAmbassador.ambassador} עם ${formatAmount(model.topAmbassador.total)}.` : "אין שגריר מוביל מזוהה.",
        `יש ${formatNumber(model.failedCount)} עסקאות שנכשלו ו-${formatNumber(model.ambassadorCount)} שגרירים פעילים בפילוח הנוכחי.`,
      ],
    },
  ];

  elements.executiveBoard.innerHTML = `
    <div class="signal-grid">
      ${cards
        .map(
          (card) => `
            <section class="analysis-card">
              <h4>${escapeHtml(card.title)}</h4>
              <ul>
                ${card.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
              </ul>
            </section>
          `
        )
        .join("")}
    </div>
  `;
}

function buildDataQualityModel(rows) {
  const failedRows = rows.filter((row) => row.status === "failed");
  const missingAmbassador = rows.filter((row) => row.ambassador === "ללא שיוך");
  const zeroAmount = rows.filter((row) => row.amount <= 0);
  const outOfWindow = rows.filter((row) => row.projectDay === null);
  const duplicateMap = new Map();
  rows.forEach((row) => {
    const donorKey = `${row.date}|${(row.email || row.donor || "").toLowerCase()}|${row.amount}`;
    if (!donorKey.includes("||0")) {
      duplicateMap.set(donorKey, (duplicateMap.get(donorKey) || 0) + 1);
    }
  });
  const duplicateCandidates = [...duplicateMap.values()].filter((count) => count > 1).reduce((sum, count) => sum + count, 0);
  const amounts = rows.map((row) => row.amount).filter((amount) => amount > 0).sort((left, right) => left - right);
  const percentileIndex = amounts.length ? Math.max(0, Math.floor(amounts.length * 0.95) - 1) : 0;
  const p95 = amounts[percentileIndex] || 0;
  const highOutliers = rows.filter((row) => row.amount >= Math.max(2500, p95));
  const failureReasons = [...groupBy(failedRows, (row) => row.chargeResult || "לא סופק קוד").entries()]
    .map(([reason, items]) => ({ reason, count: items.length }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 4);

  return {
    failedRows,
    missingAmbassador,
    zeroAmount,
    outOfWindow,
    duplicateCandidates,
    highOutliers,
    p95,
    failureReasons,
  };
}

function renderQualityBoard(rows) {
  if (!rows.length) {
    elements.qualitySummary.textContent = "";
    elements.qualityBoard.innerHTML = `<div class="empty-state">אין נתונים להצגה עבור איכות הנתונים.</div>`;
    return;
  }

  const model = buildDataQualityModel(rows);
  elements.qualitySummary.textContent = `כשלים: ${formatNumber(model.failedRows.length)} | שיוך חסר: ${formatNumber(model.missingAmbassador.length)} | כפילויות חשודות: ${formatNumber(model.duplicateCandidates)}`;

  const cards = [
    {
      title: "שיוך ושלמות",
      items: [
        `ל-${formatNumber(model.missingAmbassador.length)} רשומות אין שיוך שגריר/ה.`,
        `${formatNumber(model.outOfWindow.length)} רשומות נמצאות מחוץ לחלון הפרויקט.`,
        `${formatNumber(model.zeroAmount.length)} רשומות עם סכום אפס או חסר.`,
      ],
    },
    {
      title: "גבייה וכשלים",
      items: model.failureReasons.length
        ? model.failureReasons.map((item) => `${item.reason}: ${formatNumber(item.count)} עסקאות כושלות.`)
        : [`אין כרגע קודי כשל בולטים בתוך המסנן.`],
    },
    {
      title: "חריגים וכפילויות",
      items: [
        `${formatNumber(model.duplicateCandidates)} רשומות נראות כמו כפילויות אפשריות לפי תאריך, מזהה תורם וסכום.`,
        `${formatNumber(model.highOutliers.length)} עסקאות נמצאות מעל סף חריגות של ${formatAmount(Math.max(2500, model.p95))}.`,
        model.highOutliers[0] ? `העסקה החריגה הגבוהה ביותר כרגע היא ${formatAmount(Math.max(...model.highOutliers.map((row) => row.amount)))}.` : `אין כרגע עסקאות חריגות.`,
      ],
    },
  ];

  elements.qualityBoard.innerHTML = `
    <div class="signal-grid">
      ${cards
        .map(
          (card) => `
            <section class="analysis-card quality">
              <h4>${escapeHtml(card.title)}</h4>
              <ul>
                ${card.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
              </ul>
            </section>
          `
        )
        .join("")}
    </div>
  `;
}

function buildSegmentModel(rows) {
  const bucketDefinitions = [
    { label: "עד ₪99", min: 0, max: 99.999 },
    { label: "₪100-249", min: 100, max: 249.999 },
    { label: "₪250-499", min: 250, max: 499.999 },
    { label: "₪500-999", min: 500, max: 999.999 },
    { label: "₪1000+", min: 1000, max: Infinity },
  ];
  const buckets = bucketDefinitions.map((bucket) => {
    const items = rows.filter((row) => row.amount >= bucket.min && row.amount <= bucket.max);
    return {
      ...bucket,
      count: items.length,
      total: sumAmount(items),
    };
  });
  const maxBucketCount = Math.max(...buckets.map((bucket) => bucket.count), 1);
  const topDonors = [...groupBy(rows, (row) => row.donor).entries()]
    .map(([donor, items]) => ({ donor, total: sumAmount(items), count: items.length }))
    .filter((item) => item.donor && item.donor !== "ללא שם")
    .sort((left, right) => right.total - left.total)
    .slice(0, 5);
  const statusCounts = [...groupBy(rows, (row) => row.status).entries()]
    .map(([status, items]) => ({ status, count: items.length, total: sumAmount(items) }))
    .sort((left, right) => right.count - left.count);
  return {
    buckets,
    maxBucketCount,
    topDonors,
    statusCounts,
  };
}

function renderSegmentBoard(rows) {
  if (!rows.length) {
    elements.segmentSummary.textContent = "";
    elements.segmentBoard.innerHTML = `<div class="empty-state">אין נתונים להצגה עבור פילוח העסקאות.</div>`;
    return;
  }

  const model = buildSegmentModel(rows);
  const context = buildIntelligenceContext(rows);
  const ambassadors = intelligenceEngine.buildAmbassadorModels(rows, context);
  const priorities = intelligenceEngine.buildPriorityList(rows, context);
  const largeBucket = model.buckets[model.buckets.length - 1];
  elements.segmentSummary.textContent = `זוהו ${formatNumber(ambassadors.length)} שגרירים ו-${formatNumber(priorities.length)} הזדמנויות פעולה מיידיות.`;

  elements.segmentBoard.innerHTML = `
    <div class="segment-grid">
      <section class="analysis-card">
        <h4>Who Should I Contact Now?</h4>
        <ul>
          ${priorities.length
            ? priorities
                .slice(0, 6)
                .map((item) => `<li><strong>${escapeHtml(item.ambassador)}</strong> | ${escapeHtml(item.reason)} | ${escapeHtml(item.action)}</li>`)
                .join("")
            : `<li>לא זוהו כרגע הזדמנויות פעולה ממוקדות.</li>`}
        </ul>
      </section>
      <section class="analysis-card">
        <h4>Ambassador Intelligence</h4>
        <ul>
          ${ambassadors.length
            ? ambassadors
                .slice()
                .sort((left, right) => right.total - left.total)
                .slice(0, 6)
                .map(
                  (item) => `<li><strong>${escapeHtml(item.ambassador)}</strong> | ${escapeHtml(item.status)} | ${escapeHtml(formatAmount(item.total))} | ${escapeHtml(item.target ? formatPercent(item.targetProgress) : "ללא יעד")} | ${escapeHtml(item.hoursSinceActivity ? `${Math.round(item.hoursSinceActivity)} שעות ללא פעילות` : "פעיל כעת")}</li>`
                )
                .join("")
            : `<li>אין שגרירים להצגה בטווח המסונן.</li>`}
        </ul>
      </section>
      <section class="analysis-card">
        <h4>התפלגות סכומי תרומה</h4>
        <div class="bucket-row">
          ${model.buckets
            .map(
              (bucket) => `
                <div class="bucket-item">
                  <div class="bucket-head">
                    <span>${escapeHtml(bucket.label)}</span>
                    <span class="text-small text-muted">${escapeHtml(formatNumber(bucket.count))} עסקאות | ${escapeHtml(formatAmount(bucket.total))}</span>
                  </div>
                  <div class="bucket-bar"><div class="bucket-fill" style="width:${(bucket.count / model.maxBucketCount) * 100}%"></div></div>
                </div>
              `
            )
            .join("")}
        </div>
        <div class="text-small text-muted">עסקאות של ₪1000+ מהוות ${escapeHtml(formatNumber(largeBucket.count))} עסקאות ו-${escapeHtml(formatAmount(largeBucket.total))} מהמחזור המסונן.</div>
      </section>
    </div>
  `;
}

function renderComparisonBoard(baseRows, compareRows) {
  if (!state.compare.rows.length) {
    elements.comparisonSummary.textContent = "";
    elements.comparisonBoard.innerHTML = `<div class="empty-state">העלה קובץ השוואה שני כדי לקבל תקציר, עובדות, נקודות קריטיות ותובנות בין שני הקבצים.</div>`;
    return;
  }

  if (!baseRows.length && !compareRows.length) {
    elements.comparisonSummary.textContent = "";
    elements.comparisonBoard.innerHTML = `<div class="empty-state">שני הקבצים ריקים בטווח שנבחר.</div>`;
    return;
  }

  const comparison = buildComparisonModel(baseRows, compareRows);
  elements.comparisonSummary.textContent = `${comparison.base.label} מול ${comparison.compare.label} | חפיפת שגרירים: ${formatNumber(comparison.overlapCount)}`;

  const deltaClass = (value) => (value > 0 ? "is-up" : value < 0 ? "is-down" : "");
  const metricCards = [
    {
      label: "סך גיוס",
      base: formatAmount(comparison.base.total),
      compare: formatAmount(comparison.compare.total),
      delta: formatSignedCurrency(comparison.totalDelta),
      className: deltaClass(comparison.totalDelta),
    },
    {
      label: "מספר עסקאות",
      base: formatNumber(comparison.base.deals),
      compare: formatNumber(comparison.compare.deals),
      delta: formatSignedNumber(comparison.dealsDelta),
      className: deltaClass(comparison.dealsDelta),
    },
    {
      label: "ממוצע לעסקה",
      base: formatAmount(comparison.base.average),
      compare: formatAmount(comparison.compare.average),
      delta: formatSignedCurrency(comparison.averageDelta),
      className: deltaClass(comparison.averageDelta),
    },
    {
      label: "שיעור הצלחה",
      base: formatPercent(comparison.base.successRate),
      compare: formatPercent(comparison.compare.successRate),
      delta: formatSignedPercentPoints(comparison.successDelta),
      className: deltaClass(comparison.successDelta),
    },
  ];

  elements.comparisonBoard.innerHTML = `
    <div class="comparison-metric-grid">
      ${metricCards
        .map(
          (card) => `
            <article class="comparison-card">
              <h4>${escapeHtml(card.label)}</h4>
              <div class="comparison-main">
                <div class="comparison-value">${escapeHtml(card.compare)}</div>
                <span class="comparison-delta ${card.className}">${escapeHtml(card.delta)}</span>
              </div>
              <div class="text-small text-muted">${escapeHtml(comparison.compare.label)} מול ${escapeHtml(comparison.base.label)}</div>
              <div class="text-small text-muted">בסיס: ${escapeHtml(card.base)}</div>
            </article>
          `
        )
        .join("")}
    </div>
    <div class="comparison-lists">
      <section class="comparison-list">
        <h4>תקציר ועובדות</h4>
        <ul>
          ${comparison.facts.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </section>
      <section class="comparison-list critical">
        <h4>נקודות קריטיות</h4>
        <ul>
          ${comparison.critical.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </section>
      <section class="comparison-list insights">
        <h4>תובנות בין הקבצים</h4>
        <ul>
          ${comparison.insights.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </section>
    </div>
  `;
}

function renderPrizeBoard(prizeRows) {
  const standings = computePrizeStandings(prizeRows);
  const { placeWinners, tiers, prizeModel, selectedFocus } = standings;

  elements.prizeSummary.textContent = selectedFocus
    ? `${selectedFocus.ambassador}: ${formatAmount(selectedFocus.total)} | פרס פעיל: ${selectedFocus.currentPrize}${selectedFocus.nextPrize ? ` | חסרים ${formatAmount(selectedFocus.gap)} ל-${selectedFocus.nextPrize}` : " | נמצא במדרגה העליונה"}` : `${formatNumber(standings.leaderboard.length)} שגרירים מדורגים בטווח הזמן הנבחר`;

  const podiumMarkup = placeWinners.length
    ? `
        <div class="dashboard-section">
          <div class="section-head">
            <h3>פרסי מקומות</h3>
            <div class="text-small text-muted">מקומות 1-3 מחושבים לפי סכום הגיוס המצטבר בטווח המסונן.</div>
          </div>
          <div class="podium-grid">
            ${placeWinners
              .map((item) => {
                const winner = item.winner;
                const isFocus = winner && state.filters.ambassador !== "all" && winner.ambassador === state.filters.ambassador;
                return `
                  <article class="prize-card place-card">
                    <div class="prize-visual">
                      <div class="podium-mark">
                        <svg viewBox="0 0 220 120" role="img" aria-label="${escapeAttribute(item.label)}">
                          <rect x="24" y="64" width="48" height="34" rx="8" fill="rgba(255,217,61,0.95)"></rect>
                          <rect x="86" y="38" width="48" height="60" rx="8" fill="rgba(255,255,255,0.96)"></rect>
                          <rect x="148" y="54" width="48" height="44" rx="8" fill="rgba(255,217,61,0.72)"></rect>
                          <text x="110" y="26" text-anchor="middle" fill="white" font-size="22" font-weight="700">${escapeHtml(String(item.place))}</text>
                        </svg>
                      </div>
                    </div>
                    <div class="prize-content">
                      <div class="prize-title-row">
                        <div class="prize-title">${escapeHtml(item.label)}</div>
                        <span class="prize-pill">${escapeHtml(item.prize)}</span>
                      </div>
                      ${
                        winner
                          ? `
                            <div class="winner-list">
                              <div class="winner-item${isFocus ? " is-focus" : ""}">
                                <span class="winner-rank">${escapeHtml(String(item.place))}</span>
                                <div>
                                  <div class="winner-name">${escapeHtml(winner.ambassador)}</div>
                                  <div class="text-small text-muted">${escapeHtml(formatNumber(winner.deals))} עסקאות</div>
                                </div>
                                <div class="winner-amount">${escapeHtml(formatAmount(winner.total))}</div>
                              </div>
                            </div>
                          `
                          : `<div class="empty-state">עדיין אין זוכה למקום הזה בטווח שנבחר.</div>`
                      }
                    </div>
                  </article>
                `;
              })
              .join("")}
          </div>
        </div>
      `
    : "";

  const tiersMarkup = tiers.length
    ? `
        <div class="dashboard-section">
          <div class="section-head">
            <h3>מדרגות פרס</h3>
            <div class="text-small text-muted">${escapeHtml(prizeModel.tierRuleNote || "שדרוג מדרגה מחליף את הפרס הפעיל, ובמדרגה הראשונה נשמרת זכאות למרצ' העמותה.")}</div>
          </div>
          <div class="tier-grid">
            ${tiers
              .map((tier, index) => {
                const winners = tier.active.slice(0, 5);
                const carryoverNote =
                  index === 0 && tier.carryover.length
                    ? `<div class="status-note text-small">נשארים זכאים גם אחרי שדרוג: ${escapeHtml(formatNumber(tier.carryover.length))} שגרירים</div>`
                    : "";
                return `
                  <article class="prize-card">
                    <div class="prize-visual">
                      <div class="tier-mark">
                        <svg viewBox="0 0 240 132" role="img" aria-label="${escapeAttribute(tier.prize)}">
                          <rect x="24" y="${82 - index * 6}" width="48" height="${30 + index * 6}" rx="10" fill="rgba(255,255,255,0.92)"></rect>
                          <rect x="86" y="${56 - index * 6}" width="48" height="${56 + index * 6}" rx="10" fill="rgba(19,23,80,0.96)"></rect>
                          <rect x="148" y="${34 - index * 6}" width="48" height="${78 + index * 6}" rx="10" fill="rgba(255,255,255,0.92)"></rect>
                          <circle cx="120" cy="24" r="14" fill="rgba(255,217,61,0.96)"></circle>
                        </svg>
                      </div>
                    </div>
                    <div class="prize-content">
                      <div class="prize-title-row">
                        <div class="prize-title">${escapeHtml(formatAmount(tier.threshold))}</div>
                        <span class="prize-pill">${escapeHtml(tier.prize)}</span>
                      </div>
                      <div class="text-small text-muted">זוכים פעילים כרגע: ${escapeHtml(formatNumber(tier.active.length))}</div>
                      ${carryoverNote}
                      ${
                        winners.length
                          ? `
                            <div class="winner-list">
                              ${winners
                                .map((winner, winnerIndex) => {
                                  const isFocus = state.filters.ambassador !== "all" && winner.ambassador === state.filters.ambassador;
                                  return `
                                    <div class="winner-item${isFocus ? " is-focus" : ""}">
                                      <span class="winner-rank">${escapeHtml(String(winnerIndex + 1))}</span>
                                      <div>
                                        <div class="winner-name">${escapeHtml(winner.ambassador)}</div>
                                        <div class="text-small text-muted">${escapeHtml(formatNumber(winner.deals))} עסקאות</div>
                                      </div>
                                      <div class="winner-amount">${escapeHtml(formatAmount(winner.total))}</div>
                                    </div>
                                  `;
                                })
                                .join("")}
                            </div>
                          `
                          : `<div class="empty-state">עדיין אין זכאים פעילים במדרגה הזאת.</div>`
                      }
                    </div>
                  </article>
                `;
              })
              .join("")}
          </div>
        </div>
      `
    : `<div class="empty-state">לא נטענה טבלת פרסים תקפה. אפשר להעלות קובץ פרסים חדש ב-CSV או Excel.</div>`;

  elements.prizeBoard.innerHTML = `${podiumMarkup}${tiersMarkup}`;
}

function renderPrizeBoard(prizeRows) {
  const standings = computePrizeStandings(prizeRows);
  const dailyWinners = computeDailyWinners(prizeRows);
  const sprint = computeSprintStandings(getSprintScopeRows());
  const { placeWinners, tiers, prizeModel, selectedFocus } = standings;

  renderPrizeAmbassadorDirectory(standings.leaderboard);

  elements.prizeSummary.textContent = state.auth.publicDatasetStatus === "unavailable"
    ? `נתוני אמת אינם זמינים כרגע: ${state.auth.publicDatasetError || "יש לנסות שוב בעוד רגע."}`
    : selectedFocus
    ? `${selectedFocus.ambassador}: ${formatAmount(selectedFocus.total)} | פרס פעיל: ${selectedFocus.currentPrize}${selectedFocus.nextPrize ? ` | חסרים ${formatAmount(selectedFocus.gap)} ל-${selectedFocus.nextPrize}` : " | נמצא במדרגה העליונה"}`
    : sprint?.winner
    ? `ספרינט ${sprint.dateLabel}, ${sprint.from}-${sprint.to}: ${sprint.winner.ambassador} מוביל/ה עם ${formatAmount(sprint.winner.total)}`
    : `${formatNumber(standings.leaderboard.length)} שגרירים מדורגים בטווח הזמן הנבחר`;

  const sprintMarkup = sprint
    ? `
        <div class="dashboard-section">
          <div class="section-head">
            <h3>תמונת מצב ספרינט</h3>
            <div class="text-small text-muted">${escapeHtml(`${sprint.dateLabel} | ${sprint.from}-${sprint.to}`)}. התוצאה מחושבת רק מתרומות מוצלחות בחלון שנבחר.</div>
          </div>
          <div class="signal-grid">
            <article class="analysis-card">
              <h4>מוביל/ת הספרינט</h4>
              <strong>${escapeHtml(sprint.winner ? sprint.winner.ambassador : "טרם נקבע")}</strong>
              <p>${escapeHtml(sprint.winner ? `${formatAmount(sprint.winner.total)} | ${formatNumber(sprint.winner.deals)} עסקאות` : "אין תרומות זכאיות בחלון זה.")}</p>
            </article>
            <article class="analysis-card">
              <h4>פרס הספרינט</h4>
              <strong>${escapeHtml(prizeModel.sprintPrize || "טרם הוגדר")}</strong>
              <p>${escapeHtml(prizeModel.sprintPrize ? "הפרס מיועד למוביל/ת בחלון הספרינט הפעיל." : "ניתן להגדיר אותו בהגדרות הפרסים של הקמפיין.")}</p>
            </article>
            <article class="analysis-card">
              <h4>פער מהמקום השני</h4>
              <strong>${escapeHtml(sprint.runnerUp ? formatAmount(sprint.leadGap) : "אין עדיין מקום שני")}</strong>
              <p>${escapeHtml(sprint.runnerUp ? `${sprint.runnerUp.ambassador} עם ${formatAmount(sprint.runnerUp.total)}` : "נדרש לפחות שגריר נוסף עם גיוס בחלון.")}</p>
            </article>
            <article class="analysis-card">
              <h4>היקף הספרינט</h4>
              <strong>${escapeHtml(formatAmount(sprint.total))}</strong>
              <p>${escapeHtml(`${formatNumber(sprint.dealCount)} עסקאות בטווח שנבחר`)}</p>
            </article>
          </div>
        </div>
      `
    : "";

  const podiumMarkup = placeWinners.length
    ? `
        <div class="dashboard-section">
          <div class="section-head">
            <h3>פודיום מובילים</h3>
            <div class="text-small text-muted">שלושת המקומות הראשונים מחושבים לפי סכום הגיוס המצטבר בתצוגה הפעילה.</div>
          </div>
          <div class="podium-grid">
            ${placeWinners
              .map((item, index) => {
                const winner = item.winner;
                const nextWinner = placeWinners[index + 1]?.winner || null;
                const isFocus = winner && state.filters.ambassador !== "all" && winner.ambassador === state.filters.ambassador;
                const leadGap = winner && nextWinner ? Math.max(winner.total - nextWinner.total, 0) : 0;
                return `
                  <article class="prize-card place-card place-card--${item.place}">
                    <div class="prize-visual">
                      <div class="podium-mark">
                        <svg viewBox="0 0 220 120" role="img" aria-label="${escapeAttribute(item.label)}">
                          <rect x="24" y="64" width="48" height="34" rx="8" fill="rgba(255,214,41,0.92)"></rect>
                          <rect x="86" y="38" width="48" height="60" rx="8" fill="rgba(255,255,255,0.96)"></rect>
                          <rect x="148" y="54" width="48" height="44" rx="8" fill="rgba(255,214,41,0.62)"></rect>
                          <text x="110" y="26" text-anchor="middle" fill="white" font-size="22" font-weight="700">${escapeHtml(String(item.place))}</text>
                        </svg>
                      </div>
                    </div>
                    <div class="prize-content">
                      <div class="prize-title-row">
                        <div class="prize-title">${escapeHtml(item.label)}</div>
                        <span class="prize-pill">${escapeHtml(item.prize)}</span>
                      </div>
                      ${
                        winner
                          ? `
                            <div class="winner-list">
                              <div class="winner-item${isFocus ? " is-focus" : ""}">
                                <span class="winner-rank">${escapeHtml(String(item.place))}</span>
                                <div>
                                  <div class="winner-name">${escapeHtml(winner.ambassador)}</div>
                                  <div class="text-small text-muted">${escapeHtml(formatNumber(winner.deals))} עסקאות</div>
                                </div>
                                <div class="winner-amount">${escapeHtml(formatAmount(winner.total))}</div>
                              </div>
                            </div>
                            <div class="prize-meta">
                              <span>פרס: ${escapeHtml(item.prize)}</span>
                              <span>${escapeHtml(nextWinner ? `פער מהמקום הבא: ${formatAmount(leadGap)}` : "מוביל את הטבלה כרגע")}</span>
                            </div>
                          `
                          : `<div class="empty-state">עדיין אין זוכה למקום הזה בטווח שנבחר.</div>`
                      }
                    </div>
                  </article>
                `;
              })
              .join("")}
          </div>
        </div>
      `
    : "";

  const dailyWinnersMarkup = dailyWinners.length
    ? `
        <div class="dashboard-section">
          <div class="section-head">
            <h3>טבלת דירוג יומית - עולים לדשא</h3>
            <div class="text-small text-muted">עד עשרה עולים שונים: בכל יום נבחר/ת המוביל/ה היומי/ת. מי שכבר עלה/תה לדשא ביום קודם מדולג/ת והבא/ה בדירוג נבחר/ת במקומו/ה.</div>
          </div>
          <div class="daily-winners-table-wrap">
            <table class="daily-winners-table">
              <thead>
                <tr>
                  <th scope="col">יום</th>
                  <th scope="col">תאריך</th>
                  <th scope="col">מוביל/ה יומי/ת</th>
                  <th scope="col">דירוג יומי</th>
                  <th scope="col">גיוס יומי</th>
                  <th scope="col">סטטוס</th>
                </tr>
              </thead>
              <tbody>
                ${dailyWinners
                  .map((item) => {
                    const winner = item.winner;
                    return `
                      <tr>
                        <td><span class="daily-winner-day">יום ${escapeHtml(String(item.dayNumber))}</span></td>
                        <td>${escapeHtml(formatDate(item.date))}</td>
                        <td>
                          <strong>${escapeHtml(winner ? winner.ambassador : "אין עדיין מועמד/ת חדש/ה")}</strong>
                          ${winner ? `<span class="daily-winner-deals">${escapeHtml(formatNumber(winner.deals))} עסקאות</span>` : ""}
                        </td>
                        <td>${winner ? `#${escapeHtml(String(item.dailyRank))}` : "-"}</td>
                        <td>${winner ? escapeHtml(formatAmount(winner.total)) : "-"}</td>
                        <td>
                          ${
                            winner
                              ? `<span class="daily-winner-status">עולה לדשא #${escapeHtml(String(item.fieldPosition))}</span>`
                              : `<span class="daily-winner-status is-pending">ממתין לנתונים</span>`
                          }
                        </td>
                      </tr>
                    `;
                  })
                  .join("")}
              </tbody>
            </table>
          </div>
        </div>
      `
    : "";

  const tiersMarkup = tiers.length
    ? `
        <div class="dashboard-section">
          <div class="section-head">
            <h3>מדרגות פרס</h3>
            <div class="text-small text-muted">${escapeHtml(prizeModel.tierRuleNote || "שדרוג מדרגה מחליף את הפרס הפעיל, ובמדרגה הראשונה נשמרת זכאות למרצ' העמותה.")}</div>
          </div>
          <div class="tier-grid">
            ${tiers
              .map((tier, index) => {
                const winners = tier.active.slice(0, 5);
                const nearestCandidate =
                  [...standings.leaderboard]
                    .filter((entry) => entry.total < tier.threshold)
                    .sort((left, right) => right.total - left.total)[0] || null;
                const progressBasis = nearestCandidate ? nearestCandidate.total : winners[0]?.total || 0;
                const progressPct = tier.threshold ? Math.min(progressBasis / tier.threshold, 1) * 100 : 0;
                const carryoverNote =
                  index === 0 && tier.carryover.length
                    ? `<div class="status-note text-small">נשארים זכאים גם אחרי שדרוג: ${escapeHtml(formatNumber(tier.carryover.length))} שגרירים</div>`
                    : "";
                return `
                  <article class="prize-card">
                    <div class="prize-visual">
                      <div class="tier-mark">
                        <svg viewBox="0 0 240 132" role="img" aria-label="${escapeAttribute(tier.prize)}">
                          <rect x="24" y="${82 - index * 6}" width="48" height="${30 + index * 6}" rx="10" fill="rgba(255,255,255,0.92)"></rect>
                          <rect x="86" y="${56 - index * 6}" width="48" height="${56 + index * 6}" rx="10" fill="rgba(17,29,74,0.96)"></rect>
                          <rect x="148" y="${34 - index * 6}" width="48" height="${78 + index * 6}" rx="10" fill="rgba(255,255,255,0.92)"></rect>
                          <circle cx="120" cy="24" r="14" fill="rgba(255,214,41,0.96)"></circle>
                        </svg>
                      </div>
                    </div>
                    <div class="prize-content">
                      <div class="prize-title-row">
                        <div class="prize-title">${escapeHtml(formatAmount(tier.threshold))}</div>
                        <span class="prize-pill">${escapeHtml(tier.prize)}</span>
                      </div>
                      <div class="text-small text-muted">זוכים פעילים כרגע: ${escapeHtml(formatNumber(tier.active.length))}</div>
                      <div class="progress-track" aria-hidden="true"><div class="progress-fill" style="width:${progressPct}%"></div></div>
                      <div class="prize-meta">
                        <span>${escapeHtml(tier.active.length ? "המדרגה הושגה" : "עדיין לא הושגה")}</span>
                        <span>${escapeHtml(nearestCandidate ? `${nearestCandidate.ambassador} קרוב/ה עם פער של ${formatAmount(tier.threshold - nearestCandidate.total)}` : "אין כרגע מועמד/ת קרוב/ה")}</span>
                      </div>
                      ${carryoverNote}
                      ${
                        winners.length
                          ? `
                            <div class="winner-list">
                              ${winners
                                .map((winner, winnerIndex) => {
                                  const isFocus = state.filters.ambassador !== "all" && winner.ambassador === state.filters.ambassador;
                                  return `
                                    <div class="winner-item${isFocus ? " is-focus" : ""}">
                                      <span class="winner-rank">${escapeHtml(String(winnerIndex + 1))}</span>
                                      <div>
                                        <div class="winner-name">${escapeHtml(winner.ambassador)}</div>
                                        <div class="text-small text-muted">${escapeHtml(formatNumber(winner.deals))} עסקאות</div>
                                      </div>
                                      <div class="winner-amount">${escapeHtml(formatAmount(winner.total))}</div>
                                    </div>
                                  `;
                                })
                                .join("")}
                            </div>
                          `
                          : `<div class="empty-state">עדיין אין זכאים פעילים במדרגה הזאת.</div>`
                      }
                    </div>
                  </article>
                `;
              })
              .join("")}
          </div>
        </div>
      `
    : `<div class="empty-state">לא נטענה טבלת פרסים תקפה. אפשר להעלות קובץ פרסים חדש ב-CSV או Excel.</div>`;

  elements.prizeBoard.innerHTML = `${sprintMarkup}${podiumMarkup}${dailyWinnersMarkup}${tiersMarkup}`;
}

function renderPrizeAmbassadorDirectory(leaderboard) {
  if (!elements.prizeAmbassadorDirectory) {
    return;
  }
  const search = normalizeSearchToken(state.ui.prizeAmbassadorSearch);
  const eligible = (Array.isArray(leaderboard) ? leaderboard : []).filter((entry) => Number(entry.total || 0) >= 20);
  const matches = eligible.filter((entry) => !search || normalizeSearchToken(entry.ambassador).includes(search));

  if (elements.prizeAmbassadorSearch && elements.prizeAmbassadorSearch.value !== state.ui.prizeAmbassadorSearch) {
    elements.prizeAmbassadorSearch.value = state.ui.prizeAmbassadorSearch;
  }

  elements.prizeAmbassadorDirectory.innerHTML = matches.length
    ? matches
        .map((entry) => {
          const rank = eligible.findIndex((candidate) => candidate.ambassador === entry.ambassador) + 1;
          return `
            <article class="prize-directory-item">
              <span class="prize-directory-rank">${escapeHtml(String(rank))}</span>
              <span class="prize-directory-name" title="${escapeAttribute(entry.ambassador)}">${escapeHtml(entry.ambassador)}</span>
              <span class="prize-directory-amount">${escapeHtml(formatAmount(entry.total))}</span>
            </article>
          `;
        })
        .join("")
    : `<div class="empty-state">${search ? "לא נמצאו שגרירים בשם המבוקש." : "עדיין אין שגרירים עם גיוס של ₪20 ומעלה."}</div>`;
}

function createSvg(width, height, ariaLabel) {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeAttribute(ariaLabel)}">
      <rect x="0" y="0" width="${width}" height="${height}" fill="transparent"></rect>
    </svg>
  `;
}

function showTooltip(target, tooltip, html, clientX, clientY) {
  tooltip.innerHTML = html;
  tooltip.classList.add("is-visible");
  const rect = target.getBoundingClientRect();
  const tipRect = tooltip.getBoundingClientRect();
  const left = Math.min(Math.max(clientX - rect.left - tipRect.width / 2, 8), rect.width - tipRect.width - 8);
  const top = Math.max(clientY - rect.top - tipRect.height - 14, 8);
  tooltip.style.transform = `translate(${left}px, ${top}px)`;
}

function hideTooltip(tooltip) {
  tooltip.classList.remove("is-visible");
  tooltip.style.transform = "translate(-9999px, -9999px)";
}

function setInsightSummary(element, items) {
  if (!element) {
    return;
  }
  const normalized = (items || []).filter((item) => item && item.label && item.value);
  element.innerHTML = normalized
    .map(
      (item) => `
        <span class="insight-chip${item.tone ? ` insight-chip--${escapeAttribute(item.tone)}` : ""}">
          <span>${escapeHtml(item.label)}</span>
          <strong>${escapeHtml(item.value)}</strong>
        </span>
      `
    )
    .join("");
}

function interpolateRgb(from, to, factor) {
  const clamped = Math.max(0, Math.min(1, factor));
  const channels = from.map((channel, index) => Math.round(channel + (to[index] - channel) * clamped));
  return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
}

function buildHeatColor(factor) {
  const clamped = Math.max(0, Math.min(1, factor));
  if (clamped <= 0.01) {
    return "rgba(17, 29, 74, 0.05)";
  }
  if (clamped <= 0.5) {
    return interpolateRgb([255, 242, 173], [255, 214, 41], clamped / 0.5);
  }
  return interpolateRgb([255, 214, 41], [17, 29, 74], (clamped - 0.5) / 0.5);
}

function renderDailyChart(rows) {
  if (!rows.length) {
    elements.dailyChart.innerHTML = `<div class="empty-state">אין נתונים להצגה עבור המסנן הנוכחי.</div>`;
    setInsightSummary(elements.dailySummary, []);
    return;
  }

  const metricMode = state.view.dailyMetric;
  const metricLabel = metricMode === "count" ? "מספר עסקאות" : metricMode === "average" ? "ממוצע לעסקה" : "סכום גיוס";
  const formatMetricValue = (value) => (metricMode === "count" ? formatNumber(Math.round(value)) : formatAmount(value));
  const aggregates = state.meta.uniqueDates
    .filter((date) => !state.filters.dateFrom || date >= state.filters.dateFrom)
    .filter((date) => !state.filters.dateTo || date <= state.filters.dateTo)
    .map((date) => {
      const dayRows = rows.filter((row) => row.date === date);
      return {
        date,
        total: sumAmount(dayRows),
        count: dayRows.length,
        average: dayRows.length ? sumAmount(dayRows) / dayRows.length : 0,
      };
    })
    .filter((entry) => entry.count > 0);

  const getValue = (entry) => (metricMode === "count" ? entry.count : metricMode === "average" ? entry.average : entry.total);

  const width = Math.max(920, 200 + aggregates.length * 88);
  const height = 360;
  const margin = { top: 34, right: 34, bottom: 84, left: 82 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(...aggregates.map((entry) => getValue(entry)), 1);
  const averageValue = aggregates.reduce((sum, entry) => sum + getValue(entry), 0) / Math.max(aggregates.length, 1);
  const slotWidth = plotWidth / Math.max(aggregates.length, 1);
  const barWidth = Math.min(42, Math.max(slotWidth * 0.42, 18));
  const baseline = margin.top + plotHeight;
  const bestDay = [...aggregates].sort((left, right) => getValue(right) - getValue(left))[0];
  const latestDay = aggregates[aggregates.length - 1];
  const points = aggregates.map((entry, index) => {
    const value = getValue(entry);
    const centerX = margin.left + slotWidth * index + slotWidth / 2;
    const y = baseline - (value / maxValue) * plotHeight;
    return { entry, value, centerX, y };
  });
  const areaPath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.centerX} ${point.y}`)
    .join(" ");
  const areaClosedPath = `${areaPath} L ${points[points.length - 1].centerX} ${baseline} L ${points[0].centerX} ${baseline} Z`;
  const linePath = areaPath;

  const parser = new DOMParser();
  const doc = parser.parseFromString(createSvg(width, height, "תרשים מגמה יומי של גיוס"), "image/svg+xml");
  const svgNode = doc.documentElement;
  svgNode.insertAdjacentHTML(
    "afterbegin",
    `
      <defs>
        <linearGradient id="dailyAreaGradient" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="rgba(36, 55, 124, 0.34)"></stop>
          <stop offset="100%" stop-color="rgba(36, 55, 124, 0.04)"></stop>
        </linearGradient>
        <linearGradient id="dailyBarGradient" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#24377C"></stop>
          <stop offset="100%" stop-color="#111D4A"></stop>
        </linearGradient>
        <linearGradient id="dailyBarHighlight" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#FFE266"></stop>
          <stop offset="100%" stop-color="#F4C900"></stop>
        </linearGradient>
      </defs>
    `
  );

  svgNode.insertAdjacentHTML(
    "beforeend",
    `<rect x="${margin.left}" y="${margin.top}" width="${plotWidth}" height="${plotHeight}" rx="22" fill="rgba(17, 29, 74, 0.03)" stroke="rgba(17, 29, 74, 0.08)"></rect>`
  );

  for (let tick = 0; tick <= 4; tick += 1) {
    const value = (maxValue / 4) * tick;
    const y = margin.top + plotHeight - (value / maxValue) * plotHeight;
    svgNode.insertAdjacentHTML(
      "beforeend",
      `<line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" stroke="rgba(19,23,80,0.12)" stroke-width="1" stroke-dasharray="4 6"></line>
       <text x="${margin.left - 10}" y="${y + 4}" text-anchor="end" fill="rgba(16,16,16,0.6)" font-size="11" font-weight="${tick === 4 ? "700" : "500"}">${escapeHtml(formatNumber(Math.round(value)))}</text>`
    );
  }

  points.forEach((point, index) => {
    const isBest = bestDay && point.entry.date === bestDay.date;
    const bandX = margin.left + slotWidth * index;
    svgNode.insertAdjacentHTML(
      "beforeend",
      `<rect x="${bandX + 2}" y="${margin.top + 2}" width="${slotWidth - 4}" height="${plotHeight - 4}" rx="18" fill="${isBest ? "rgba(255, 214, 41, 0.12)" : index % 2 === 0 ? "rgba(17, 29, 74, 0.025)" : "rgba(255,255,255,0)"}"></rect>`
    );
  });

  svgNode.insertAdjacentHTML(
    "beforeend",
    `<path d="${areaClosedPath}" fill="url(#dailyAreaGradient)"></path>
     <path d="${linePath}" fill="none" stroke="rgba(36, 55, 124, 0.88)" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"></path>`
  );

  points.forEach((point) => {
    const x = point.centerX - barWidth / 2;
    const heightValue = (point.value / maxValue) * plotHeight;
    const y = baseline - heightValue;
    const isBest = bestDay && point.entry.date === bestDay.date;
    const isLatest = latestDay && point.entry.date === latestDay.date;
    const bar = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
    bar.setAttribute("x", String(x));
    bar.setAttribute("y", String(y));
    bar.setAttribute("width", String(Math.max(barWidth, 12)));
    bar.setAttribute("height", String(Math.max(heightValue, 2)));
    bar.setAttribute("rx", "14");
    bar.setAttribute("fill", isBest ? "url(#dailyBarHighlight)" : "url(#dailyBarGradient)");
    bar.setAttribute("stroke", isBest ? "rgba(244, 201, 0, 0.8)" : "rgba(17, 29, 74, 0.12)");
    bar.classList.add("clickable-cell");
    const tooltipHtml = `<strong>${escapeHtml(formatDate(point.entry.date))}</strong><br>${escapeHtml(metricLabel)}: ${escapeHtml(formatMetricValue(point.value))}<br>${escapeHtml(formatNumber(point.entry.count))} עסקאות`;
    listen(bar, "mouseenter", (event) => showTooltip(elements.dailyChart, elements.dailyTooltip, tooltipHtml, event.clientX, event.clientY));
    listen(bar, "mousemove", (event) => showTooltip(elements.dailyChart, elements.dailyTooltip, tooltipHtml, event.clientX, event.clientY));
    listen(bar, "mouseleave", () => hideTooltip(elements.dailyTooltip));
    listen(bar, "click", () => {
      state.filters.dateFrom = point.entry.date;
      state.filters.dateTo = point.entry.date;
      resetFilterOptions();
      renderAll();
    });
    svgNode.appendChild(bar);

    svgNode.insertAdjacentHTML(
      "beforeend",
      `<circle cx="${point.centerX}" cy="${point.y}" r="${isBest ? 7.5 : 5.5}" fill="${isBest ? "#FFD629" : "#111D4A"}" stroke="${isBest ? "#111D4A" : "#FFFFFF"}" stroke-width="${isBest ? "2.5" : "2"}"></circle>`
    );

    if (isBest || isLatest) {
      const pillWidth = isBest ? 120 : 104;
      const pillX = Math.min(Math.max(point.centerX - pillWidth / 2, margin.left + 8), width - margin.right - pillWidth);
      const pillY = Math.max(point.y - 38, margin.top + 8);
      svgNode.insertAdjacentHTML(
        "beforeend",
        `<g>
          <rect x="${pillX}" y="${pillY}" width="${pillWidth}" height="26" rx="13" fill="${isBest ? "rgba(17, 29, 74, 0.96)" : "rgba(255, 255, 255, 0.94)"}" stroke="${isBest ? "rgba(17, 29, 74, 0.96)" : "rgba(17, 29, 74, 0.14)"}"></rect>
          <text x="${pillX + pillWidth / 2}" y="${pillY + 17}" text-anchor="middle" fill="${isBest ? "#FFD629" : "#111D4A"}" font-size="11" font-weight="800">${escapeHtml(formatMetricValue(point.value))}</text>
        </g>`
      );
    }

    svgNode.insertAdjacentHTML(
      "beforeend",
      `<text x="${point.centerX}" y="${baseline + 26}" text-anchor="middle" fill="rgba(16,16,16,0.78)" font-size="11" font-weight="${isBest ? "800" : "600"}">${escapeHtml(formatShortDate(point.entry.date))}</text>
       <text x="${point.centerX}" y="${baseline + 44}" text-anchor="middle" fill="rgba(16,16,16,0.55)" font-size="10">${escapeHtml(getWeekdayLabel(point.entry.date))}</text>`
    );
  });

  svgNode.insertAdjacentHTML(
    "beforeend",
    `<text x="${margin.left}" y="18" fill="rgba(17, 29, 74, 0.74)" font-size="12" font-weight="700">${escapeHtml(metricLabel)}</text>
     <text x="${width - margin.right}" y="18" text-anchor="end" fill="rgba(17, 29, 74, 0.58)" font-size="11">קו המגמה משקף את קצב השינוי בין הימים הפעילים</text>`
  );

  elements.dailyChart.innerHTML = "";
  elements.dailyChart.appendChild(svgNode);
  setInsightSummary(elements.dailySummary, [
    bestDay
      ? { label: "יום שיא", value: `${formatShortDate(bestDay.date)} | ${formatMetricValue(getValue(bestDay))}`, tone: "accent" }
      : null,
    { label: "ממוצע יומי", value: formatMetricValue(averageValue) },
    latestDay ? { label: "יום אחרון בטווח", value: `${formatShortDate(latestDay.date)} | ${formatMetricValue(getValue(latestDay))}`, tone: "dark" } : null,
  ]);
}

function renderHeatmap(rows) {
  const dates = state.meta.uniqueDates
    .filter((date) => !state.filters.dateFrom || date >= state.filters.dateFrom)
    .filter((date) => !state.filters.dateTo || date <= state.filters.dateTo);
  if (!rows.length || !dates.length) {
    elements.heatmapChart.innerHTML = `<div class="empty-state">אין נתונים להצגה עבור המסנן הנוכחי.</div>`;
    setInsightSummary(elements.heatmapSummary, []);
    return;
  }

  const metricMode = state.view.heatmapMetric;
  const metricLabel = metricMode === "count" ? "מספר עסקאות" : "סכום גיוס";
  const formatMetricValue = (value) => (metricMode === "count" ? formatNumber(Math.round(value)) : formatAmount(value));
  const hours = Array.from({ length: 24 }, (_, hour) => hour);
  const aggregates = new Map();
  const totalsByDate = new Map();
  const totalsByHour = new Map();
  rows.forEach((row) => {
    const key = `${row.date}|${row.hour}`;
    const metricValue = metricMode === "count" ? 1 : row.amount;
    aggregates.set(key, (aggregates.get(key) || 0) + metricValue);
    totalsByDate.set(row.date, (totalsByDate.get(row.date) || 0) + metricValue);
    totalsByHour.set(row.hour, (totalsByHour.get(row.hour) || 0) + metricValue);
  });

  const maxValue = Math.max(...aggregates.values(), 1);
  const maxDateTotal = Math.max(...dates.map((date) => totalsByDate.get(date) || 0), 1);
  const bestCell = [...aggregates.entries()].sort((left, right) => right[1] - left[1])[0];
  const bestDay = [...totalsByDate.entries()].sort((left, right) => right[1] - left[1])[0];
  const bestHour = [...totalsByHour.entries()].sort((left, right) => right[1] - left[1])[0];
  const cellHeight = 20;
  const margin = { top: 110, right: 18, bottom: 24, left: 96 };
  // Expand the date columns to the available chart width. A fixed 56px column
  // left a large empty area whenever the active date range contained only a few days.
  const availableWidth = Math.max(860, (elements.heatmapChart.clientWidth || 0) - 32);
  const cellWidth = Math.max(56, Math.floor((availableWidth - margin.left - margin.right) / dates.length));
  const width = margin.left + margin.right + dates.length * cellWidth;
  const height = 168 + hours.length * cellHeight;

  const parser = new DOMParser();
  const doc = parser.parseFromString(createSvg(width, height, "מפת חום של גיוס לפי תאריך ושעה"), "image/svg+xml");
  const svgNode = doc.documentElement;
  svgNode.insertAdjacentHTML(
    "beforeend",
    `<rect x="${margin.left}" y="${margin.top}" width="${dates.length * cellWidth}" height="${hours.length * cellHeight}" rx="22" fill="rgba(17, 29, 74, 0.03)" stroke="rgba(17, 29, 74, 0.08)"></rect>`
  );

  svgNode.insertAdjacentHTML(
    "beforeend",
    `<text x="${margin.left}" y="22" fill="rgba(17, 29, 74, 0.74)" font-size="12" font-weight="700">${escapeHtml(metricLabel)} לפי חלונות זמן</text>
     <text x="${width - margin.right}" y="22" text-anchor="end" fill="rgba(17, 29, 74, 0.58)" font-size="11">עמודות עליונות מציגות את הסך היומי, וכל תא מייצג שעה מסוימת ביום</text>`
  );

  dates.forEach((date, index) => {
    const x = margin.left + index * cellWidth;
    const total = totalsByDate.get(date) || 0;
    const barHeight = (total / maxDateTotal) * 34;
    svgNode.insertAdjacentHTML(
      "beforeend",
      `<rect x="${x + 11}" y="${64 - barHeight}" width="${cellWidth - 22}" height="${Math.max(barHeight, 4)}" rx="8" fill="${date === bestDay?.[0] ? "rgba(244, 201, 0, 0.82)" : "rgba(36, 55, 124, 0.48)"}"></rect>
       <text x="${x + cellWidth / 2}" y="78" text-anchor="middle" fill="rgba(17,29,74,0.82)" font-size="11" font-weight="${date === bestDay?.[0] ? "800" : "700"}">${escapeHtml(formatShortDate(date))}</text>
       <text x="${x + cellWidth / 2}" y="94" text-anchor="middle" fill="rgba(16,16,16,0.55)" font-size="10">${escapeHtml(getWeekdayLabel(date))}</text>`
    );
  });

  hours.forEach((hour, rowIndex) => {
    const y = margin.top + rowIndex * cellHeight;
    if (hour % 6 === 0) {
      svgNode.insertAdjacentHTML(
        "beforeend",
        `<rect x="${margin.left + 1}" y="${y + 1}" width="${dates.length * cellWidth - 2}" height="${cellHeight * Math.min(6, 24 - hour) - 2}" rx="14" fill="rgba(17, 29, 74, 0.025)"></rect>`
      );
    }
    svgNode.insertAdjacentHTML(
      "beforeend",
      `<text x="${margin.left - 10}" y="${y + 13}" text-anchor="end" fill="rgba(16,16,16,0.6)" font-size="10" font-weight="${hour === Number(bestHour?.[0]) ? "800" : "600"}">${String(hour).padStart(2, "0")}:00</text>`
    );
  });

  dates.forEach((date, dateIndex) => {
    hours.forEach((hour, hourIndex) => {
      const value = aggregates.get(`${date}|${hour}`) || 0;
      const intensity = value / maxValue;
      const isPeak = bestCell && bestCell[0] === `${date}|${hour}`;
      const cell = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
      cell.setAttribute("x", String(margin.left + dateIndex * cellWidth + 1));
      cell.setAttribute("y", String(margin.top + hourIndex * cellHeight + 1));
      cell.setAttribute("width", String(cellWidth - 3));
      cell.setAttribute("height", String(cellHeight - 3));
      cell.setAttribute("rx", "7");
      cell.setAttribute("fill", buildHeatColor(intensity));
      cell.setAttribute("fill-opacity", value ? "1" : "0.9");
      cell.setAttribute("stroke", isPeak ? "rgba(17, 29, 74, 0.96)" : "rgba(19,23,80,0.08)");
      cell.setAttribute("stroke-width", isPeak ? "2.2" : "1");
      cell.classList.add("clickable-cell");
      const tooltipHtml = `<strong>${escapeHtml(formatDate(date))}</strong><br>${String(hour).padStart(2, "0")}:00<br>${escapeHtml(metricLabel)}: ${escapeHtml(formatMetricValue(value))}`;
      listen(cell, "mouseenter", (event) => showTooltip(elements.heatmapChart, elements.heatmapTooltip, tooltipHtml, event.clientX, event.clientY));
      listen(cell, "mousemove", (event) => showTooltip(elements.heatmapChart, elements.heatmapTooltip, tooltipHtml, event.clientX, event.clientY));
      listen(cell, "mouseleave", () => hideTooltip(elements.heatmapTooltip));
      listen(cell, "click", () => {
        state.filters.dateFrom = date;
        state.filters.dateTo = date;
        state.filters.hour = String(hour);
        resetFilterOptions();
        renderAll();
      });
      svgNode.appendChild(cell);

      if (isPeak) {
        svgNode.insertAdjacentHTML(
          "beforeend",
          `<circle cx="${margin.left + dateIndex * cellWidth + cellWidth / 2}" cy="${margin.top + hourIndex * cellHeight + cellHeight / 2}" r="4" fill="#FFFFFF" stroke="#111D4A" stroke-width="2"></circle>`
        );
      }
    });
  });

  elements.heatmapChart.innerHTML = "";
  elements.heatmapChart.appendChild(svgNode);
  const peakParts = bestCell ? bestCell[0].split("|") : [];
  setInsightSummary(elements.heatmapSummary, [
    bestCell
      ? {
          label: "חלון שיא",
          value: `${formatShortDate(peakParts[0])} ${formatHourLabel(Number(peakParts[1]))} | ${formatMetricValue(bestCell[1])}`,
          tone: "accent",
        }
      : null,
    bestDay ? { label: "יום מוביל", value: `${formatShortDate(bestDay[0])} | ${formatMetricValue(bestDay[1])}` } : null,
    bestHour ? { label: "שעה חזקה", value: `${formatHourLabel(Number(bestHour[0]))} | ${formatMetricValue(bestHour[1])}`, tone: "dark" } : null,
  ]);
}

function renderMovement(rows) {
  const focusRows = state.filters.ambassador === "all" ? rows : rows.filter((row) => row.ambassador === state.filters.ambassador);
  const projectDates = state.meta.projectDates.filter(
    (date) => (!state.filters.dateFrom || date >= state.filters.dateFrom) && (!state.filters.dateTo || date <= state.filters.dateTo)
  );
  const metricMode = state.view.movementMetric;
  const metricLabel = metricMode === "count" ? "מספר עסקאות" : "סכום גיוס";
  const formatMetricValue = (value) => (metricMode === "count" ? formatNumber(Math.round(value)) : formatAmount(value));

  if (!focusRows.length || !projectDates.length) {
    elements.movementChart.innerHTML = `<div class="empty-state">אין נתונים להצגה עבור המסנן הנוכחי.</div>`;
    setInsightSummary(elements.movementSummary, []);
    return;
  }

  const totalsByAmbassador = new Map();
  focusRows.forEach((row) => {
    if (!row.projectDay || row.ambassador === "ללא שיוך") {
      return;
    }
    totalsByAmbassador.set(row.ambassador, (totalsByAmbassador.get(row.ambassador) || 0) + (metricMode === "count" ? 1 : row.amount));
  });

  const selectedAmbassadors =
    state.filters.ambassador === "all"
      ? [...totalsByAmbassador.entries()].sort((left, right) => right[1] - left[1]).slice(0, 12).map(([name]) => name)
      : [state.filters.ambassador];

  const cellWidth = 64;
  const rowHeight = 32;
  // Reserve a real lane for rank, amount, and the full ambassador name.
  // Previously the name was squeezed between the amount and the first matrix cell.
  const rankCenterX = 30;
  const intensityBarX = 66;
  const amountLabelX = 184;
  const ambassadorLabelX = 474;
  const ambassadorLabelWidth = ambassadorLabelX - amountLabelX - 24;
  const gridStartX = 504;
  const width = Math.max(1180, gridStartX + projectDates.length * cellWidth + 26);
  const height = 122 + selectedAmbassadors.length * rowHeight;
  const margin = { top: 66, right: 26, bottom: 24, left: gridStartX };
  const parser = new DOMParser();
  const doc = parser.parseFromString(createSvg(width, height, "מטריצת פעילות שגרירים לאורך ימי הפרויקט"), "image/svg+xml");
  const svgNode = doc.documentElement;
  svgNode.classList.add("movement-matrix");
  const matrixValues = new Map();

  focusRows.forEach((row) => {
    if (!row.projectDay || row.ambassador === "ללא שיוך") {
      return;
    }
    const key = `${row.ambassador}|${row.date}`;
    matrixValues.set(key, (matrixValues.get(key) || 0) + (metricMode === "count" ? 1 : row.amount));
  });

  const maxValue = Math.max(...matrixValues.values(), 1);
  const bestCell = [...matrixValues.entries()].sort((left, right) => right[1] - left[1])[0];
  const leader = selectedAmbassadors[0] ? [selectedAmbassadors[0], totalsByAmbassador.get(selectedAmbassadors[0]) || 0] : null;

  svgNode.insertAdjacentHTML(
    "beforeend",
    `<rect x="${margin.left}" y="${margin.top}" width="${projectDates.length * cellWidth}" height="${selectedAmbassadors.length * rowHeight}" rx="22" fill="rgba(17, 29, 74, 0.03)" stroke="rgba(17, 29, 74, 0.08)"></rect>
     <text x="${margin.left}" y="24" fill="rgba(17, 29, 74, 0.74)" font-size="12" font-weight="700">${escapeHtml(metricLabel)} לאורך ימי הפרויקט</text>
     <text x="${width - margin.right}" y="24" text-anchor="end" fill="rgba(17, 29, 74, 0.58)" font-size="11">הצגת השגרירים המובילים בטווח שנבחר עם דירוג, היקף ומוקדי פעילות</text>`
  );

  projectDates.forEach((date, index) => {
    const x = margin.left + index * cellWidth;
    svgNode.insertAdjacentHTML(
      "beforeend",
      `<text x="${x + cellWidth / 2}" y="30" text-anchor="middle" fill="rgba(16,16,16,0.82)" font-size="11" font-weight="700">${escapeHtml(formatShortDate(date))}</text>
       <text x="${x + cellWidth / 2}" y="46" text-anchor="middle" fill="rgba(16,16,16,0.55)" font-size="10">${escapeHtml(getWeekdayLabel(date))}</text>`
    );
  });

  selectedAmbassadors.forEach((ambassador, rowIndex) => {
    const y = margin.top + rowIndex * rowHeight;
    const total = totalsByAmbassador.get(ambassador) || 0;
    const intensity = total / Math.max(...selectedAmbassadors.map((name) => totalsByAmbassador.get(name) || 0), 1);
    const labelY = y + rowHeight / 2 + 4;
    svgNode.insertAdjacentHTML(
      "beforeend",
      `<rect x="${margin.left + 1}" y="${y + 1}" width="${projectDates.length * cellWidth - 2}" height="${rowHeight - 2}" rx="16" fill="${rowIndex % 2 === 0 ? "rgba(17, 29, 74, 0.025)" : "rgba(255,255,255,0)"}"></rect>
       <circle cx="${rankCenterX}" cy="${y + rowHeight / 2}" r="12" fill="${rowIndex === 0 ? "#FFD629" : "rgba(17,29,74,0.12)"}" stroke="rgba(17,29,74,0.18)"></circle>
       <text x="${rankCenterX}" y="${labelY - 1}" text-anchor="middle" fill="#111D4A" font-size="11" font-weight="800">${rowIndex + 1}</text>
       <rect x="${intensityBarX}" y="${y + 6}" width="10" height="${rowHeight - 12}" rx="5" fill="${interpolateRgb([255, 226, 102], [17, 29, 74], intensity)}"></rect>
       <text x="${amountLabelX}" y="${labelY}" text-anchor="end" fill="rgba(17,29,74,0.92)" font-size="11" font-weight="700">${escapeHtml(formatMetricValue(total))}</text>`
    );
    const label = doc.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", String(ambassadorLabelX));
    label.setAttribute("y", String(labelY));
    label.setAttribute("text-anchor", "end");
    label.setAttribute("direction", "rtl");
    label.setAttribute("unicode-bidi", "plaintext");
    label.setAttribute("font-size", "11");
    label.setAttribute("class", `matrix-label${state.filters.ambassador === ambassador ? " is-active" : ""}`);
    label.textContent = ambassador;
    // Keep long Hebrew names inside their dedicated lane instead of letting
    // later-rendered matrix cells cover part of the text.
    if (ambassador.length * 7.2 > ambassadorLabelWidth) {
      label.setAttribute("textLength", String(ambassadorLabelWidth));
      label.setAttribute("lengthAdjust", "spacingAndGlyphs");
    }
    const fullName = doc.createElementNS("http://www.w3.org/2000/svg", "title");
    fullName.textContent = ambassador;
    label.appendChild(fullName);
    listen(label, "click", () => {
      state.filters.ambassador = state.filters.ambassador === ambassador ? "all" : ambassador;
      resetFilterOptions();
      renderAll();
    });
    svgNode.appendChild(label);

    projectDates.forEach((date, dateIndex) => {
      const value = matrixValues.get(`${ambassador}|${date}`) || 0;
      const cellIntensity = value / maxValue;
      const isPeak = bestCell && bestCell[0] === `${ambassador}|${date}`;
      const rect = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", String(margin.left + dateIndex * cellWidth + 1));
      rect.setAttribute("y", String(y + 1));
      rect.setAttribute("width", String(cellWidth - 4));
      rect.setAttribute("height", String(rowHeight - 4));
      rect.setAttribute("rx", "9");
      rect.setAttribute("fill", value ? interpolateRgb([255, 242, 173], [17, 29, 74], cellIntensity) : "rgba(17, 29, 74, 0.05)");
      rect.setAttribute("fill-opacity", "1");
      rect.setAttribute("stroke", isPeak ? "rgba(244, 201, 0, 0.92)" : "rgba(17, 29, 74, 0.08)");
      rect.setAttribute("stroke-width", isPeak ? "2.2" : "1");
      rect.classList.add("clickable-cell");
      const tooltipHtml = `<strong>${escapeHtml(ambassador)}</strong><br>${escapeHtml(formatDate(date))}<br>${escapeHtml(metricLabel)}: ${escapeHtml(formatMetricValue(value))}`;
      listen(rect, "mouseenter", (event) => showTooltip(elements.movementChart, elements.movementTooltip, tooltipHtml, event.clientX, event.clientY));
      listen(rect, "mousemove", (event) => showTooltip(elements.movementChart, elements.movementTooltip, tooltipHtml, event.clientX, event.clientY));
      listen(rect, "mouseleave", () => hideTooltip(elements.movementTooltip));
      listen(rect, "click", () => {
        state.filters.ambassador = ambassador;
        state.filters.dateFrom = date;
        state.filters.dateTo = date;
        resetFilterOptions();
        renderAll();
      });
      svgNode.appendChild(rect);

      if (isPeak) {
        svgNode.insertAdjacentHTML(
          "beforeend",
          `<circle cx="${margin.left + dateIndex * cellWidth + cellWidth / 2}" cy="${y + rowHeight / 2}" r="4" fill="#FFD629" stroke="#111D4A" stroke-width="2"></circle>`
        );
      }
    });
  });

  elements.movementChart.innerHTML = "";
  elements.movementChart.appendChild(svgNode);
  const bestParts = bestCell ? bestCell[0].split("|") : [];
  setInsightSummary(elements.movementSummary, [
    leader ? { label: "מוביל נוכחי", value: `${leader[0]} | ${formatMetricValue(leader[1])}`, tone: "accent" } : null,
    bestCell ? { label: "פיק פעילות", value: `${bestParts[0]} | ${formatShortDate(bestParts[1])} | ${formatMetricValue(bestCell[1])}` } : null,
    state.filters.ambassador === "all"
      ? { label: "מוצגים כעת", value: `${formatNumber(selectedAmbassadors.length)} שגרירים`, tone: "dark" }
      : { label: "פילוח פעיל", value: state.filters.ambassador, tone: "dark" },
  ]);
}

function renderTable(rows) {
  if (!rows.length) {
    elements.tableRoot.innerHTML = `<div class="empty-state">אין רשומות להצגה.</div>`;
    elements.tableSummary.textContent = "";
    return;
  }

  const sortedRows = [...rows].sort((left, right) => right.createdIso.localeCompare(left.createdIso));
  const visibleRows = sortedRows.slice(0, 150);

  elements.tableRoot.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>תאריך ושעה</th>
          <th>יום</th>
          <th>שגריר/ה</th>
          <th>תורם/ת</th>
          <th>סכום</th>
          <th>עיר</th>
          <th>סטטוס</th>
        </tr>
      </thead>
      <tbody>
        ${visibleRows
          .map(
            (row) => `
              <tr>
                <td>${escapeHtml(formatDateTime(row.createdIso))}</td>
                <td>${escapeHtml(`${row.projectDayLabel} | ${getWeekdayLabel(row.date)}`)}</td>
                <td>${escapeHtml(row.ambassador)}</td>
                <td>${escapeHtml(row.donor)}</td>
                <td class="amount-cell">${escapeHtml(formatAmount(row.amount))}</td>
                <td>${escapeHtml(row.city)}</td>
                <td><span class="status-badge ${row.status === "failed" ? "failed" : ""}">${escapeHtml(row.status === "success" ? "חויב" : "נכשל")}</span></td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;

  elements.tableSummary.textContent =
    rows.length > visibleRows.length
      ? `מוצגות ${formatNumber(visibleRows.length)} מתוך ${formatNumber(rows.length)} רשומות`
      : `${formatNumber(rows.length)} רשומות`;
}

function decodeXmlEntities(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function readZipUint16(view, offset) {
  return view.getUint16(offset, true);
}

function readZipUint32(view, offset) {
  return view.getUint32(offset, true);
}

async function inflateZipEntry(bytes, compressionMethod) {
  if (compressionMethod === 0) {
    return bytes;
  }
  if (compressionMethod !== 8 || typeof DecompressionStream === "undefined") {
    throw new Error("הדפדפן אינו תומך בקריאת קובץ Excel זה. אפשר לשמור אותו כ-CSV ולנסות שוב.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readXlsxEntries(buffer) {
  const bytes = new Uint8Array(buffer);
  if (!bytes.length || bytes.length > 2 * 1024 * 1024) {
    throw new Error("קובץ הפרסים גדול מדי. יש להעלות קובץ עד 2MB.");
  }
  const view = new DataView(buffer);
  const minimumOffset = Math.max(0, bytes.length - 65557);
  let endOfDirectory = -1;
  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (readZipUint32(view, offset) === 0x06054b50) {
      endOfDirectory = offset;
      break;
    }
  }
  if (endOfDirectory < 0) {
    throw new Error("קובץ הפרסים אינו קובץ Excel תקין.");
  }
  const entryCount = readZipUint16(view, endOfDirectory + 10);
  const centralDirectoryOffset = readZipUint32(view, endOfDirectory + 16);
  if (entryCount > 128 || centralDirectoryOffset >= bytes.length) {
    throw new Error("קובץ הפרסים אינו נתמך או מכיל יותר מדי קבצים פנימיים.");
  }
  const entries = new Map();
  let cursor = centralDirectoryOffset;
  let totalExtractedBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > bytes.length || readZipUint32(view, cursor) !== 0x02014b50) {
      throw new Error("מבנה קובץ הפרסים אינו תקין.");
    }
    const compressionMethod = readZipUint16(view, cursor + 10);
    const compressedSize = readZipUint32(view, cursor + 20);
    const uncompressedSize = readZipUint32(view, cursor + 24);
    const fileNameLength = readZipUint16(view, cursor + 28);
    const extraLength = readZipUint16(view, cursor + 30);
    const commentLength = readZipUint16(view, cursor + 32);
    const localHeaderOffset = readZipUint32(view, cursor + 42);
    const fileNameStart = cursor + 46;
    const fileNameEnd = fileNameStart + fileNameLength;
    if (fileNameEnd > bytes.length || uncompressedSize > 5 * 1024 * 1024) {
      throw new Error("קובץ הפרסים חורג ממגבלת הגודל המותרת.");
    }
    const fileName = new TextDecoder("utf-8").decode(bytes.slice(fileNameStart, fileNameEnd));
    totalExtractedBytes += uncompressedSize;
    if (totalExtractedBytes > 8 * 1024 * 1024 || localHeaderOffset + 30 > bytes.length || readZipUint32(view, localHeaderOffset) !== 0x04034b50) {
      throw new Error("קובץ הפרסים חורג ממגבלת הגודל המותרת.");
    }
    const localNameLength = readZipUint16(view, localHeaderOffset + 26);
    const localExtraLength = readZipUint16(view, localHeaderOffset + 28);
    const payloadStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const payloadEnd = payloadStart + compressedSize;
    if (payloadEnd > bytes.length) {
      throw new Error("מבנה קובץ הפרסים אינו תקין.");
    }
    entries.set(fileName, await inflateZipEntry(bytes.slice(payloadStart, payloadEnd), compressionMethod));
    cursor = fileNameEnd + extraLength + commentLength;
  }
  return entries;
}

function parseXlsxSharedStrings(xml) {
  const values = [];
  String(xml || "").match(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)?.forEach((item) => {
    const text = [...item.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => decodeXmlEntities(match[1])).join("");
    values.push(text);
  });
  return values;
}

function spreadsheetColumnIndex(reference) {
  const letters = String(reference || "").match(/[A-Z]+/i)?.[0] || "";
  return [...letters.toUpperCase()].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function parseXlsxSheet(xml, sharedStrings) {
  const matrix = [];
  String(xml || "").match(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)?.forEach((rowXml) => {
    const row = [];
    [...rowXml.matchAll(/<c\s+([^>]*)>([\s\S]*?)<\/c>/g)].forEach((match) => {
      const attributes = match[1] || "";
      const cellXml = match[2] || "";
      const reference = attributes.match(/\br="([^"]+)"/)?.[1] || "";
      const type = attributes.match(/\bt="([^"]+)"/)?.[1] || "";
      const column = spreadsheetColumnIndex(reference);
      const rawValue = cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1] || "";
      const inlineValue = [...cellXml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((value) => decodeXmlEntities(value[1])).join("");
      row[Math.max(0, column)] = type === "s" ? (sharedStrings[Number(rawValue)] || "") : (inlineValue || decodeXmlEntities(rawValue));
    });
    matrix.push(row);
  });
  return matrix;
}

async function parseXlsxMatrix(file) {
  const entries = await readXlsxEntries(await file.arrayBuffer());
  const decoder = new TextDecoder("utf-8");
  const sharedStrings = parseXlsxSharedStrings(decoder.decode(entries.get("xl/sharedStrings.xml") || new Uint8Array()));
  const sheetName = [...entries.keys()].filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name)).sort()[0];
  if (!sheetName) {
    throw new Error("לא נמצא גיליון נתונים בקובץ הפרסים.");
  }
  return parseXlsxSheet(decoder.decode(entries.get(sheetName)), sharedStrings);
}

async function loadPrizeModelFromFile(file) {
  if (file.name.toLowerCase().endsWith(".csv")) {
    const text = await file.text();
    return buildPrizeModelFromMatrix(parseCsv(text));
  }
  return buildPrizeModelFromMatrix(await parseXlsxMatrix(file));
}

async function applyPrizeModelUpload(file, options = {}) {
  const fromCampaignBuilder = Boolean(options.fromCampaignBuilder);
  try {
    const model = await loadPrizeModelFromFile(file);
    const validation = validatePrizeModelUpload(model, file.name);
    if (validation.errors.length) {
      const message = `קובץ הפרסים ${file.name} לא נטען. טבלת הפרסים הפעילה נשארה כפי שהיא.`;
      setImportMessage(message, "error");
      if (fromCampaignBuilder) {
        setCampaignBuilderStatus(message, "error");
        renderCampaignDesigner(true);
      }
      renderAll();
      return false;
    }
    // The uploaded table does not carry the campaign's sprint prize.
    // Keep that campaign-level setting when positions/tiers are replaced.
    state.prizeModel = normalizePrizeModel({
      ...validation.normalized,
      sprintPrize: state.prizeModel?.sprintPrize || "",
      excludedAmbassadors: [...(state.prizeModel.excludedAmbassadors || [])],
    });
    storePrizeModel(state.prizeModel);
    const message = validation.warnings.length
      ? `טבלת הפרסים הוחלפה מתוך ${file.name}, אך נטענה עם אזהרות. מומלץ לבדוק שלא חסרים פרסים או מדרגות.`
      : `טבלת הפרסים הוחלפה מתוך ${file.name}. היא נשמרת לקמפיין הפעיל ואין צורך להעלות אותה שוב בכל התחברות.`;
    setImportMessage(message, validation.warnings.length ? "warning" : "success");
    if (fromCampaignBuilder) {
      setCampaignBuilderStatus(message, validation.warnings.length ? "warning" : "success");
      queueCampaignBuilderAutosave("טבלת הפרסים עודכנה ונשמרת בטיוטת הקמפיין.");
      renderCampaignDesigner(true);
    }
    renderAll();
    return true;
  } catch (_error) {
    const message = `טעינת קובץ הפרסים ${file.name} נכשלה.`;
    setImportMessage(message, "error");
    if (fromCampaignBuilder) {
      setCampaignBuilderStatus(message, "error");
      renderCampaignDesigner(true);
    }
    return false;
  }
}

function exportRowsToCsv(rows, fileName) {
  const headers = ["id", "createdIso", "date", "hour", "ambassador", "donor", "email", "amount", "city", "status", "chargeResult"];
  const lines = [headers.join(",")];
  rows.forEach((row) => {
    const values = headers.map((header) => {
      const value = row[header] ?? "";
      const text = String(value).replaceAll('"', '""');
      return `"${text}"`;
    });
    lines.push(values.join(","));
  });
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function renderSimpleMarkdown(text) {
  const escaped = escapeHtml(String(text || ""));
  return escaped
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      if (block.startsWith("## ")) {
        return `<h3>${block.slice(3).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br />")}</h3>`;
      }
      return `<p>${block.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br />")}</p>`;
    })
    .join("");
}

function getProjectSelectedAmount() {
  const customAmount = Number(state.donation.customAmount || 0);
  if (Number.isFinite(customAmount) && customAmount > 0) {
    return customAmount;
  }
  const presetAmount = Number(state.donation.selectedAmount || 0);
  return Number.isFinite(presetAmount) && presetAmount > 0 ? presetAmount : 0;
}

function getSelectedAmountCard() {
  const customAmount = Number(state.donation.customAmount || 0);
  if (Number.isFinite(customAmount) && customAmount > 0) {
    return {
      value: customAmount,
      label: "סכום מותאם אישית",
      description: "הסכום שתבחרו יועבר כפי שהוא לספק התשלום ויצורף לפרטי התרומה שתזינו כאן.",
    };
  }
  return (state.campaignPage.amountCards || []).find((item) => Number(item.value || 0) === Number(state.donation.selectedAmount || 0)) || null;
}

function buildProjectDonationUrl() {
  const baseUrl = String(state.campaignPage.externalDonationUrl || "").trim();
  if (!baseUrl) {
    throw new Error("יש להגדיר קישור יציאה לספק התשלום לפני שימוש בזרימת התרומה.");
  }
  const selectedAmount = getProjectSelectedAmount();
  const url = new URL(baseUrl, window.location.href);
  url.searchParams.set("amount", String(selectedAmount));
  url.searchParams.set("frequency", state.donation.frequency);
  url.searchParams.set("source", "goodraise-public-page");
  if (state.donation.donorName) {
    url.searchParams.set("full_name", state.donation.donorName);
  }
  if (state.donation.donorEmail) {
    url.searchParams.set("email", state.donation.donorEmail);
  }
  if (state.donation.donorPhone) {
    url.searchParams.set("phone", state.donation.donorPhone);
  }
  if (state.donation.ambassador && state.donation.ambassador !== "general") {
    url.searchParams.set("ambassador", state.donation.ambassador);
    const ambassadorRecord = getAmbassadorRecordByFullName(state.donation.ambassador);
    if (ambassadorRecord?.nickname) {
      url.searchParams.set("ambassador_nickname", ambassadorRecord.nickname);
    }
  }
  url.searchParams.set("project_slug", getCampaignProjectSlug());
  if (state.donation.dedication) {
    url.searchParams.set("dedication", state.donation.dedication);
  }
  return url.toString();
}

function renderCampaignDesigner(force = false) {
  if (!elements.campaignDesignerPanel) {
    return;
  }
  const settings = state.campaignPage;
  const builder = normalizeCampaignBuilderConfig(state.campaignBuilder);
  state.campaignBuilder = builder;
  const snapshot = getCampaignBuilderSnapshot();
  const campaignRegistry = normalizeCampaignRegistry(state.campaignRegistry);
  state.campaignRegistry = campaignRegistry;
  const activeCampaignEntry = getCampaignRegistryActiveEntry(campaignRegistry);
  const preflight = buildCampaignPreflight(snapshot);
  const statusState = getCampaignSettingsStatus();
  const builderStatus = getCampaignBuilderStatus();
  const directoryStatus = getAmbassadorDirectoryStatus();
  const directoryRows = state.ambassadorDirectory || [];
  const currentStep = Math.max(1, Math.min(9, Number(state.ui.campaignBuilderStep || 1)));
  state.ui.campaignBuilderStep = currentStep;
  const campaignRegistryOptions = campaignRegistry.campaigns
    .map((item) => {
      const label = item.id === state.activeCampaignId ? snapshot.basics.campaignName || item.name : item.name;
      const slug = item.id === state.activeCampaignId ? snapshot.basics.slug || item.slug : item.slug;
      return `<option value="${escapeAttribute(item.id)}"${item.id === state.activeCampaignId ? " selected" : ""}>${escapeHtml(label || "ללא שם")} | /${escapeHtml(slug || "campaign")}</option>`;
    })
    .join("");
  const steps = [
    "פרטי קמפיין",
    "מיתוג וסיפור",
    "חוויית תרומה",
    "שגרירים",
    "צוותים",
    "יעדים ופרסים",
    "דאטה ואינטגרציה",
    "גישה והרשאות",
    "Review & Publish",
  ];
  const mediaPreviewMarkup = settings.mediaUrl
    ? settings.mediaType === "video"
      ? `<video src="${escapeAttribute(settings.mediaUrl)}" controls playsinline></video>`
      : `<img src="${escapeAttribute(settings.mediaUrl)}" alt="${escapeAttribute(settings.mediaAlt || settings.title)}" />`
    : `<div class="settings-media-preview-placeholder">עדיין לא נטענה מדיה. לאחר העלאה, תופיע כאן תצוגה מקדימה.</div>`;
  const ambassadorRowsMarkup = directoryRows.length
    ? `
        <div class="table-wrap ambassador-links-table-wrap">
          <table class="records-table ambassador-links-table">
            <thead>
              <tr>
                <th>שגריר/ה</th>
                <th>כינוי</th>
                <th>צוות</th>
                <th>יעד אישי</th>
                <th>מייל</th>
                <th>לינק אישי</th>
              </tr>
            </thead>
            <tbody>
              ${directoryRows
                .map(
                  (record) => `
                    <tr>
                      <td>${escapeHtml(record.fullName)}</td>
                      <td dir="ltr">${escapeHtml(record.nickname)}</td>
                      <td>${escapeHtml(record.team || "-")}</td>
                      <td>${escapeHtml(record.personalTarget ? formatAmount(record.personalTarget) : "-")}</td>
                      <td dir="ltr">${escapeHtml(record.email || "-")}</td>
                      <td dir="ltr"><a href="${escapeAttribute(buildAmbassadorPersonalUrl(record))}" target="_blank" rel="noopener noreferrer">${escapeHtml(buildAmbassadorPersonalUrl(record))}</a></td>
                    </tr>
                  `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      `
    : `<div class="empty-state">עדיין אין שגרירים מוגדרים. אפשר להעלות CSV או להוסיף ידנית.</div>`;
  const ambassadorReportFilters = state.ui.ambassadorReportFilters || {};
  const ambassadorFundraisingRows = directoryRows.length ? getFilteredAmbassadorFundraisingReport() : [];
  const ambassadorReportMarkup = directoryRows.length
    ? `
        <section class="control-group">
          <div class="control-group-header">
            <h4>דוח גיוס שגרירים</h4>
            <p>סינון לפי שם ומצב גיוס, הצגת סכום מצטבר לכל שגריר/ה וייצוא רשימה שמית עם פרטי קשר.</p>
          </div>
          <div class="campaign-settings-grid">
            <label class="form-label">
              חיפוש
              <input class="form-control" type="search" value="${escapeAttribute(ambassadorReportFilters.search || "")}" data-ambassador-report-filter="search" placeholder="שם, מייל, טלפון או כינוי" />
            </label>
            <label class="form-label">
              מצב גיוס
              <select class="form-select" data-ambassador-report-filter="fundraisingState">
                <option value="all"${ambassadorReportFilters.fundraisingState === "all" ? " selected" : ""}>כל השגרירים</option>
                <option value="zero"${ambassadorReportFilters.fundraisingState === "zero" ? " selected" : ""}>ללא גיוס</option>
                <option value="positive"${ambassadorReportFilters.fundraisingState === "positive" ? " selected" : ""}>עם גיוס</option>
              </select>
            </label>
            <label class="form-label">
              סכום גיוס מינימלי
              <input class="form-control" type="number" min="0" step="1" value="${escapeAttribute(ambassadorReportFilters.minimumAmount || "")}" data-ambassador-report-filter="minimumAmount" />
            </label>
            <label class="form-label">
              סכום גיוס מקסימלי
              <input class="form-control" type="number" min="0" step="1" value="${escapeAttribute(ambassadorReportFilters.maximumAmount || "")}" data-ambassador-report-filter="maximumAmount" />
            </label>
          </div>
          <div class="control-actions control-actions--inline">
            <button class="button-secondary" type="button" data-project-action="apply-ambassador-report">הצגת דוח</button>
            <button class="button-primary" type="button" data-project-action="export-ambassador-report">ייצוא הדוח</button>
          </div>
          <p class="text-small text-muted">${formatNumber(ambassadorFundraisingRows.length)} שגרירים תואמים לסינון.</p>
          <div class="table-wrap ambassador-links-table-wrap">
            <table class="records-table ambassador-links-table">
              <thead><tr><th>שגריר/ה</th><th>מייל</th><th>טלפון</th><th>כינוי</th><th>סכום גיוס</th></tr></thead>
              <tbody>
                ${ambassadorFundraisingRows.length
                  ? ambassadorFundraisingRows
                      .map(
                        (record) => `
                          <tr>
                            <td>${escapeHtml(record.fullName)}</td>
                            <td dir="ltr">${escapeHtml(record.email || "-")}</td>
                            <td dir="ltr">${escapeHtml(record.phone || "-")}</td>
                            <td dir="ltr">${escapeHtml(record.nickname || "-")}</td>
                            <td>${escapeHtml(formatAmount(record.raisedAmount))}</td>
                          </tr>
                        `,
                      )
                      .join("")
                  : `<tr><td colspan="5" class="text-muted">אין שגרירים התואמים לסינון.</td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
      `
    : "";
  const teamsMarkup = builder.teams.groups.length
    ? builder.teams.groups
        .map(
          (group, index) => `
            <article class="analysis-card">
              <h4>${escapeHtml(group.name)}</h4>
              <ul>
                <li>מנהל/ת: ${escapeHtml(group.manager || "טרם הוגדר")}</li>
                <li>יעד: ${escapeHtml(group.target ? formatAmount(group.target) : "ללא יעד")}</li>
              </ul>
              <button class="button-ghost" type="button" data-builder-action="remove-team" data-team-index="${index}">הסרה</button>
            </article>
          `
        )
        .join("")
    : `<div class="empty-state">עדיין לא נבנו צוותים. אפשר להשאיר ריק או להוסיף קבוצות גיוס.</div>`;
  const preflightMarkup = `
    <div class="signal-grid">
      <section class="analysis-card">
        <h4>Ready</h4>
        <ul>${preflight.ready.length ? preflight.ready.map((item) => `<li>${escapeHtml(item)}</li>`).join("") : "<li>אין פריטים מסומנים עדיין.</li>"}</ul>
      </section>
      <section class="analysis-card">
        <h4>Warning</h4>
        <ul>${preflight.warnings.length ? preflight.warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join("") : "<li>אין אזהרות פעילות.</li>"}</ul>
      </section>
      <section class="analysis-card">
        <h4>Blocking Issue</h4>
        <ul>${preflight.blocking.length ? preflight.blocking.map((item) => `<li>${escapeHtml(item)}</li>`).join("") : "<li>אין חסימות פעילות.</li>"}</ul>
      </section>
    </div>
  `;
  let stepMarkup = "";

  if (currentStep === 1) {
    stepMarkup = `
      <div class="campaign-settings-grid">
        <label class="form-label">
          שם הקמפיין
          <input class="form-control" type="text" value="${escapeAttribute(builder.basics.campaignName)}" data-builder-setting="basics.campaignName" />
        </label>
        <label class="form-label">
          ארגון מוביל
          <input class="form-control" type="text" value="${escapeAttribute(builder.basics.organizationName)}" data-builder-setting="basics.organizationName" />
        </label>
        <label class="form-label">
          Slug ציבורי
          <input class="form-control" type="text" value="${escapeAttribute(builder.basics.slug)}" data-builder-setting="basics.slug" dir="ltr" />
        </label>
        <label class="form-label">
          יעד גיוס
          <input class="form-control" type="number" min="0" step="100" value="${escapeAttribute(builder.basics.target || "")}" data-builder-goal="total" />
        </label>
        <label class="form-label">
          מטבע
          <select class="form-select" data-builder-setting="basics.currency">
            ${["ILS", "USD", "EUR"].map((currency) => `<option value="${currency}"${builder.basics.currency === currency ? " selected" : ""}>${currency}</option>`).join("")}
          </select>
        </label>
        <label class="form-label">
          סטטוס קמפיין
          <select class="form-select" data-builder-setting="basics.status">
            ${[
              ["draft", "Draft"],
              ["scheduled", "Scheduled"],
              ["live", "Live"],
              ["paused", "Paused"],
              ["completed", "Completed"],
              ["archived", "Archived"],
            ].map(([value, label]) => `<option value="${value}"${builder.basics.status === value ? " selected" : ""}>${label}</option>`).join("")}
          </select>
        </label>
        <label class="form-label">
          תאריך התחלה
          <input class="form-control" type="date" value="${escapeAttribute(builder.basics.startDate)}" data-builder-setting="basics.startDate" />
        </label>
        <label class="form-label">
          שעת התחלה
          <input class="form-control" type="time" value="${escapeAttribute(builder.basics.startTime)}" data-builder-setting="basics.startTime" />
        </label>
        <label class="form-label">
          תאריך סיום
          <input class="form-control" type="date" value="${escapeAttribute(builder.basics.endDate)}" data-builder-setting="basics.endDate" />
        </label>
        <label class="form-label">
          שעת סיום
          <input class="form-control" type="time" value="${escapeAttribute(builder.basics.endTime)}" data-builder-setting="basics.endTime" />
        </label>
        <label class="form-label">
          Time zone
          <input class="form-control" type="text" value="${escapeAttribute(builder.basics.timeZone)}" data-builder-setting="basics.timeZone" dir="ltr" />
        </label>
      </div>
    `;
  } else if (currentStep === 2) {
    stepMarkup = `
      <div class="campaign-settings-grid">
        <label class="form-label">
          כותרת עליונה
          <input class="form-control" type="text" value="${escapeAttribute(settings.eyebrow)}" data-campaign-setting="eyebrow" />
        </label>
        <label class="form-label">
          טווח תאריכי פרויקט
          <input class="form-control" type="text" value="${escapeAttribute(settings.projectDatesLabel)}" data-campaign-setting="projectDatesLabel" />
        </label>
        <label class="form-label">
          כותרת ראשית
          <input class="form-control" type="text" value="${escapeAttribute(settings.title)}" data-campaign-setting="title" />
        </label>
        <label class="form-label">
          תת-כותרת
          <input class="form-control" type="text" value="${escapeAttribute(settings.subtitle)}" data-campaign-setting="subtitle" />
        </label>
      </div>
      <label class="form-label">
        סיפור הפרויקט ב-Markdown
        <textarea class="form-control settings-textarea" data-campaign-setting="storyMarkdown">${escapeHtml(settings.storyMarkdown)}</textarea>
      </label>
      <div class="campaign-settings-grid">
        <label class="form-label">
          סוג מדיה
          <select class="form-select" data-campaign-setting="mediaType">
            <option value="image"${settings.mediaType === "image" ? " selected" : ""}>תמונה</option>
            <option value="video"${settings.mediaType === "video" ? " selected" : ""}>וידאו</option>
          </select>
        </label>
        <label class="form-label">
          פונט ראשי
          <select class="form-select" data-campaign-setting="fontFamily">
            ${["Assistant", "Heebo", "Rubik", "Arial"].map((font) => `<option value="${font}"${settings.fontFamily === font ? " selected" : ""}>${font}</option>`).join("")}
          </select>
        </label>
        <label class="form-label">
          מצב preview
          <select class="form-select" data-builder-setting="ui.previewMode">
            <option value="desktop"${builder.ui.previewMode === "desktop" ? " selected" : ""}>Desktop</option>
            <option value="mobile"${builder.ui.previewMode === "mobile" ? " selected" : ""}>Mobile</option>
          </select>
        </label>
        <label class="form-label form-label--full">
          כתובת או Data URI למדיה
          <input class="form-control" type="text" value="${escapeAttribute(settings.mediaUrl)}" data-campaign-setting="mediaUrl" />
        </label>
        <label class="form-label">
          לוגו קמפיין
          <input class="form-control" type="text" value="${escapeAttribute(settings.campaignLogoUrl || "")}" data-campaign-setting="campaignLogoUrl" />
        </label>
        <label class="form-label">
          לוגו ארגון
          <input class="form-control" type="text" value="${escapeAttribute(settings.organizationLogoUrl || "")}" data-campaign-setting="organizationLogoUrl" />
        </label>
        <label class="form-label form-label--full">
          טקסט חלופי
          <input class="form-control" type="text" value="${escapeAttribute(settings.mediaAlt)}" data-campaign-setting="mediaAlt" />
        </label>
        <label class="form-label form-label--full">
          העלאת מדיה
          <input id="campaign-media-upload" class="form-control" type="file" accept="image/*,video/*" />
        </label>
        <label class="form-label">
          העלאת לוגו קמפיין
          <input id="campaign-logo-upload" class="form-control" type="file" accept="image/*" />
        </label>
        <label class="form-label">
          העלאת לוגו ארגון
          <input id="organization-logo-upload" class="form-control" type="file" accept="image/*" />
        </label>
      </div>
      <div class="settings-inline-grid settings-inline-grid--three">
        <label class="form-label">
          Primary
          <input class="form-control" type="color" value="${escapeAttribute(settings.theme.primary)}" data-campaign-setting="theme.primary" />
        </label>
        <label class="form-label">
          Secondary
          <input class="form-control" type="color" value="${escapeAttribute(settings.theme.secondary)}" data-campaign-setting="theme.secondary" />
        </label>
        <label class="form-label">
          Accent
          <input class="form-control" type="color" value="${escapeAttribute(settings.theme.accent)}" data-campaign-setting="theme.accent" />
        </label>
        <label class="form-label">
          Surface
          <input class="form-control" type="color" value="${escapeAttribute(settings.theme.surface)}" data-campaign-setting="theme.surface" />
        </label>
        <label class="form-label">
          Text
          <input class="form-control" type="color" value="${escapeAttribute(settings.theme.text)}" data-campaign-setting="theme.text" />
        </label>
      </div>
      <div class="settings-media-preview">
        <div class="settings-media-preview-head">
          <div class="settings-media-preview-label">תצוגה מקדימה</div>
          <div class="settings-media-preview-meta">${builder.ui.previewMode === "mobile" ? "Mobile" : "Desktop"} | ${escapeHtml(settings.mediaType === "video" ? "וידאו" : "תמונה")}</div>
        </div>
        <div class="settings-media-preview-frame">
          ${mediaPreviewMarkup}
        </div>
      </div>
    `;
  } else if (currentStep === 3) {
    stepMarkup = `
      <div class="campaign-settings-grid">
        <label class="form-label">
          CTA ראשי
          <input class="form-control" type="text" value="${escapeAttribute(settings.primaryCtaLabel)}" data-campaign-setting="primaryCtaLabel" />
        </label>
        <label class="form-label">
          CTA משני
          <input class="form-control" type="text" value="${escapeAttribute(settings.secondaryCtaLabel)}" data-campaign-setting="secondaryCtaLabel" />
        </label>
        <label class="form-label form-label--full">
          קישור לסליקה חיצונית
          <input class="form-control" type="url" value="${escapeAttribute(settings.externalDonationUrl)}" data-campaign-setting="externalDonationUrl" />
        </label>
      </div>
      <label class="form-label">
        סכומי תרומה מוגדרים מראש
        <textarea class="form-control settings-textarea" data-campaign-setting="amountCardsText">${escapeHtml(formatAmountCardText(settings.amountCards))}</textarea>
        <div class="text-small text-muted">שורה לכל preset: <code>180|מארז חג|תיאור קצר</code></div>
      </label>
      <div class="campaign-settings-grid">
        <label class="form-label">
          מסלול חודשי
          <select class="form-select" data-campaign-setting="showRecurring">
            <option value="true"${settings.showRecurring ? " selected" : ""}>פעיל</option>
            <option value="false"${!settings.showRecurring ? " selected" : ""}>כבוי</option>
          </select>
        </label>
        <label class="form-label">
          יעד יומי
          <input class="form-control" type="number" min="0" step="100" value="${escapeAttribute(state.goals.daily || "")}" data-builder-goal="daily" />
        </label>
        <label class="form-label">
          המלצה אוטומטית
          <input class="form-control" type="number" min="0" step="10" value="${escapeAttribute(snapshot.donation.recommendedAmount || "")}" readonly />
        </label>
      </div>
      <label class="form-label">
        הודעת אמון
        <textarea class="form-control" data-campaign-setting="trustNote">${escapeHtml(settings.trustNote)}</textarea>
      </label>
      <label class="form-label">
        הודעת מעבר/תודה
        <textarea class="form-control" data-campaign-setting="successHint">${escapeHtml(settings.successHint)}</textarea>
      </label>
    `;
  } else if (currentStep === 4) {
    stepMarkup = `
      <section class="control-group">
        <div class="control-group-header">
          <h4>ייבוא CSV</h4>
          <p>תומך גם בטופס ההרשמה: חותמת זמן, שם מלא של השגריר, מפנה, כתובת מייל, טלפון, ניסיון קודם, מקור הגעה ואישורים. כינוי חסר מופק אוטומטית מהמייל.</p>
        </div>
        <div class="filters-grid">
          <label class="form-label">
            קובץ שגרירים
            <input id="ambassador-directory-upload" class="form-control" type="file" accept=".csv,text/csv" />
          </label>
          <label class="form-label">
            תבנית לינק אישי
            <input class="form-control" type="text" value="${escapeAttribute(`${getCampaignPlatformBaseUrl()}/${getCampaignProjectSlug()}/{nickname}`)}" readonly dir="ltr" />
          </label>
        </div>
        <div class="settings-actions">
          <div class="settings-status" data-ambassador-status${directoryStatus.tone !== "neutral" ? ` data-tone="${escapeAttribute(directoryStatus.tone)}"` : ""}>${escapeHtml(directoryStatus.message)}</div>
          <div class="project-hero-actions">
            <button class="button-secondary" type="button" data-project-action="export-ambassador-links">ייצוא לינקים</button>
            <button class="button-secondary" type="button" data-project-action="export-zero-fundraising-ambassadors">ייצוא שגרירים ללא גיוס</button>
            <button class="button-ghost" type="button" data-project-action="clear-ambassador-directory">ניקוי רשימת שגרירים</button>
          </div>
        </div>
      </section>
      ${ambassadorReportMarkup}
      <section class="control-group">
        <div class="control-group-header">
          <h4>הוספה ידנית</h4>
          <p>ליצירת שגריר בודד בלי להעלות קובץ.</p>
        </div>
        <div class="campaign-settings-grid">
          <label class="form-label">
            שם מלא
            <input class="form-control" type="text" value="${escapeAttribute(builder.ambassadors.manualDraft.fullName)}" data-builder-setting="ambassadors.manualDraft.fullName" />
          </label>
          <label class="form-label">
            כינוי
            <input class="form-control" type="text" value="${escapeAttribute(builder.ambassadors.manualDraft.nickname)}" data-builder-setting="ambassadors.manualDraft.nickname" dir="ltr" />
          </label>
          <label class="form-label">
            מייל
            <input class="form-control" type="email" value="${escapeAttribute(builder.ambassadors.manualDraft.email)}" data-builder-setting="ambassadors.manualDraft.email" dir="ltr" />
          </label>
          <label class="form-label">
            טלפון
            <input class="form-control" type="text" value="${escapeAttribute(builder.ambassadors.manualDraft.phone)}" data-builder-setting="ambassadors.manualDraft.phone" dir="ltr" />
          </label>
          <label class="form-label">
            צוות
            <input class="form-control" type="text" value="${escapeAttribute(builder.ambassadors.manualDraft.team)}" data-builder-setting="ambassadors.manualDraft.team" />
          </label>
          <label class="form-label">
            יעד אישי
            <input class="form-control" type="number" min="0" step="50" value="${escapeAttribute(builder.ambassadors.manualDraft.personalTarget)}" data-builder-setting="ambassadors.manualDraft.personalTarget" />
          </label>
        </div>
        <div class="control-actions control-actions--inline">
          <button class="button-primary" type="button" data-builder-action="add-manual-ambassador">הוספת שגריר/ה</button>
        </div>
      </section>
      ${ambassadorRowsMarkup}
    `;
  } else if (currentStep === 5) {
    stepMarkup = `
      <div class="campaign-settings-grid">
        <label class="form-label">
          הפעלת צוותים
          <select class="form-select" data-builder-setting="teams.enabled">
            <option value="true"${builder.teams.enabled ? " selected" : ""}>כן</option>
            <option value="false"${!builder.teams.enabled ? " selected" : ""}>לא</option>
          </select>
        </label>
        <label class="form-label">
          שם צוות חדש
          <input id="builder-team-name" class="form-control" type="text" placeholder="לדוגמה: דרום / בוגרים / סניף מרכז" />
        </label>
        <label class="form-label">
          מנהל/ת
          <input id="builder-team-manager" class="form-control" type="text" placeholder="שם מוביל/ת" />
        </label>
        <label class="form-label">
          יעד צוות
          <input id="builder-team-target" class="form-control" type="number" min="0" step="100" placeholder="למשל 50000" />
        </label>
      </div>
      <div class="control-actions control-actions--inline">
        <button class="button-secondary" type="button" data-builder-action="add-team">הוספת צוות</button>
      </div>
      <div class="signal-grid">${teamsMarkup}</div>
    `;
  } else if (currentStep === 6) {
    stepMarkup = `
      <div class="campaign-settings-grid">
        <label class="form-label">
          יעד קמפיין
          <input class="form-control" type="number" min="0" step="100" value="${escapeAttribute(state.goals.total || "")}" data-builder-goal="total" />
        </label>
        <label class="form-label">
          יעד יומי
          <input class="form-control" type="number" min="0" step="100" value="${escapeAttribute(state.goals.daily || "")}" data-builder-goal="daily" />
        </label>
        <label class="form-label">
          יעד לשגריר
          <input class="form-control" type="number" min="0" step="100" value="${escapeAttribute(builder.goals.ambassadorGoal || "")}" data-builder-setting="goals.ambassadorGoal" />
        </label>
        <label class="form-label">
          יעד לצוות
          <input class="form-control" type="number" min="0" step="100" value="${escapeAttribute(builder.goals.teamGoal || "")}" data-builder-setting="goals.teamGoal" />
        </label>
      </div>
      <label class="form-label">
        הערת tie-break / eligibility
        <textarea class="form-control settings-textarea" data-builder-setting="goals.tierRuleNote">${escapeHtml(builder.goals.tierRuleNote)}</textarea>
      </label>
      <section class="analysis-card form-label--full">
        <h4>רשימת פרסים לקמפיין</h4>
        <p>כאן מגדירים את הפרסים והמדרגות של הקמפיין הפעיל. אפשר להחליף את הטבלה הקיימת באמצעות קובץ Excel או CSV; ההחלפה אינה משפיעה על קמפיינים אחרים.</p>
        <label class="form-label">שגרירים שאינם משתתפים בדירוג הפרסים (שם אחד בכל שורה)
          <textarea id="prize-exclusions-input" class="form-control settings-textarea">${escapeHtml((state.prizeModel.excludedAmbassadors || []).join("\n"))}</textarea>
          <span class="field-hint">התרומות שלהם נשארות בסכומי הגיוס.</span>
        </label>
        <label class="form-label">
          פרס לזוכה/ת הספרינט
          <input id="sprint-prize-input" class="form-control" type="text" value="${escapeAttribute(state.prizeModel.sprintPrize || "")}" placeholder="למשל: שובר מתנה" maxlength="160" />
        </label>
        <div class="text-small text-muted">הפרס נשמר עבור הקמפיין הפעיל בלבד ומוצג בכרטיס תוצאת הספרינט. העלאת קובץ פרסים אינה מוחקת אותו.</div>
        <label class="form-label">
          העלאת קובץ פרסים
          <input id="campaign-prize-upload" class="form-control" type="file" accept=".xlsx,.xls,.csv,text/csv" aria-describedby="campaign-prize-upload-help" />
        </label>
        <div id="campaign-prize-upload-help" class="text-small text-muted">פורמטים נתמכים: Excel או CSV. הקובץ צריך לכלול פרסי מיקומים ו/או מדרגות סכום. העלאה תקינה מחליפה את הטבלה הפעילה של הקמפיין בלבד.</div>
        <div class="status-note text-small" data-prize-upload-status aria-live="polite">טבלה פעילה: ${escapeHtml(formatNumber((state.prizeModel.placePrizes || []).length))} פרסי מיקומים ו-${escapeHtml(formatNumber((state.prizeModel.tierPrizes || []).length))} מדרגות פרס.</div>
      </section>
      <div class="signal-grid">
        <article class="analysis-card">
          <h4>פרסי מיקומים</h4>
          <ul>${(state.prizeModel.placePrizes || []).length ? state.prizeModel.placePrizes.map((item) => `<li>${escapeHtml(item.label || `מקום ${item.place}`)} | ${escapeHtml(item.prize || "ללא פרס")}</li>`).join("") : "<li>אין פרסי מיקומים מוגדרים.</li>"}</ul>
        </article>
        <article class="analysis-card">
          <h4>מדרגות פרס</h4>
          <ul>${(state.prizeModel.tierPrizes || []).length ? state.prizeModel.tierPrizes.map((item) => `<li>${escapeHtml(item.prize || "מדרגה")} | ${escapeHtml(formatAmount(item.threshold || 0))}</li>`).join("") : "<li>אין מדרגות פרס מוגדרות.</li>"}</ul>
        </article>
      </div>
    `;
  } else if (currentStep === 7) {
    stepMarkup = `
      <div class="signal-grid">
        <article class="analysis-card">
          <h4>מצב מקור נתונים</h4>
          <ul>
            <li>Mode: ${escapeHtml(state.sourceConfig.mode === "api" ? "API" : state.sourceConfig.mode === "google_sheets" ? "Google Sheets" : "File Upload")}</li>
            <li>Endpoint: <span dir="ltr">${escapeHtml(state.sourceConfig.api.endpoint || "לא הוגדר")}</span></li>
            <li>Response: ${escapeHtml(state.sourceConfig.api.responseFormat || "csv")}</li>
            <li>Auto refresh: ${escapeHtml(formatNumber(Number(state.sourceConfig.api.autoRefreshMinutes || 0)))} דקות</li>
          </ul>
        </article>
        <article class="analysis-card">
          <h4>מיפוי וחיווי</h4>
          <ul>
            <li>${escapeHtml(state.sourceConfig.api.recordsPath ? `נתיב רשומות: ${state.sourceConfig.api.recordsPath}` : "אין נתיב רשומות מיוחד.")}</li>
            <li>${escapeHtml(state.sourceConfig.api.hasBearerToken ? "קיים bearer token שמור בשרת." : "לא נשמר bearer token.")}</li>
            <li>${escapeHtml(getSourceConfigStatus().message)}</li>
          </ul>
        </article>
      </div>
      <div class="settings-actions">
        <div class="settings-status" data-source-summary>${escapeHtml(getSourceConfigStatus().message)}</div>
        <div class="project-hero-actions">
          <button class="button-secondary" type="button" data-builder-action="go-to-source-center">מעבר לחיבור מקור הנתונים</button>
        </div>
      </div>
    `;
  } else if (currentStep === 8) {
    stepMarkup = `
      <div class="campaign-settings-grid">
        <label class="form-label form-label--full">
          Organization Admin
          <textarea class="form-control settings-textarea" data-builder-email-list="permissions.admins" dir="ltr" placeholder="admin@example.org&#10;owner@example.org">${escapeHtml(serializeEmailLines(builder.permissions.admins))}</textarea>
        </label>
        <label class="form-label form-label--full">
          Campaign Manager
          <textarea class="form-control settings-textarea" data-builder-email-list="permissions.managers" dir="ltr" placeholder="manager@example.org">${escapeHtml(serializeEmailLines(builder.permissions.managers))}</textarea>
        </label>
        <label class="form-label form-label--full">
          Analyst / Viewer
          <textarea class="form-control settings-textarea" data-builder-email-list="permissions.viewers" dir="ltr" placeholder="viewer@example.org">${escapeHtml(serializeEmailLines(builder.permissions.viewers))}</textarea>
        </label>
      </div>
      <div class="status-note text-small">השלב הזה שומר את מבנה ההרשאות בתוך תצורת הקמפיין. מנגנון ה־auth הקיים נשאר שרת-צד ולא נשבר.</div>
    `;
  } else {
    stepMarkup = `
      ${preflightMarkup}
      <div class="campaign-settings-grid">
        <label class="form-label">
          תבנית קמפיין
          <select class="form-select" data-builder-template>
            ${[
              ["annual-recurring", "Annual recurring"],
              ["ambassador", "Ambassador campaign"],
              ["community", "Community fundraising"],
              ["emergency", "Emergency campaign"],
              ["short", "Short campaign"],
              ["long-running", "Long-running campaign"],
            ].map(([value, label]) => `<option value="${value}"${builder.templates.type === value ? " selected" : ""}>${label}</option>`).join("")}
          </select>
        </label>
        <label class="form-label">
          סטטוס נוכחי
          <input class="form-control" type="text" value="${escapeAttribute(builder.basics.status)}" readonly />
        </label>
      </div>
      <div class="control-actions control-actions--inline">
        <button class="button-primary" type="button" data-builder-action="launch-campaign"${preflight.blocking.length ? " disabled" : ""}>Launch Campaign</button>
      </div>
    `;
  }

  elements.campaignDesignerPanel.innerHTML = `
    <div class="campaign-settings-panel">
      <div class="settings-panel-note">Campaign Builder שומר את כל שכבת ההקמה של הקמפיין: פרטים עסקיים, מיתוג, תרומות, שגרירים, פרסים והרשאות. הזרימה מיועדת לעבודה חוזרת של ארגונים ולא להגדרה חד-פעמית בלבד.</div>
      <div class="campaign-settings-grid">
        <label class="form-label">
          קמפיין פעיל
          <select class="form-select" data-campaign-registry="active-id">
            ${campaignRegistryOptions}
          </select>
        </label>
        <section class="analysis-card">
          <h4>מאגר קמפיינים</h4>
          <ul>
            <li>${escapeHtml(formatNumber(campaignRegistry.campaigns.length))} קמפיינים שמורים</li>
            <li>${escapeHtml(activeCampaignEntry?.slug || snapshot.basics.slug || "-")} /slug</li>
            <li>${escapeHtml(activeCampaignEntry?.updatedAt ? `עודכן ${formatCampaignSavedAt(activeCampaignEntry.updatedAt)}` : "טרם נשמר בשרת")}</li>
          </ul>
        </section>
      </div>
      <div class="settings-actions">
        <div class="settings-status" data-builder-status${builderStatus.tone !== "neutral" ? ` data-tone="${escapeAttribute(builderStatus.tone)}"` : ""}>${escapeHtml(builderStatus.message)}</div>
        <div class="project-hero-actions">
          <button class="button-ghost" type="button" data-builder-action="create-campaign">קמפיין חדש</button>
          <button class="button-secondary" type="button" data-builder-action="save-now">שמירת טיוטה</button>
          <button class="button-ghost" type="button" data-builder-action="duplicate-campaign">שכפול קמפיין</button>
          <button class="button-ghost" type="button" data-project-action="open-project-preview">תצוגה מקדימה</button>
        </div>
      </div>
      <div class="data-toolbar metric-toolbar" aria-label="שלבי ה־Campaign Builder">
        ${steps.map((label, index) => `<button class="metric-toggle${currentStep === index + 1 ? " is-active" : ""}" type="button" data-builder-step="${index + 1}">${index + 1}. ${escapeHtml(label)}</button>`).join("")}
      </div>
      <div class="signal-grid">
        <section class="analysis-card">
          <h4>תמונת מצב</h4>
          <ul>
            <li>${escapeHtml(snapshot.basics.campaignName || "ללא שם קמפיין")}</li>
            <li>${escapeHtml(snapshot.basics.organizationName || "ללא ארגון")}</li>
            <li>${escapeHtml(formatAmount(Number(snapshot.basics.target || 0)))} יעד</li>
            <li>${escapeHtml(formatNumber(directoryRows.length))} שגרירים</li>
          </ul>
        </section>
        <section class="analysis-card">
          <h4>מצב שמירה</h4>
          <ul>
            <li>Last saved: ${escapeHtml(formatCampaignSavedAt(builder.meta.lastSavedAt))}</li>
            <li dir="ltr">Saved by: ${escapeHtml(builder.meta.lastSavedBy || "-")}</li>
            <li>${escapeHtml(preflight.blocking.length ? `${formatNumber(preflight.blocking.length)} חסימות` : "אין חסימות פתוחות")}</li>
          </ul>
        </section>
        <section class="analysis-card">
          <h4>Preflight</h4>
          <ul>
            <li>${escapeHtml(`${formatNumber(preflight.ready.length)} Ready`)}</li>
            <li>${escapeHtml(`${formatNumber(preflight.warnings.length)} Warning`)}</li>
            <li>${escapeHtml(`${formatNumber(preflight.blocking.length)} Blocking`)}</li>
          </ul>
        </section>
      </div>
      <section class="control-group">
        <div class="control-group-header">
          <h4>שלב ${currentStep}: ${escapeHtml(steps[currentStep - 1])}</h4>
          <p>מסלול מונחה להגדרת קמפיין מלא, עם טיוטה, שכפול ו־review לפני עלייה לאוויר.</p>
        </div>
        ${stepMarkup}
      </section>
      <div class="settings-actions">
        <div class="settings-status" data-settings-status${statusState.tone !== "neutral" ? ` data-tone="${escapeAttribute(statusState.tone)}"` : ""}>${escapeHtml(statusState.message)}</div>
        <div class="project-hero-actions">
          <button class="button-ghost" type="button" data-builder-action="prev-step"${currentStep === 1 ? " disabled" : ""}>הקודם</button>
          <button class="button-secondary" type="button" data-builder-action="next-step"${currentStep === steps.length ? " disabled" : ""}>הבא</button>
          <button class="button-ghost" type="button" data-project-action="reset-campaign-settings">איפוס</button>
        </div>
      </div>
    </div>
  `;
  elements.campaignDesignerPanel.dataset.ready = "true";
}

function renderProjectPage() {
  if (!elements.projectPageRoot) {
    return;
  }

  const settings = state.campaignPage;
  const prizeRows = getPrizeScopeRows();
  const totalRaised = sumAmount(prizeRows);
  const latestCreated = getLatestCreatedIso(prizeRows);
  const leaderboard = buildLeaderboard(prizeRows);
  const totalGoal = Number(state.goals.total || 0);
  const progressPercent = totalGoal > 0 ? Math.max(0, Math.min(100, (totalRaised / totalGoal) * 100)) : 0;
  const selectedAmount = getProjectSelectedAmount();
  const selectedAmountCard = getSelectedAmountCard();
  const donationSummary = selectedAmount ? formatAmount(selectedAmount) : "יש לבחור סכום";
  const selectedAmountLabel = selectedAmountCard?.label || "תרומה פעילה";
  const selectedAmountDescription = selectedAmountCard?.description || "הסכום שתבחרו יועבר לספק התשלום החיצוני ויצורף לפרטי התרומה שתזינו כאן.";
  const storyMarkup = renderSimpleMarkdown(settings.storyMarkdown);
  const ambassadors = [
    ...new Set([
      ...state.ambassadorDirectory.map((item) => item.fullName).filter(Boolean),
      ...leaderboard.map((item) => item.ambassador).filter(Boolean),
    ]),
  ];
  const ambassadorOptions = [
    `<option value="general"${state.donation.ambassador === "general" ? " selected" : ""}>תרומה כללית לפרויקט</option>`,
    ...ambassadors.map((ambassador) => `<option value="${escapeAttribute(ambassador)}"${state.donation.ambassador === ambassador ? " selected" : ""}>${escapeHtml(ambassador)}</option>`),
  ].join("");

  let mediaMarkup = "";
  if (settings.mediaType === "video" && settings.mediaUrl) {
    mediaMarkup = `<video class="project-media" src="${escapeAttribute(settings.mediaUrl)}" poster="${escapeAttribute(INITIAL_CAMPAIGN_LOGO)}" controls playsinline></video>`;
  } else if (settings.mediaUrl) {
    mediaMarkup = `<img class="project-media" src="${escapeAttribute(settings.mediaUrl)}" alt="${escapeAttribute(settings.mediaAlt || settings.title)}" />`;
  } else {
    mediaMarkup = `<img class="project-media" src="${escapeAttribute(INITIAL_CAMPAIGN_LOGO)}" alt="${escapeAttribute(settings.mediaAlt || settings.title)}" />`;
  }

  elements.projectPageRoot.innerHTML = `
    <section class="project-landing" style="--campaign-page-primary:${escapeAttribute(settings.theme.primary)};--campaign-page-secondary:${escapeAttribute(settings.theme.secondary)};--campaign-page-accent:${escapeAttribute(settings.theme.accent)};--campaign-page-surface:${escapeAttribute(settings.theme.surface)};--campaign-page-text:${escapeAttribute(settings.theme.text)};font-family:${escapeAttribute(`"${settings.fontFamily}", Arial, sans-serif`)};">
      <article class="project-hero app-card--dark">
        <div class="project-hero-grid">
          <div class="project-hero-copy">
            <span class="project-kicker">${escapeHtml(settings.eyebrow)}</span>
            <h1 class="project-title">${escapeHtml(settings.title)}</h1>
            <p class="project-subtitle">${escapeHtml(settings.subtitle)}</p>
            <div class="project-hero-actions">
              <button class="button-primary action-button" type="button" data-project-action="scroll-donation">${escapeHtml(settings.primaryCtaLabel || "לתרומה")}</button>
              <button class="button-secondary action-button secondary" type="button" data-project-action="go-prizes">${escapeHtml(settings.secondaryCtaLabel || "צפייה במובילים ובזוכים")}</button>
            </div>
            <div class="project-stat-grid">
              ${(settings.stats || []).map((item) => `
                <article class="project-stat-card">
                  <div class="project-stat-value">${escapeHtml(item.value)}</div>
                  <div class="project-stat-label">${escapeHtml(item.label)}</div>
                </article>
              `).join("")}
            </div>
            <div class="project-progress">
              <div class="project-progress-meta">
                <strong>${escapeHtml(settings.projectDatesLabel)}</strong>
                <span>גיוס נוכחי: ${escapeHtml(formatAmount(totalRaised))}</span>
                <span>${latestCreated ? `עדכון אחרון: ${escapeHtml(formatDateTime(latestCreated))}` : "ממתין לעדכון נתונים"}</span>
              </div>
              <div class="project-progress-track" aria-hidden="true">
                <div class="project-progress-bar" style="width:${progressPercent.toFixed(2)}%"></div>
              </div>
              <div class="project-progress-meta">
                <span>${totalGoal > 0 ? `התקדמות מול יעד: ${escapeHtml(formatNumber(progressPercent.toFixed(1)))}%` : "יעד כולל יוצג כאן לאחר הזנה במסך הניהול"}</span>
                <span>${leaderboard.length ? `שגרירים פעילים: ${escapeHtml(formatNumber(leaderboard.length))}` : "עדיין אין שגרירים פעילים בתצוגה"}</span>
              </div>
            </div>
          </div>
          <div class="project-media-frame">
            <div class="project-media-badge">עמוד פרויקט פעיל</div>
            ${mediaMarkup}
          </div>
        </div>
      </article>

      <div class="project-body-grid">
        <article class="project-story-panel app-card app-card--elevated">
          <div class="section-header">
            <div>
              <h3>הסיפור של הפרויקט</h3>
              <div class="text-small text-muted">טקסט גמיש שניתן לעדכן במסך הניהול ולהתאים לכל מבצע, חג או קמפיין.</div>
            </div>
          </div>
          <div class="project-story-content">${storyMarkup}</div>
        </article>

        <aside id="project-donation-panel" class="donation-panel app-card app-card--elevated">
          <div class="section-header">
            <div>
              <h3>בחירת תרומה והמשך לתשלום</h3>
              <div class="text-small text-muted">המסך הזה מצמצם חיכוך: סכום, פרטים בסיסיים, ואז מעבר אל ספק הסליקה החיצוני.</div>
            </div>
          </div>
          <div class="donation-stepper" aria-hidden="true">
            <article class="donation-step">
              <div class="donation-step-index">שלב 1</div>
              <div class="donation-step-title">בוחרים סכום</div>
              <div class="donation-step-meta">חד פעמית או חודשית, לפי הגדרות הקמפיין.</div>
            </article>
            <article class="donation-step">
              <div class="donation-step-index">שלב 2</div>
              <div class="donation-step-title">ממלאים פרטים</div>
              <div class="donation-step-meta">שם, דוא"ל ושיוך אופציונלי לשגריר/ה.</div>
            </article>
            <article class="donation-step">
              <div class="donation-step-index">שלב 3</div>
              <div class="donation-step-title">עוברים לתשלום</div>
              <div class="donation-step-meta">המשך לחלון מאובטח של ספק התשלום החיצוני.</div>
            </article>
          </div>
          ${settings.showRecurring ? `
            <div class="donation-frequency" role="tablist" aria-label="סוג תרומה">
              <button class="donation-frequency-button${state.donation.frequency === "one_time" ? " is-active" : ""}" type="button" data-project-action="set-frequency" data-value="one_time">חד פעמית</button>
              <button class="donation-frequency-button${state.donation.frequency === "monthly" ? " is-active" : ""}" type="button" data-project-action="set-frequency" data-value="monthly">חודשית</button>
            </div>
          ` : ""}
          <div class="donation-impact">
            <div class="donation-impact-head">
              <div>
                <div class="donation-impact-kicker">התרומה שבחרתם</div>
                <div class="donation-impact-title">${escapeHtml(selectedAmountLabel)}</div>
              </div>
              <div class="donation-impact-value">${escapeHtml(donationSummary)}</div>
            </div>
            <div class="donation-impact-description">${escapeHtml(selectedAmountDescription)}</div>
          </div>
          <div class="amount-grid">
            ${(settings.amountCards || []).map((item) => `
              <button class="amount-card${Number(state.donation.selectedAmount) === Number(item.value) && !state.donation.customAmount ? " is-active" : ""}" type="button" data-project-action="select-amount" data-value="${Number(item.value)}">
                <div class="amount-card-value">${escapeHtml(formatAmount(item.value))}</div>
                <div class="amount-card-label">${escapeHtml(item.label)}</div>
                <div class="amount-card-description">${escapeHtml(item.description || "")}</div>
              </button>
            `).join("")}
          </div>
          <label class="form-label form-label--full">
            סכום מותאם אישית
            <input class="form-control" type="number" min="0" step="10" value="${escapeAttribute(state.donation.customAmount)}" data-donation-field="customAmount" placeholder="למשל 720" />
          </label>
          <div class="donation-grid">
            <label class="form-label">
              שם מלא
              <input class="form-control" type="text" value="${escapeAttribute(state.donation.donorName)}" data-donation-field="donorName" placeholder="שם התורם/ת" />
            </label>
            <label class="form-label">
              דוא"ל
              <input class="form-control" type="email" value="${escapeAttribute(state.donation.donorEmail)}" data-donation-field="donorEmail" placeholder="name@example.org" dir="ltr" />
            </label>
            <label class="form-label">
              טלפון
              <input class="form-control" type="tel" value="${escapeAttribute(state.donation.donorPhone)}" data-donation-field="donorPhone" placeholder="050-0000000" dir="ltr" />
            </label>
            <label class="form-label">
              שיוך לשגריר/ה
              <select class="form-select" data-donation-field="ambassador">
                ${ambassadorOptions}
              </select>
            </label>
            <label class="form-label form-label--full">
              הקדשה או הערה
              <textarea class="form-control" data-donation-field="dedication" placeholder="רשות בלבד">${escapeHtml(state.donation.dedication)}</textarea>
            </label>
          </div>
          <div class="donation-summary">
            <div><strong>סכום שנבחר:</strong> ${escapeHtml(donationSummary)}</div>
            <div><strong>מסלול:</strong> ${state.donation.frequency === "monthly" ? "תרומה חודשית" : "תרומה חד פעמית"}</div>
            <div><strong>יעד שיוך:</strong> ${escapeHtml(state.donation.ambassador === "general" ? "תרומה כללית לפרויקט" : state.donation.ambassador || "תרומה כללית לפרויקט")}</div>
          </div>
          <div class="project-trust-list">
            <span class="project-trust-chip">SSL אצל ספק חיצוני</span>
            <span class="project-trust-chip">שמירת פרטיות</span>
            <span class="project-trust-chip">מעבר לחלון מאובטח</span>
          </div>
          <div class="donation-flow-note">${escapeHtml(settings.trustNote)}</div>
          <button class="button-primary action-button" type="button" data-project-action="continue-donation">${escapeHtml(settings.primaryCtaLabel || "המשך לתרומה מאובטחת")}</button>
          <div class="text-small text-muted">${escapeHtml(settings.successHint)}</div>
          <div class="donation-feedback${state.donation.tone ? ` is-${escapeAttribute(state.donation.tone)}` : ""}" aria-live="polite">${escapeHtml(state.donation.message || "")}</div>
        </aside>
      </div>
    </section>
  `;
}

function runRenderStep(label, callback) {
  try {
    callback();
    return true;
  } catch (error) {
    const message = error?.message || "Unknown render error";
    console.error(`[render:${label}]`, error);
    if (elements.controlNote) {
      elements.controlNote.textContent = `שגיאת תצוגה באזור ${label}: ${message}`;
      elements.controlNote.className = "status-note text-small is-error";
    }
    return false;
  }
}

function renderAll() {
  syncFiltersFromInputs();
  state.view.dailyMetric = elements.dailyMetric.value;
  state.view.heatmapMetric = elements.heatmapMetric.value;
  state.view.movementMetric = elements.movementMetric.value;
  const filteredRows = getFilteredRows();
  const compareRows = getComparisonRows();
  const prizeRows = getPrizeScopeRows();
  const isAdminPage = state.ui.page === "admin";
  const canRenderCampaign = isManagerAuthenticated() && !state.auth.campaignAccessError;
  const canRenderAdmin = isAdminPage && canRenderCampaign;
  const isPrizePage = state.ui.page === "prizes" && canRenderCampaign;
  const shouldRenderProjectPage = state.ui.page === "project" && canRenderCampaign;
  if (shouldRenderProjectPage) {
    runRenderStep("project-page", () => renderProjectPage());
  }
  runRenderStep("brand-assets", () => renderBrandAssets());
  if (canRenderAdmin && state.ui.adminTab === "design") {
    runRenderStep("campaign-designer", () => renderCampaignDesigner());
  }
  runRenderStep("access-ui", () => refreshAccessUi());
  if (shouldRenderProjectPage) {
    runRenderStep("public-hero", () => renderPublicHeroBadges(prizeRows));
  }
  if (canRenderAdmin) {
    runRenderStep("table-visibility", () => updateTableVisibility());
    runRenderStep("filter-summary", () => renderActiveFilterSummary());
    runRenderStep("metric-toolbar", () => updateMetricToolbarState());
    runRenderStep("control-note", () => setControlNote(filteredRows, prizeRows));
    runRenderStep("admin-hero", () => renderHeroBadges(filteredRows, prizeRows, compareRows));
    runRenderStep("metrics", () => renderMetrics(filteredRows));
    runRenderStep("insight-assistant-scope", () => setInsightAssistantScope());
    runRenderStep("goals", () => renderGoalsBoard(filteredRows));
    runRenderStep("validation", () => renderValidationBoard());
    runRenderStep("executive", () => renderExecutiveBoard(filteredRows));
    runRenderStep("quality", () => renderQualityBoard(filteredRows));
    runRenderStep("segments", () => renderSegmentBoard(filteredRows));
    runRenderStep("comparison", () => renderComparisonBoard(filteredRows, compareRows));
    runRenderStep("daily-chart", () => renderDailyChart(filteredRows));
    runRenderStep("heatmap", () => renderHeatmap(filteredRows));
    runRenderStep("movement", () => renderMovement(filteredRows));
    runRenderStep("table", () => renderTable(filteredRows));
  }
  if (isPrizePage || canRenderAdmin) {
    runRenderStep("prizes", () => renderPrizeBoard(prizeRows));
  }
}

function bindEvents() {
  elements.navButtons.forEach((button) => {
    listen(button, "click", async (event) => {
      const targetPage = button.dataset.pageTarget || "prizes";
      if (button.tagName === "A") {
        if (targetPage === "admin" || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button) return;
        event.preventDefault();
      }
      await navigateToPage(targetPage, { updateHistory: true });
      root.querySelector(".app-content").scrollIntoView({ block: "start" });
      if (targetPage === "admin" && !isManagerAuthenticated()) {
        elements.loginEmail.focus();
      }
    });
  });
  listen(window, "popstate", () => {
    const page = getInitialPage(window.location.pathname, isManagerAuthenticated());
    if (page === "admin") { window.location.reload(); return; }
    void navigateToPage(page);
  });

  elements.adminTabButtons.forEach((button) => {
    listen(button, "click", () => {
      setAdminTab(button.dataset.adminTabTarget || "insights");
    });
  });

  if (elements.projectPageRoot) {
    listen(elements.projectPageRoot, "click", (event) => {
      const actionElement = event.target.closest("[data-project-action]");
      if (!actionElement) {
        return;
      }
      const action = actionElement.dataset.projectAction;
      if (action === "scroll-donation") {
        root.querySelector("#project-donation-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (action === "go-prizes") {
        void navigateToPage("prizes", { updateHistory: true });
        return;
      }
      if (action === "set-frequency") {
        state.donation.frequency = actionElement.dataset.value === "monthly" ? "monthly" : "one_time";
        state.donation.message = "";
        state.donation.tone = "";
        renderProjectPage();
        return;
      }
      if (action === "select-amount") {
        state.donation.selectedAmount = Number(actionElement.dataset.value || 0);
        state.donation.customAmount = "";
        state.donation.message = "";
        state.donation.tone = "";
        renderProjectPage();
        return;
      }
      if (action === "continue-donation") {
        const selectedAmount = getProjectSelectedAmount();
        if (!selectedAmount) {
          state.donation.message = "יש לבחור סכום תרומה לפני המעבר לתשלום.";
          state.donation.tone = "error";
          renderProjectPage();
          return;
        }
        if (!String(state.donation.donorName || "").trim() || !String(state.donation.donorEmail || "").trim()) {
          state.donation.message = 'יש למלא לפחות שם מלא ודוא"ל לפני המעבר לתשלום.';
          state.donation.tone = "error";
          renderProjectPage();
          return;
        }
        try {
          const outgoingUrl = buildProjectDonationUrl();
          state.donation.message = "המעבר בוצע לחלון חדש של ספק התשלום.";
          state.donation.tone = "success";
          window.open(outgoingUrl, "_blank", "noopener,noreferrer");
        } catch (error) {
          state.donation.message = error?.message || "לא הוגדר עדיין קישור יציאה תקין לספק התשלום.";
          state.donation.tone = "error";
        }
        renderProjectPage();
        return;
      }
    });

    listen(elements.projectPageRoot, "input", (event) => {
      const field = event.target?.dataset?.donationField;
      if (!field) {
        return;
      }
      state.donation[field] = event.target.value;
      state.donation.message = "";
      state.donation.tone = "";
    });

    listen(elements.projectPageRoot, "change", (event) => {
      const field = event.target?.dataset?.donationField;
      if (!field) {
        return;
      }
      if (event.target.type === "checkbox") {
        state.donation[field] = Boolean(event.target.checked);
      } else {
        state.donation[field] = event.target.value;
      }
      state.donation.message = "";
      state.donation.tone = "";
      if (field === "ambassador" || field === "customAmount") {
        renderProjectPage();
      }
    });
  }

  if (elements.campaignDesignerPanel) {
    listen(elements.campaignDesignerPanel, "input", (event) => {
      if (event.target?.id === "prize-exclusions-input") {
        const excludedAmbassadors = event.target.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
        state.prizeModel = normalizePrizeModel({ ...state.prizeModel, excludedAmbassadors });
        state.campaignBuilder = normalizeCampaignBuilderConfig({ ...state.campaignBuilder, goals: { ...state.campaignBuilder.goals, excludedAmbassadors } });
        storePrizeModel(state.prizeModel);
        queueCampaignBuilderAutosave("החרגות הפרסים נשמרו בטיוטת הקמפיין.");
        return;
      }
      if (event.target?.id === "sprint-prize-input") {
        const sprintPrize = String(event.target.value || "").trim();
        state.prizeModel = normalizePrizeModel({ ...state.prizeModel, sprintPrize });
        state.campaignBuilder = normalizeCampaignBuilderConfig({
          ...state.campaignBuilder,
          goals: { ...state.campaignBuilder.goals, sprintPrize },
        });
        storePrizeModel(state.prizeModel);
        queueCampaignBuilderAutosave("פרס הספרינט נשמר בטיוטת הקמפיין.");
        return;
      }

      const builderSettingPath = event.target?.dataset?.builderSetting;
      if (builderSettingPath) {
        let value = event.target.value;
        if (event.target.type === "number") {
          value = Number(value || 0);
        }
        if (value === "true") {
          value = true;
        } else if (value === "false") {
          value = false;
        }
        if (builderSettingPath.endsWith(".nickname") || builderSettingPath === "basics.slug") {
          value = normalizeUrlSlug(value);
          event.target.value = value;
        }
        if (builderSettingPath.endsWith(".email")) {
          value = normalizeSearchToken(value);
          event.target.value = value;
        }
        const nextBuilder = cloneSerializable(state.campaignBuilder);
        setValueAtPath(nextBuilder, builderSettingPath, value);
        state.campaignBuilder = normalizeCampaignBuilderConfig(nextBuilder);
        if (builderSettingPath === "basics.slug") {
          state.campaignPage.projectSlug = value;
        }
        if (builderSettingPath === "basics.organizationName") {
          renderBrandAssets();
        }
        queueCampaignBuilderAutosave();
        return;
      }

      const builderEmailListPath = event.target?.dataset?.builderEmailList;
      if (builderEmailListPath) {
        const nextBuilder = cloneSerializable(state.campaignBuilder);
        setValueAtPath(nextBuilder, builderEmailListPath, parseEmailLines(event.target.value));
        state.campaignBuilder = normalizeCampaignBuilderConfig(nextBuilder);
        queueCampaignBuilderAutosave();
        return;
      }

      const builderGoalPath = event.target?.dataset?.builderGoal;
      if (builderGoalPath) {
        const numericValue = Number(event.target.value || 0);
        if (builderGoalPath === "total") {
          state.goals.total = numericValue;
          state.campaignBuilder.basics.target = numericValue;
        } else if (builderGoalPath === "daily") {
          state.goals.daily = numericValue;
        }
        queueCampaignBuilderAutosave();
        return;
      }

      const settingPath = event.target?.dataset?.campaignSetting;
      if (!settingPath) {
        return;
      }
      const value = event.target.value;
      if (settingPath === "amountCardsText") {
        state.campaignPage.amountCards = parseAmountCardText(value);
      } else if (settingPath.startsWith("theme.")) {
        state.campaignPage.theme[settingPath.split(".")[1]] = value;
      } else {
        state.campaignPage[settingPath] = value;
      }
      state.campaignPage = normalizeCampaignPageSettings(state.campaignPage);
      persistCampaignPageSettings(state.campaignPage);
      state.donation = syncDonationStateWithCampaignPage(state.donation, state.campaignPage);
      renderBrandAssets();
      renderProjectPage();
      queueCampaignBuilderAutosave();
    });

    listen(elements.campaignDesignerPanel, "change", async (event) => {
      if (event.target?.dataset?.builderStep) {
        state.ui.campaignBuilderStep = Number(event.target.dataset.builderStep || 1);
        renderCampaignDesigner(true);
        return;
      }

      if (event.target?.dataset?.campaignRegistry === "active-id") {
        const nextCampaignId = String(event.target.value || "").trim();
        if (nextCampaignId && nextCampaignId !== state.activeCampaignId) {
          await switchActiveCampaign(nextCampaignId, { message: "הקמפיין הפעיל הוחלף." });
          renderCampaignDesigner(true);
          renderProjectPage();
        }
        return;
      }

      if (event.target?.hasAttribute("data-builder-template")) {
        applyCampaignTemplate(event.target.value);
        renderCampaignDesigner(true);
        renderProjectPage();
        return;
      }

      const settingPath = event.target?.dataset?.campaignSetting;
      if (settingPath) {
        let value = event.target.value;
        if (settingPath === "showRecurring") {
          value = value === "true";
        } else if (settingPath === "amountCardsText") {
          value = parseAmountCardText(value);
        }
        if (settingPath === "amountCardsText") {
          state.campaignPage.amountCards = value;
        } else if (settingPath.startsWith("theme.")) {
          state.campaignPage.theme[settingPath.split(".")[1]] = value;
        } else {
          state.campaignPage[settingPath] = value;
        }
        state.campaignPage = normalizeCampaignPageSettings(state.campaignPage);
        persistCampaignPageSettings(state.campaignPage);
        state.donation = syncDonationStateWithCampaignPage(state.donation, state.campaignPage);
        renderBrandAssets();
        if (["platformBaseUrl", "projectSlug"].includes(settingPath)) {
          renderCampaignDesigner(true);
        }
        renderProjectPage();
        queueCampaignBuilderAutosave();
        return;
      }

      if (event.target.id === "campaign-media-upload") {
        const [file] = event.target.files || [];
        if (!file) {
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          state.campaignPage.mediaType = String(file.type || "").startsWith("video/") ? "video" : "image";
          state.campaignPage.mediaUrl = String(reader.result || "");
          state.campaignPage.mediaAlt = file.name;
          state.campaignPage = normalizeCampaignPageSettings(state.campaignPage);
          persistCampaignPageSettings(
            state.campaignPage,
            "המדיה נטענה ונשמרה לפאנל הניהול בדפדפן זה.",
            "המדיה נטענה לתצוגה הנוכחית, אבל לא נשמרה בדפדפן. נסה תמונה קטנה יותר או כתובת URL קלה יותר."
          );
          state.donation = syncDonationStateWithCampaignPage(state.donation, state.campaignPage);
          renderCampaignDesigner(true);
          renderProjectPage();
          queueCampaignBuilderAutosave("המדיה נטענה ונשמרת בטיוטת הקמפיין.");
        };
        reader.onerror = () => {
          setCampaignSettingsStatus("טעינת הקובץ נכשלה. נסה שוב עם תמונה אחרת או קובץ קטן יותר.", "error");
          renderCampaignDesigner(true);
        };
        reader.readAsDataURL(file);
        return;
      }

      if (event.target.id === "campaign-logo-upload" || event.target.id === "organization-logo-upload") {
        const [file] = event.target.files || [];
        if (!file) {
          return;
        }
        const targetField = event.target.id === "campaign-logo-upload" ? "campaignLogoUrl" : "organizationLogoUrl";
        const reader = new FileReader();
        reader.onload = () => {
          state.campaignPage[targetField] = String(reader.result || "");
          state.campaignPage = normalizeCampaignPageSettings(state.campaignPage);
          persistCampaignPageSettings(
            state.campaignPage,
            `הלוגו נטען ונשמר עבור ${targetField === "campaignLogoUrl" ? "הקמפיין" : "הארגון"}.`,
            "טעינת הלוגו הושלמה אך השמירה המקומית נכשלה. אפשר להדביק Data URI ידנית."
          );
          renderBrandAssets();
          renderCampaignDesigner(true);
          renderProjectPage();
          queueCampaignBuilderAutosave("לוגו הקמפיין עודכן ונשמר בטיוטת הקמפיין.");
        };
        reader.onerror = () => {
          setCampaignSettingsStatus("טעינת קובץ הלוגו נכשלה. נסה/י תמונה אחרת או הדבקת Data URI.", "error");
          renderCampaignDesigner(true);
        };
        reader.readAsDataURL(file);
        return;
      }

      if (event.target.id === "campaign-prize-upload") {
        const [file] = event.target.files || [];
        if (file) {
          await applyPrizeModelUpload(file, { fromCampaignBuilder: true });
        }
        return;
      }

      if (event.target.id === "ambassador-directory-upload") {
        const [file] = event.target.files || [];
        if (!file) {
          return;
        }
        try {
          const parsed = parseAmbassadorDirectoryCsv(await file.text());
          if (!parsed.records.length) {
            setAmbassadorDirectoryStatus("לא זוהו שגרירים תקינים בקובץ. נדרשים שם מלא ומייל תקין או כינוי לכל שורה.", "error");
            renderCampaignDesigner(true);
            return;
          }
          const backendImport = await persistAmbassadorDirectoryToBackend(parsed.records, file.name || "ambassador-registration-csv");
          state.ambassadorDirectory = parsed.records;
          storeAmbassadorDirectory(state.ambassadorDirectory);
          const notes = [];
          notes.push(`${formatNumber(parsed.records.length)} שגרירים נשמרו עם לינקים אישיים.`);
          if (backendImport) {
            notes.push(`${formatNumber(backendImport.importedCount || 0)} רשומות נשמרו במסד הנתונים.`);
            if (backendImport.duplicateRows) {
              notes.push(`${formatNumber(backendImport.duplicateRows)} כפילויות אוחדו לפי מייל/כינוי.`);
            }
          }
          if (parsed.generatedNicknames.length) {
            notes.push(`${formatNumber(parsed.generatedNicknames.length)} כינויים נוצרו אוטומטית מכתובת המייל.`);
          }
          if (parsed.missingRows.length) {
            notes.push(`${formatNumber(parsed.missingRows.length)} שורות נדלגו בגלל שם או כינוי חסרים.`);
          }
          if (parsed.duplicateNicknames.length) {
            notes.push(`${formatNumber(parsed.duplicateNicknames.length)} כפילויות כינוי נוטרלו.`);
          }
          setAmbassadorDirectoryStatus(notes.join(" "), parsed.missingRows.length || parsed.duplicateNicknames.length ? "warning" : "success");
          applyAmbassadorContextFromUrl();
          state.donation = syncDonationStateWithCampaignPage(state.donation, state.campaignPage);
          renderCampaignDesigner(true);
          renderProjectPage();
          queueCampaignBuilderAutosave("רשימת השגרירים עודכנה ונשמרת בטיוטת הקמפיין.");
        } catch (error) {
          setAmbassadorDirectoryStatus(error?.message || "טעינת קובץ השגרירים נכשלה. ודא/י שמדובר ב-CSV תקין עם שם מלא ומייל או כינוי.", "error");
          renderCampaignDesigner(true);
        }
      }
    });

    listen(elements.campaignDesignerPanel, "click", (event) => {
      const actionElement = event.target.closest("[data-project-action]");
      if (!actionElement) {
        return;
      }
      const action = actionElement.dataset.projectAction;
      if (action === "open-project-preview") {
        setPage("project");
        renderProjectPage();
        return;
      }
      if (action === "reset-campaign-settings") {
        state.campaignPage = normalizeCampaignPageSettings(cloneSerializable(INITIAL_CAMPAIGN_PAGE_SETTINGS));
        state.campaignBuilder = normalizeCampaignBuilderConfig(null);
        state.goals = { total: 0, daily: 0 };
        state.prizeModel = normalizePrizeModel(cloneSerializable(INITIAL_PRIZES));
        state.ambassadorDirectory = [];
        state.sourceConfig = getDefaultSourceConfig();
        persistActiveCampaignLegacyState();
        syncCampaignRegistryFromState();
        setCampaignSettingsStatus("הגדרות דף הפרויקט אופסו לברירת המחדל.", "success");
        state.donation = getDefaultDonationState(state.campaignPage);
        renderCampaignDesigner(true);
        renderProjectPage();
        return;
      }
      if (action === "export-ambassador-links") {
        if (!state.ambassadorDirectory.length) {
          setAmbassadorDirectoryStatus("אין עדיין שגרירים לייצוא. יש להעלות קודם קובץ CSV.", "warning");
          renderCampaignDesigner(true);
          return;
        }
        exportAmbassadorLinks(state.ambassadorDirectory);
        setAmbassadorDirectoryStatus("קובץ הלינקים האישיים יוצא בהצלחה.", "success");
        renderCampaignDesigner(true);
        return;
      }
      if (action === "export-zero-fundraising-ambassadors") {
        if (!state.ambassadorDirectory.length) {
          setAmbassadorDirectoryStatus("אין עדיין רשימת שגרירים להשוואה. יש להעלות קודם קובץ CSV.", "warning");
          renderCampaignDesigner(true);
          return;
        }
        const zeroFundraisingAmbassadors = getAmbassadorsWithNoFundraising();
        if (!zeroFundraisingAmbassadors.length) {
          setAmbassadorDirectoryStatus("כל השגרירים ברשימה גייסו סכום חיובי. אין קובץ לייצוא.", "success");
          renderCampaignDesigner(true);
          return;
        }
        exportAmbassadorFundraisingReport(zeroFundraisingAmbassadors, "ambassadors-zero-fundraising.csv");
        setAmbassadorDirectoryStatus(`יוצא קובץ עם ${formatNumber(zeroFundraisingAmbassadors.length)} שגרירים ללא גיוס.`, "success");
        renderCampaignDesigner(true);
        return;
      }
      if (action === "apply-ambassador-report") {
        const nextFilters = { ...state.ui.ambassadorReportFilters };
        elements.campaignDesignerPanel.querySelectorAll("[data-ambassador-report-filter]").forEach((field) => {
          nextFilters[field.dataset.ambassadorReportFilter] = field.value;
        });
        state.ui.ambassadorReportFilters = nextFilters;
        renderCampaignDesigner(true);
        return;
      }
      if (action === "export-ambassador-report") {
        const nextFilters = { ...state.ui.ambassadorReportFilters };
        elements.campaignDesignerPanel.querySelectorAll("[data-ambassador-report-filter]").forEach((field) => {
          nextFilters[field.dataset.ambassadorReportFilter] = field.value;
        });
        state.ui.ambassadorReportFilters = nextFilters;
        const reportRows = getFilteredAmbassadorFundraisingReport();
        if (!reportRows.length) {
          setAmbassadorDirectoryStatus("אין שגרירים התואמים לסינון הנוכחי.", "warning");
          renderCampaignDesigner(true);
          return;
        }
        exportAmbassadorFundraisingReport(reportRows);
        setAmbassadorDirectoryStatus(`יוצא דוח שגרירים עם ${formatNumber(reportRows.length)} רשומות.`, "success");
        renderCampaignDesigner(true);
        return;
      }
      if (action === "clear-ambassador-directory") {
        state.ambassadorDirectory = [];
        storeAmbassadorDirectory([]);
        setAmbassadorDirectoryStatus("רשימת השגרירים המקומית נוקתה.", "warning");
        if (state.donation.ambassador !== "general") {
          state.donation.ambassador = "general";
        }
        renderCampaignDesigner(true);
        renderProjectPage();
        queueCampaignBuilderAutosave("רשימת השגרירים נוקתה ונשמרת בטיוטה.");
      }
    });

    listen(elements.campaignDesignerPanel, "click", async (event) => {
      const stepButton = event.target.closest("[data-builder-step]");
      if (stepButton) {
        state.ui.campaignBuilderStep = Number(stepButton.dataset.builderStep || 1);
        renderCampaignDesigner(true);
        return;
      }
      const builderActionElement = event.target.closest("[data-builder-action]");
      if (!builderActionElement) {
        return;
      }
      const action = builderActionElement.dataset.builderAction;
      if (action === "create-campaign") {
        createNewCampaignDraft();
        renderCampaignDesigner(true);
        renderProjectPage();
        return;
      }
      if (action === "next-step") {
        state.ui.campaignBuilderStep = Math.min(9, Number(state.ui.campaignBuilderStep || 1) + 1);
        renderCampaignDesigner(true);
        return;
      }
      if (action === "prev-step") {
        state.ui.campaignBuilderStep = Math.max(1, Number(state.ui.campaignBuilderStep || 1) - 1);
        renderCampaignDesigner(true);
        return;
      }
      if (action === "save-now") {
        try {
          await saveCampaignBuilderConfig();
        } catch (error) {
          setCampaignBuilderStatus(error?.message || "שמירת טיוטת הקמפיין נכשלה.", "error");
        }
        renderCampaignDesigner(true);
        return;
      }
      if (action === "duplicate-campaign") {
        duplicateCampaignBuilderDraft();
        return;
      }
      if (action === "go-to-source-center") {
        setAdminTab("insights");
        elements.sourceMode?.focus();
        return;
      }
      if (action === "add-manual-ambassador") {
        const draft = normalizeCampaignBuilderConfig(state.campaignBuilder).ambassadors.manualDraft;
        if (!draft.fullName || !draft.nickname) {
          setAmbassadorDirectoryStatus("כדי להוסיף שגריר ידנית יש למלא לפחות שם מלא וכינוי.", "error");
          renderCampaignDesigner(true);
          return;
        }
        state.ambassadorDirectory = normalizeAmbassadorDirectory([
          ...state.ambassadorDirectory,
          {
            fullName: draft.fullName,
            nickname: draft.nickname,
            email: draft.email,
            phone: draft.phone,
            team: draft.team,
            personalTarget: Number(draft.personalTarget || 0),
            status: "active",
          },
        ]);
        state.campaignBuilder.ambassadors.manualDraft = {
          fullName: "",
          nickname: "",
          email: "",
          phone: "",
          team: "",
          personalTarget: "",
        };
        storeAmbassadorDirectory(state.ambassadorDirectory);
        setAmbassadorDirectoryStatus("השגריר/ה נוספו לרשימה ונשמרים בטיוטה.", "success");
        renderCampaignDesigner(true);
        renderProjectPage();
        queueCampaignBuilderAutosave();
        return;
      }
      if (action === "add-team") {
        const teamName = elements.campaignDesignerPanel.querySelector("#builder-team-name")?.value || "";
        const teamManager = elements.campaignDesignerPanel.querySelector("#builder-team-manager")?.value || "";
        const teamTarget = Number(elements.campaignDesignerPanel.querySelector("#builder-team-target")?.value || 0);
        if (!String(teamName).trim()) {
          setCampaignBuilderStatus("יש להזין שם צוות לפני הוספה.", "error");
          renderCampaignDesigner(true);
          return;
        }
        state.campaignBuilder.teams.enabled = true;
        state.campaignBuilder.teams.groups = [
          ...state.campaignBuilder.teams.groups,
          {
            name: String(teamName).trim(),
            manager: String(teamManager).trim(),
            target: teamTarget,
          },
        ];
        renderCampaignDesigner(true);
        queueCampaignBuilderAutosave("הצוות נוסף ונשמר בטיוטה.");
        return;
      }
      if (action === "remove-team") {
        const index = Number(builderActionElement.dataset.teamIndex || -1);
        state.campaignBuilder.teams.groups = state.campaignBuilder.teams.groups.filter((_item, itemIndex) => itemIndex !== index);
        renderCampaignDesigner(true);
        queueCampaignBuilderAutosave("הצוות הוסר מהטיוטה.");
        return;
      }
      if (action === "launch-campaign") {
        const preflight = buildCampaignPreflight(getCampaignBuilderSnapshot());
        if (preflight.blocking.length) {
          setCampaignBuilderStatus("לא ניתן להעלות קמפיין עם חסימות פתוחות. השלם/י קודם את ה־preflight.", "error");
          renderCampaignDesigner(true);
          return;
        }
        state.campaignBuilder.basics.status = "live";
        state.campaignBuilder.review.launchedAt = new Date().toISOString();
        try {
          await saveCampaignBuilderConfig();
        } catch (error) {
          setCampaignBuilderStatus(error?.message || "שמירת סטטוס ההשקה נכשלה.", "error");
        }
        renderCampaignDesigner(true);
        return;
      }
    });
  }

  listen(elements.logoutButton, "click", async () => {
    try {
      await logoutSiteSession();
    } catch (_error) {
      setLoginMessage("ההתנתקות נכשלה. נסו שוב.", "error");
      setImportMessage("ההתנתקות נכשלה. נסו שוב.", "error");
    }
  });

  listen(elements.loginForm, "submit", async (event) => {
    event.preventDefault();
    if (!canUseBackendAuth()) {
      setLoginMessage(getLocalAdminEntryHint(), "error");
      return;
    }
    const email = normalizeSearchToken(elements.loginEmail.value);
    const password = elements.loginPassword.value;
    const confirmPassword = elements.loginPasswordConfirm?.value || "";
    storeAdminEmail(email);
    if (!email || !password) {
      setLoginMessage("יש למלא גם מייל וגם סיסמה.", "error");
      return;
    }
    if (state.auth.setupMode && !confirmPassword) {
      setLoginMessage("יש לאשר את הסיסמה כדי להשלים את ההגדרה הראשונית.", "error");
      return;
    }
    if (state.auth.setupMode && password.length < 8) {
      setLoginMessage("בכניסה ראשונה יש לבחור סיסמה באורך 8 תווים לפחות.", "error");
      return;
    }
    if (state.auth.setupMode && password !== confirmPassword) {
      setLoginMessage("אימות הסיסמה לא תואם.", "error");
      return;
    }
    try {
      const endpoint = state.auth.setupMode ? AUTH_CONFIG.setupEndpoint : AUTH_CONFIG.loginEndpoint;
      const { response, payload } = await authRequest(endpoint, {
        method: "POST",
        body: state.auth.setupMode
          ? { email, password, confirmPassword }
          : { email, password },
      });
      state.auth.backendAvailable = true;

      if (response.ok && payload?.authenticated && payload?.email) {
        await hydrateAuthSession(payload);
        setSetupMode(false);
        elements.loginPassword.value = "";
        if (elements.loginPasswordConfirm) {
          elements.loginPasswordConfirm.value = "";
        }
        setLoginMessage(payload.message || "הכניסה הצליחה. הדשבורד הניהולי נפתח.", "success");
        renderSourceConfigControls();
        setPage(getInitialPage(window.location.pathname, isManagerAuthenticated()));
        setAdminTab("insights");
        renderAll();
        return;
      }

      if (payload?.code === "setup_required" || payload?.setupRequired) {
        setSetupMode(true);
        setLoginMessage(payload.message || "זו כניסה ראשונה. יש להגדיר סיסמה אישית.", "warning");
        if (elements.loginPasswordConfirm) {
          elements.loginPasswordConfirm.focus();
        }
        return;
      }

      setLoginMessage(payload?.message || "התחברות נכשלה.", "error");
    } catch (_error) {
      state.auth.backendAvailable = false;
      setLoginMessage("שירות הניהול אינו זמין כרגע. נסו שוב בעוד רגע.", "error");
    }
  });

  listen(elements.loginPasswordToggle, "click", () => {
    const isPassword = elements.loginPassword.type === "password";
    elements.loginPassword.type = isPassword ? "text" : "password";
    if (elements.loginPasswordConfirm) {
      elements.loginPasswordConfirm.type = isPassword ? "text" : "password";
    }
    elements.loginPasswordToggle.textContent = isPassword ? "הסתר" : "הצג";
  });

  if (elements.loginResetButton) {
    listen(elements.loginResetButton, "click", async () => {
      if (!canUseLocalPasswordReset()) {
        setLoginMessage("איפוס סיסמה זמין כרגע רק דרך השרת המקומי.", "warning");
        return;
      }
      const email = normalizeSearchToken(elements.loginEmail.value);
      if (!email) {
        setLoginMessage("יש להזין קודם את מייל המנהל/ת שאותו רוצים לאפס.", "error");
        elements.loginEmail.focus();
        return;
      }
      const confirmed = window.confirm(`לאפס את הסיסמה עבור ${email}? בכניסה הבאה תתבקש/י להגדיר סיסמה חדשה.`);
      if (!confirmed) {
        return;
      }
      try {
        const { response, payload } = await authRequest(AUTH_CONFIG.resetEndpoint, {
          method: "POST",
          body: { email },
        });
        state.auth.backendAvailable = true;
        if (!response.ok) {
          setLoginMessage(payload?.message || "איפוס הסיסמה נכשל.", "error");
          return;
        }
        clearSessionState();
        storeAdminEmail(email);
        elements.loginEmail.value = email;
        elements.loginPassword.value = "";
        if (elements.loginPasswordConfirm) {
          elements.loginPasswordConfirm.value = "";
        }
        setSetupMode(true);
        setLoginMessage(payload?.message || "הסיסמה אופסה. יש להגדיר סיסמה חדשה כדי להיכנס.", "success");
        if (elements.loginPassword) {
          elements.loginPassword.focus();
        }
      } catch (_error) {
        state.auth.backendAvailable = false;
        setLoginMessage("שרת הניהול המקומי אינו זמין כרגע. לא ניתן לאפס סיסמה.", "error");
      }
    });
  }

  listen(elements.loginEmail, "input", () => {
    storeAdminEmail(elements.loginEmail.value);
    if (state.auth.setupMode) {
      setSetupMode(false);
    }
    setLoginMessage("");
  });

  [
    elements.sourceMode,
    elements.sourceApiEndpoint,
    elements.sourceApiMethod,
    elements.sourceApiFormat,
    elements.sourceApiRecordsPath,
    elements.sourceApiAuthType,
    elements.sourceApiAutoRefresh,
    elements.sourceApiBearerToken,
    elements.sourceApiHeaders,
    elements.sourceApiBody,
    elements.sourceApiFieldMap,
    elements.sourceGoogleUrl,
    elements.sourceGoogleId,
    elements.sourceGoogleGid,
    elements.sourceGoogleSheetName,
    elements.sourceGoogleRange,
    elements.sourceGoogleAccessMode,
    elements.sourceGoogleSyncInterval,
    elements.sourceGoogleFieldMap,
  ]
    .filter(Boolean)
    .forEach((element) => {
      const eventName = element.tagName === "SELECT" ? "change" : "input";
      listen(element, eventName, () => {
        try {
          state.sourceConfig = collectSourceConfigFromControls();
        } catch (_error) {
          state.sourceConfig = normalizeSourceConfig(state.sourceConfig);
        }
        if (elements.sourceApiFields) {
          elements.sourceApiFields.hidden = state.sourceConfig.mode !== "api";
        }
        if (elements.sourceGoogleFields) {
          elements.sourceGoogleFields.hidden = state.sourceConfig.mode !== "google_sheets";
        }
        if (elements.refreshSourceApi) {
          elements.refreshSourceApi.disabled = state.sourceConfig.mode === "file";
        }
      });
    });

  if (elements.saveSourceConfig) {
    listen(elements.saveSourceConfig, "click", async () => {
      try {
        await saveSourceConfigFromControls();
      } catch (error) {
        setSourceConfigStatus(error?.message || "שמירת חיבור ה-API נכשלה.", "error");
      }
    });
  }

  if (elements.refreshSourceApi) {
    listen(elements.refreshSourceApi, "click", async () => {
      try {
        await saveSourceConfigFromControls({ silent: true });
        await refreshSourceDataFromApi();
      } catch (error) {
        setSourceConfigStatus(error?.message || "משיכת הנתונים מהמערכת החיצונית נכשלה.", "error");
      }
    });
  }

  if (elements.saveAnalysisProjectDates) {
    listen(elements.saveAnalysisProjectDates, "click", async () => {
      try {
        await saveAnalysisProjectDates();
      } catch (error) {
        setAnalysisProjectDatesStatus(error?.message || "שמירת תאריכי הפרויקט נכשלה.", "error");
      }
    });
  }

  if (elements.addManualContribution) {
    listen(elements.addManualContribution, "click", () => {
      try {
        openManualContributionDialog();
      } catch (error) {
        setImportMessage(error?.message || "לא ניתן לפתוח את חלונית ההכפלה.", "error");
      }
    });
  }

  if (elements.manualContributionCancel) {
    listen(elements.manualContributionCancel, "click", () => {
      elements.manualContributionDialog?.close();
    });
  }

  if (elements.manualContributionForm) {
    listen(elements.manualContributionForm, "submit", async (event) => {
      event.preventDefault();
      const submitButton = elements.manualContributionForm.querySelector('button[type="submit"]');
      try {
        setManualContributionStatus("שומר את ההכפלה...", "loading");
        if (submitButton) {
          submitButton.disabled = true;
        }
        await submitManualContribution();
        elements.manualContributionDialog?.close();
      } catch (error) {
        setManualContributionStatus(error?.message || "שמירת ההכפלה נכשלה.", "error");
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
        }
      }
    });
  }

  if (elements.insightAssistantForm) {
    listen(elements.insightAssistantForm, "submit", async (event) => {
      event.preventDefault();
      try {
        if (elements.insightAssistantAnswer) {
          elements.insightAssistantAnswer.hidden = false;
        }
        if (elements.insightAssistantAnswerText) {
          elements.insightAssistantAnswerText.textContent = "מחשב תשובה על בסיס הנתונים המעודכנים של הקמפיין...";
        }
        setInsightAssistantStatus("מחשב תשובה על בסיס נתוני הקמפיין...", "loading");
        if (elements.insightAssistantSubmit) {
          elements.insightAssistantSubmit.disabled = true;
        }
        await submitInsightAssistantQuestion();
      } catch (error) {
        setInsightAssistantStatus(error?.message || "לא ניתן לקבל תשובה מהנתונים כרגע.", "error");
      } finally {
        if (elements.insightAssistantSubmit) {
          elements.insightAssistantSubmit.disabled = false;
        }
      }
    });
  }

  if (elements.prizeAmbassadorSearch) {
    listen(elements.prizeAmbassadorSearch, "input", () => {
      state.ui.prizeAmbassadorSearch = elements.prizeAmbassadorSearch.value;
      renderPrizeAmbassadorDirectory(computePrizeStandings(getPrizeScopeRows()).leaderboard);
    });
  }

  [
    elements.ambassador,
    elements.projectDay,
    elements.dateExact,
    elements.dateFrom,
    elements.dateTo,
    elements.hour,
    elements.hourFrom,
    elements.hourTo,
    elements.timeFrom,
    elements.timeTo,
    elements.donor,
    elements.amountMin,
    elements.amountMax,
    elements.dailyMetric,
    elements.heatmapMetric,
    elements.movementMetric,
  ].forEach((element) => {
    listen(element, "change", renderAll);
    if (element.tagName === "INPUT") {
      listen(element, "input", renderAll);
    }
  });

  elements.metricButtons.forEach((button) => {
    listen(button, "click", () => {
      const selectId = button.dataset.metricSelect;
      const targetSelect = root.querySelector(`#${selectId}`);
      if (!targetSelect) {
        return;
      }
      targetSelect.value = button.dataset.value || targetSelect.value;
      renderAll();
    });
  });

  [elements.goalTotal, elements.goalDaily].forEach((element) => {
    listen(element, "change", () => {
      state.goals = {
        total: Number(elements.goalTotal.value || 0),
        daily: Number(elements.goalDaily.value || 0),
      };
      storeGoals(state.goals);
      renderAll();
    });
  });

  listen(elements.exportFiltered, "click", () => {
    const rows = getFilteredRows();
    exportRowsToCsv(rows, "filtered-donations-export.csv");
  });

  listen(elements.clearCompare, "click", () => {
    state.compare = {
      rows: [],
      meta: null,
      label: "",
    };
    state.validation.compare = null;
    elements.compareUpload.value = "";
    resetFilterOptions();
    renderAll();
  });

  listen(elements.clearFilters, "click", () => {
    state.filters = getDefaultFilters(state.meta);
    resetFilterOptions();
    renderAll();
  });

  listen(elements.resetWorkingData, "click", () => {
    restoreWorkingData();
    renderAll();
  });

  listen(elements.tableToggle, "click", () => {
    state.ui.tableExpanded = !state.ui.tableExpanded;
    updateTableVisibility();
  });

  listen(elements.upload, "change", async (event) => {
    const [file] = event.target.files || [];
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      const ingested = ingestCsvText(text, file.name);
      state.validation.base = ingested.validation;
      if (hasBlockingValidation(ingested.validation)) {
        setImportMessage(`קובץ העסקאות ${file.name} לא נטען. נשארים עם הנתונים הפעילים עד לתיקון הקלט.`, "error");
        renderAll();
        return;
      }
      state.meta = ingested.meta;
      state.rows = enrichRows(ingested.normalized, ingested.meta);
      state.sourceLabel = file.name;
      state.datasetFreshnessAt = new Date().toISOString();
      state.filters = getDefaultFilters(ingested.meta);
      resetFilterOptions();
      setImportMessage(
        ingested.validation.warnings.length
          ? `קובץ העסקאות ${file.name} נטען עם אזהרות. מומלץ לבדוק את לוח הולידציה לפני קבלת החלטות.`
          : `קובץ העסקאות ${file.name} נטען בהצלחה.`,
        ingested.validation.warnings.length ? "warning" : "success"
      );
      renderAll();
    } catch (_error) {
      setImportMessage(`טעינת קובץ העסקאות ${file.name} נכשלה. הנתונים הפעילים נשמרו כפי שהם.`, "error");
    }
  });

  listen(elements.compareUpload, "change", async (event) => {
    const [file] = event.target.files || [];
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      const ingested = ingestCsvText(text, file.name);
      state.validation.compare = ingested.validation;
      if (hasBlockingValidation(ingested.validation)) {
        setImportMessage(`קובץ ההשוואה ${file.name} לא נטען. ההשוואה הקודמת נשמרה ללא שינוי.`, "error");
        renderAll();
        return;
      }
      state.compare = {
        rows: enrichRows(ingested.normalized, ingested.meta),
        meta: ingested.meta,
        label: file.name,
      };
      resetFilterOptions();
      setImportMessage(
        ingested.validation.warnings.length
          ? `קובץ ההשוואה ${file.name} נטען עם אזהרות.`
          : `קובץ ההשוואה ${file.name} נטען בהצלחה.`,
        ingested.validation.warnings.length ? "warning" : "success"
      );
      renderAll();
    } catch (_error) {
      setImportMessage(`טעינת קובץ ההשוואה ${file.name} נכשלה. ההשוואה הפעילה לא השתנתה.`, "error");
    }
  });

  listen(elements.prizeUpload, "change", async (event) => {
    const [file] = event.target.files || [];
    if (!file) {
      return;
    }
    await applyPrizeModelUpload(file, { fromCampaignBuilder: false });
  });
}

async function start() {

try {
  state.rows = enrichRows(state.rows, state.meta);
  state.validation.base = buildBaseValidationSnapshot(state.rows, state.sourceLabel);
  state.prizeModel = normalizePrizeModel(state.prizeModel);
  if (hasPrizeModelContent(state.prizeModel)) {
    storePrizeModel(state.prizeModel);
  }
  hydrateRulesPage();
  resetFilterOptions();
  if (elements.loginEmail) {
    elements.loginEmail.value = readStoredAdminEmail();
  }
  setSetupMode(false);
  applyAmbassadorContextFromUrl();
  bindEvents();
  setPage(getInitialPage(window.location.pathname));
  renderAll();
  await hydrateAuthSession(initialSession, initialCampaignData);
  // Campaign data is loaded only after the server confirms manager access.
  if (isManagerAuthenticated() && !state.auth.adminDatasetLoaded && state.auth.publicDatasetStatus === "pending") {
    await loadPublicDataset().catch(() => false);
  }
  applyAmbassadorContextFromUrl();
  setPage(getInitialPage(window.location.pathname, isManagerAuthenticated()));
  if (state.ui.page === "admin") setAdminTab(state.ui.adminTab);
  setLoginMessage("");
  setImportMessage(getDefaultPrizeStatusMessage());
  renderSourceConfigControls();
  renderAll();
  onReady();
} catch (error) {
  if (signal.aborted) return;
  onError(error);
  console.error("[bootstrap]", error);
  const bootstrapMessage = error?.message || "Unknown bootstrap error";
  root.insertAdjacentHTML(
    "beforeend",
    `<div style="position:relative;z-index:30;margin:24px auto;max-width:960px;padding:16px 20px;border-radius:18px;background:rgba(255,214,41,0.16);border-inline-start:4px solid #090B10;color:#111D4A;font-weight:700;">שגיאת אתחול: ${escapeHtml(bootstrapMessage)}</div>`
  );
}
}
void start();
return () => { clearSourceRefreshTimer(); window.clearTimeout(campaignBuilderAutosaveTimerId); };

}
