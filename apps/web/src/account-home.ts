import { requestJson } from "./api";
import { authConfig } from "./platform";

export interface AccountMembership {
  organizationId: string;
  organizationSlug?: string;
  campaignId: string;
  campaignSlug?: string;
  role: "organization_admin" | "campaign_manager" | "analyst" | "viewer";
}

export interface AccessibleCampaign {
  organizationId: string;
  organizationSlug?: string;
  organizationName?: string;
  campaignId: string;
  campaignSlug?: string;
  campaignName?: string;
  status?: string;
  target?: number;
  currency?: string;
  raised?: number;
  updatedAt?: string;
  accessRole?: AccountMembership["role"] | "platform_admin";
}

export interface AccountSession {
  authenticated: boolean;
  email?: string;
  role?: string;
  memberships?: AccountMembership[];
  accessibleCampaigns?: AccessibleCampaign[];
  permissions?: {
    campaignPages?: boolean;
    analytics?: boolean;
    campaignManagement?: boolean;
    organizationManagement?: boolean;
    siteAdmin?: boolean;
    manageUsers?: boolean;
  };
}

interface ManagedAccount {
  email: string;
  isActive: boolean;
  siteAdmin: boolean;
  passwordSet: boolean;
  memberships: AccountMembership[];
  lastLoginAt?: string;
}

interface ManagedOrganization {
  id: string;
  slug: string;
  name: string;
  campaigns: { id: string; slug: string; name: string; status: string }[];
}

interface AccountManagementPayload {
  users: ManagedAccount[];
  organizations: ManagedOrganization[];
}

const roleLabels: Record<string, string> = {
  platform_admin: "מנהל/ת אתר",
  organization_admin: "מנהל/ת ארגון",
  campaign_manager: "מנהל/ת קמפיין",
  analyst: "אנליסט/ית",
  viewer: "צפייה בלבד",
};

function projectHref(campaign: AccessibleCampaign) {
  if (campaign.status === "completed" && campaign.accessRole === "viewer") {
    return `/campaigns/${encodeURIComponent(campaign.organizationSlug || campaign.organizationId)}/${encodeURIComponent(campaign.campaignSlug || campaign.campaignId)}`;
  }
  const path = campaign.accessRole === "viewer" ? "/project" : "/admin";
  const query = new URLSearchParams({
    organizationId: campaign.organizationId,
    campaignId: campaign.campaignId,
  });
  return `${path}?${query}`;
}

function appendProjectCard(container: HTMLElement, campaign: AccessibleCampaign) {
  const link = document.createElement("a");
  link.className = "account-project-card";
  link.href = projectHref(campaign);
  const status = document.createElement("span");
  status.className = "account-project-status";
  status.textContent = campaign.status === "completed" ? "הסתיים" : campaign.status === "live" ? "פעיל" : "בהכנה";
  const title = document.createElement("h3");
  title.textContent = campaign.campaignName || campaign.campaignId;
  const organization = document.createElement("p");
  organization.textContent = campaign.organizationName || campaign.organizationSlug || campaign.organizationId;
  const role = document.createElement("span");
  role.className = "account-project-role";
  role.textContent = roleLabels[campaign.accessRole || "viewer"] || roleLabels.viewer;
  link.append(status, title, organization, role);
  container.append(link);
}

export function getProjectDestination(campaign: AccessibleCampaign) {
  return projectHref(campaign);
}

