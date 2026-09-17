import { useEffect, useMemo, useRef, useState } from "react";

import { requestJson } from "../api";
import { requestSession, type ManagerSession } from "../auth-gate";
import { Button, ButtonLink } from "./Button";
import { useRouteLifecycle } from "../route-lifecycle";
import { beginPageBusy, navigateSite } from "../../../../work/assets/page-feedback.js";

interface CampaignApplication {
  id: string;
  referenceCode: string;
  status: string;
  applicantName: string;
  applicantEmail: string;
  applicantPhone: string;
  organizationName: string;
  organizationType: string;
  organizationRegistrationNumber: string;
  campaignName: string;
  category: string;
  purpose: string;
  story: string;
  targetAmount: number;
  currencyCode: string;
  publicLinks: string[];
  externalProviderStatus: string;
  externalProviderUrl: string;
  adminNotifiedAt: string;
  notificationError: string;
  reviewNote: string;
  approvedOrganizationId: string;
  approvedCampaignId: string;
  reviewedAt: string;
  createdAt: string;
}

interface OrganizationOption {
  id: string;
  slug: string;
  name: string;
}

const statusLabels: Record<string, string> = {
  submitted: "ממתינה לבדיקה",
  under_review: "בבדיקה",
  approved: "אושרה",
  rejected: "נדחתה",
  changes_requested: "נדרשו שינויים",
  withdrawn: "נמשכה",
};

const organizationTypeLabels: Record<string, string> = {
  private: "יוזמה פרטית",
  community: "יוזמה קהילתית",
  nonprofit: "עמותה או מלכ״ר",
  business: "עסק או חברה",
  other: "אחר",
};

const providerLabels: Record<string, string> = {
  existing: "קיים עמוד אצל ספק חיצוני",
  needs_setup: "נדרש להקים חיבור לספק",
  not_sure: "עדיין לא ידוע",
};

function formatDate(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function AdminApplicationsPage() {
  const route = useRouteLifecycle();
  const decisionPending = useRef(false);
  const decisionAbort = useRef<AbortController | null>(null);
  const endDecision = useRef<(() => void) | null>(null);
  const [session, setSession] = useState<ManagerSession | null>(null);
  const [applications, setApplications] = useState<CampaignApplication[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationOption[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("טוענים בקשות…");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [organizationSelections, setOrganizationSelections] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [decisionMessage, setDecisionMessage] = useState<{ id: string; text: string; error: boolean } | null>(null);
  const [filter, setFilter] = useState("pending");

  useEffect(() => {
    if (route.paused) return;
    const abort = new AbortController();
    void requestSession(abort.signal).then(async ({ response, payload }) => {
      if (!response.ok || !payload.authenticated) {
        const returnTo = `${window.location.pathname}${window.location.search}`;
        navigateSite(`/login?returnTo=${encodeURIComponent(returnTo)}`, { replace: true });
        return;
      }
      setSession(payload);
      if (!payload.permissions?.siteAdmin) {
        setStatus("error");
        setMessage("רק מנהלי האתר יכולים לצפות בבקשות לפתיחת קמפיין.");
        return;
      }
      const result = await requestJson<{ applications?: CampaignApplication[]; organizations?: OrganizationOption[]; message?: string }>("/api/admin/applications", {}, abort.signal);
      if (!result.response.ok) throw new Error(result.payload.message || "טעינת הבקשות נכשלה.");
      setApplications(result.payload.applications || []);
      setOrganizations(result.payload.organizations || []);
      setStatus("ready");
      setMessage("");
    }).catch((error) => {
      if (!abort.signal.aborted) {
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "טעינת הבקשות נכשלה.");
      }
    });
    return () => { abort.abort(); decisionAbort.current?.abort(); endDecision.current?.(); };
  }, [route.paused]);

  useEffect(() => { if (!route.paused && status !== "loading") route.ready(); }, [status, route.paused, route.ready]);

  const visible = useMemo(() => applications.filter((application) => filter === "all"
    || (filter === "pending" ? ["submitted", "under_review"].includes(application.status) : application.status === filter)), [applications, filter]);

  const decide = async (application: CampaignApplication, action: "approve" | "reject") => {
    if (decisionPending.current) return;
    const reviewNote = notes[application.id]?.trim() || "";
    if (action === "reject" && reviewNote.length < 3) {
      setMessage("כדי לדחות בקשה יש להוסיף הסבר קצר בשדה ההערה.");
      return;
    }
    const confirmation = action === "approve"
      ? `לאשר את ${application.referenceCode}? הפעולה תיצור ארגון, טיוטת קמפיין וגישת מנהל/ת ארגון.`
      : `לדחות את ${application.referenceCode}?`;
    if (!window.confirm(confirmation)) return;
    decisionPending.current = true;
    const abort = new AbortController();
    decisionAbort.current = abort;
    endDecision.current = beginPageBusy(action === "approve" ? "מאשרים ופותחים טיוטה…" : "שומרים את הדחייה…");
    setBusyId(application.id);
    setBusyAction(action);
    setDecisionMessage(null);
    setMessage(action === "approve" ? "יוצרים את הקמפיין והגישה…" : "שומרים את ההחלטה…");
    try {
      const { response, payload } = await requestJson<{ application?: CampaignApplication; message?: string; emailDelivered?: boolean }>(
        `/api/admin/applications/${encodeURIComponent(application.id)}/decision`,
        { method: "POST", body: { action, reviewNote, organizationId: organizationSelections[application.id] || "" } }, abort.signal,
      );
      if (!response.ok || !payload.application) throw new Error(payload.message || "שמירת ההחלטה נכשלה.");
      setApplications((current) => current.map((item) => item.id === application.id ? payload.application! : item));
      const result = `${application.referenceCode}: ${payload.message || "ההחלטה נשמרה."}${payload.emailDelivered === false ? " מייל העדכון למגיש/ה לא נשלח ויש ליצור קשר ידנית." : ""}`;
      setMessage(result);
      setDecisionMessage({ id: application.id, text: result, error: false });
    } catch (error) {
      if (!abort.signal.aborted) {
        const result = error instanceof Error ? error.message : "שמירת ההחלטה נכשלה.";
        setMessage(result);
        setDecisionMessage({ id: application.id, text: result, error: true });
      }
    } finally {
      endDecision.current?.();
      endDecision.current = null;
      decisionPending.current = false;
      setBusyId("");
      setBusyAction("");
    }
  };

  return <div id="goodraise-application-root" className="admin-applications-root" dir="rtl">

    <main id="main" className="admin-applications-main" tabIndex={-1}>
      <header className="admin-applications-heading">
        <div>
          <span>Site administration</span>
          <h1>בקשות לפתיחת קמפיין</h1>
          <p>כאן מאשרים בקשה מאומתת לפני שנוצרים ארגון, קמפיין או חשבון ניהול.</p>
        </div>
        <ButtonLink href="/admin/users" variant="secondary">משתמשים והרשאות</ButtonLink>
      </header>

      <div className="admin-application-filters" role="group" aria-label="סינון בקשות">
        {[{ id: "pending", label: "ממתינות" }, { id: "approved", label: "אושרו" }, { id: "rejected", label: "נדחו" }, { id: "all", label: "הכול" }].map((item) =>
          <button key={item.id} type="button" className={filter === item.id ? "is-active" : ""} onClick={() => setFilter(item.id)}>{item.label}</button>)}
      </div>
      <div className={`admin-applications-message${status === "error" ? " is-error" : ""}`} role="status">{message}</div>

      {status === "ready" && !visible.length && <div className="admin-applications-empty">אין בקשות בתצוגה הזו.</div>}
      <div className="admin-applications-list">
        {visible.map((application) => {
          const reviewable = ["submitted", "under_review"].includes(application.status);
          return <article className="admin-application-card" key={application.id}>
            <header>
              <div>
                <span className={`admin-application-status is-${application.status}`}>{statusLabels[application.status] || application.status}</span>
                <h2>{application.campaignName}</h2>
                <p><span dir="ltr">{application.referenceCode}</span> · הוגשה {formatDate(application.createdAt)}</p>
              </div>
              <strong>{application.targetAmount.toLocaleString("he-IL")} ₪</strong>
            </header>
            <dl className="admin-application-details">
              <div><dt>מגיש/ה</dt><dd>{application.applicantName}<br /><a href={`mailto:${application.applicantEmail}`}>{application.applicantEmail}</a><br /><a href={`tel:${application.applicantPhone}`}>{application.applicantPhone}</a></dd></div>
              <div><dt>התארגנות</dt><dd>{application.organizationName}<br />{organizationTypeLabels[application.organizationType] || application.organizationType}{application.organizationRegistrationNumber && <><br /><span dir="ltr">{application.organizationRegistrationNumber}</span></>}</dd></div>
              <div><dt>קטגוריה</dt><dd>{application.category}</dd></div>
              <div><dt>חיבור לתרומות</dt><dd>{providerLabels[application.externalProviderStatus] || application.externalProviderStatus}{application.externalProviderUrl && <><br /><a href={application.externalProviderUrl} target="_blank" rel="noreferrer">פתיחת עמוד התרומות</a></>}</dd></div>
            </dl>
            <section className="admin-application-copy">
              <h3>מטרת הקמפיין</h3>
              <p>{application.purpose}</p>
              {application.story && <><h3>הסיפור</h3><p>{application.story}</p></>}
              {!!application.publicLinks.length && <div className="admin-application-links">{application.publicLinks.map((link) => <a href={link} target="_blank" rel="noreferrer" key={link}>קישור מצורף</a>)}</div>}
            </section>
            {application.notificationError && !application.adminNotifiedAt && <p className="admin-application-warning">הודעת המייל למנהלי האתר נכשלה: {application.notificationError}</p>}
            {decisionMessage?.id === application.id && <p role="status" className={decisionMessage.error ? "admin-application-warning" : "admin-application-decision"}>{decisionMessage.text}</p>}
            {reviewable ? <fieldset disabled={Boolean(busyId)} className="admin-application-review">
              <div className="admin-application-review-fields">
                <label>שיוך ארגוני באישור
                  <select value={organizationSelections[application.id] || ""} onChange={(event) => setOrganizationSelections((current) => ({ ...current, [application.id]: event.target.value }))}>
                    <option value="">יצירת ארגון חדש: {application.organizationName}</option>
                    {organizations.map((organization) => <option value={organization.id} key={organization.id}>שיוך לארגון קיים: {organization.name}</option>)}
                  </select>
                </label>
                <label>הערת החלטה <small>חובה בדחייה, אופציונלית באישור</small>
                  <textarea rows={3} maxLength={2000} value={notes[application.id] || ""} onChange={(event) => setNotes((current) => ({ ...current, [application.id]: event.target.value }))} />
                </label>
              </div>
              <div>
                <Button busy={busyId === application.id && busyAction === "approve"} onClick={() => void decide(application, "approve")}>{busyId === application.id && busyAction === "approve" ? "מאשרים…" : "אישור ופתיחת טיוטה"}</Button>
                <Button variant="danger" busy={busyId === application.id && busyAction === "reject"} onClick={() => void decide(application, "reject")}>{busyId === application.id && busyAction === "reject" ? "שומרים…" : "דחיית הבקשה"}</Button>
              </div>
            </fieldset> : <footer className="admin-application-decision">
              <strong>{statusLabels[application.status] || application.status}</strong>
              {application.reviewNote && <span>{application.reviewNote}</span>}
              {application.approvedOrganizationId && application.approvedCampaignId && <a href={`/admin?organizationId=${encodeURIComponent(application.approvedOrganizationId)}&campaignId=${encodeURIComponent(application.approvedCampaignId)}`}>פתיחת טיוטת הקמפיין</a>}
            </footer>}
          </article>;
        })}
      </div>
      {session?.email && <p className="admin-applications-session">מחובר/ת: {session.email}</p>}
    </main>

  </div>;
}