export function mountAccountHome(root: HTMLElement, session: AccountSession, signal: AbortSignal) {
  const element = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const active = (session.accessibleCampaigns || []).filter((campaign) => campaign.status !== "completed");
  const completed = (session.accessibleCampaigns || []).filter((campaign) => campaign.status === "completed");
  const activeList = element("active-projects-list");
  const completedList = element("completed-projects-list");
  activeList.replaceChildren();
  completedList.replaceChildren();
  active.forEach((campaign) => appendProjectCard(activeList, campaign));
  completed.forEach((campaign) => appendProjectCard(completedList, campaign));
  element("active-projects-count").textContent = String(active.length);
  element("completed-projects-count").textContent = String(completed.length);
  element("active-projects-empty").hidden = active.length > 0;
  element("completed-projects-empty").hidden = completed.length > 0;

  const management = element("site-access-management");
  if (!session.permissions?.manageUsers) {
    management.hidden = true;
    return () => {};
  }
  management.hidden = false;

  const form = element<HTMLFormElement>("managed-account-form");
  const emailInput = element<HTMLInputElement>("managed-account-email");
  const activeInput = element<HTMLInputElement>("managed-account-active");
  const siteAdminInput = element<HTMLInputElement>("managed-account-site-admin");
  const membershipsShell = element("managed-memberships-shell");
  const membershipsContainer = element("managed-memberships");
  const accountList = element("managed-account-list");
  const status = element("account-management-status");
  let data: AccountManagementPayload = { users: [], organizations: [] };
  let editingEmail = "";

  const setStatus = (message: string, tone = "") => {
    status.textContent = message;
    status.className = `status-note text-small${tone ? ` is-${tone}` : ""}`;
  };

  const option = (value: string, label: string) => {
    const item = document.createElement("option");
    item.value = value;
    item.textContent = label;
    return item;
  };

  const addMembershipRow = (membership: Partial<AccountMembership> = {}) => {
    const row = document.createElement("div");
    row.className = "managed-membership-row";
    const organizationSelect = document.createElement("select");
    organizationSelect.className = "form-select";
    organizationSelect.setAttribute("aria-label", "ארגון");
    data.organizations.forEach((organization) => organizationSelect.append(option(organization.id, organization.name)));
    organizationSelect.value = membership.organizationId || data.organizations[0]?.id || "";
    const roleSelect = document.createElement("select");
    roleSelect.className = "form-select";
    roleSelect.setAttribute("aria-label", "תפקיד");
    for (const role of ["campaign_manager", "analyst", "viewer", "organization_admin"] as const) {
      roleSelect.append(option(role, roleLabels[role]));
    }
    roleSelect.value = membership.role || "campaign_manager";
    const campaignSelect = document.createElement("select");
    campaignSelect.className = "form-select";
    campaignSelect.setAttribute("aria-label", "פרויקט");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "button-ghost";
    remove.textContent = "הסרה";

    const renderCampaigns = () => {
      const organization = data.organizations.find((item) => item.id === organizationSelect.value);
      campaignSelect.replaceChildren(option("", "בחירת פרויקט"));
      organization?.campaigns.forEach((campaign) => campaignSelect.append(option(campaign.id, campaign.name)));
      const requested = membership.campaignId || "";
      if ([...campaignSelect.options].some((item) => item.value === requested)) campaignSelect.value = requested;
      const organizationRole = roleSelect.value === "organization_admin";
      campaignSelect.disabled = organizationRole;
      campaignSelect.required = !organizationRole;
      if (organizationRole) campaignSelect.value = "";
    };
    organizationSelect.addEventListener("change", () => { membership.campaignId = ""; renderCampaigns(); }, { signal });
    roleSelect.addEventListener("change", renderCampaigns, { signal });
    remove.addEventListener("click", () => row.remove(), { signal });
    row.append(organizationSelect, campaignSelect, roleSelect, remove);
    membershipsContainer.append(row);
    renderCampaigns();
  };

  const toggleSiteAdmin = () => {
    membershipsShell.hidden = siteAdminInput.checked;
  };
  siteAdminInput.addEventListener("change", toggleSiteAdmin, { signal });

  const resetForm = () => {
    editingEmail = "";
    form.reset();
    activeInput.checked = true;
    emailInput.readOnly = false;
    membershipsContainer.replaceChildren();
    if (data.organizations.length) addMembershipRow();
    element("managed-account-form-title").textContent = "אישור משתמש חדש";
    toggleSiteAdmin();
  };

  const editAccount = (account: ManagedAccount) => {
    editingEmail = account.email;
    emailInput.value = account.email;
    emailInput.readOnly = true;
    activeInput.checked = account.isActive;
    siteAdminInput.checked = account.siteAdmin;
    membershipsContainer.replaceChildren();
    account.memberships.forEach((membership) => addMembershipRow(membership));
    element("managed-account-form-title").textContent = `עריכת ${account.email}`;
    toggleSiteAdmin();
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const renderAccounts = () => {
    accountList.replaceChildren();
    for (const account of data.users) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "managed-account-card";
      const email = document.createElement("strong");
      email.textContent = account.email;
      const detail = document.createElement("span");
      detail.textContent = account.siteAdmin
        ? roleLabels.platform_admin
        : `${account.memberships.length} שיוכים · ${account.isActive ? "פעיל" : "מושבת"}`;
      const password = document.createElement("small");
      password.textContent = account.passwordSet ? "סיסמה הוגדרה" : "ממתין להגדרת סיסמה";
      button.append(email, detail, password);
      button.addEventListener("click", () => editAccount(account), { signal });
      accountList.append(button);
    }
  };

  const loadAccounts = async () => {
    setStatus("טוענים משתמשים והרשאות…");
    const { response, payload } = await requestJson<AccountManagementPayload & { message?: string }>(authConfig.accountsEndpoint, {}, signal);
    if (!response.ok) throw new Error(payload.message || "טעינת המשתמשים נכשלה.");
    data = payload;
    renderAccounts();
    resetForm();
    setStatus("");
  };

  element("new-account-button").addEventListener("click", resetForm, { signal });
  element("cancel-managed-account").addEventListener("click", resetForm, { signal });
  element("add-membership-button").addEventListener("click", () => addMembershipRow(), { signal });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = element<HTMLButtonElement>("save-managed-account");
    submit.disabled = true;
    try {
      const memberships = [...membershipsContainer.querySelectorAll<HTMLElement>(".managed-membership-row")].map((row) => {
        const selects = row.querySelectorAll<HTMLSelectElement>("select");
        return {
          organizationId: selects[0].value,
          campaignId: selects[1].value,
          role: selects[2].value,
        };
      });
      const { response, payload } = await requestJson<{ message?: string }>(authConfig.accountsEndpoint, {
        method: "POST",
        body: {
          email: editingEmail || emailInput.value.trim(),
          isActive: activeInput.checked,
          siteAdmin: siteAdminInput.checked,
          memberships: siteAdminInput.checked ? [] : memberships,
        },
      }, signal);
      if (!response.ok) throw new Error(payload.message || "שמירת המשתמש נכשלה.");
      await loadAccounts();
      setStatus(payload.message || "המשתמש נשמר.", "success");
    } catch (error) {
      if (!signal.aborted) setStatus(error instanceof Error ? error.message : "שמירת המשתמש נכשלה.", "error");
    } finally {
      submit.disabled = false;
    }
  }, { signal });

  void loadAccounts().catch((error) => {
    if (!signal.aborted) setStatus(error instanceof Error ? error.message : "טעינת המשתמשים נכשלה.", "error");
  });
  return () => {};
}
