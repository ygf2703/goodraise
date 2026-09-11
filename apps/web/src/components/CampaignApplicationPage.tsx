import { FormEvent, useMemo, useState } from "react";

import { requestJson } from "../api";
import { Header } from "./Header";
import { SiteFooter } from "./SiteFooter";
import { SkipLink } from "./SkipLink";

interface SubmissionResponse {
  submitted?: boolean;
  referenceCode?: string;
  developmentVerificationUrl?: string;
  message?: string;
}

const categories = [
  "בריאות והצלת חיים",
  "קהילה ועזרה הדדית",
  "חינוך וילדים",
  "סיוע בחירום",
  "תרבות ויצירה",
  "סביבה",
  "בעלי חיים",
  "אחר",
];

export function CampaignApplicationPage() {
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [referenceCode, setReferenceCode] = useState("");
  const [verificationUrl, setVerificationUrl] = useState("");
  const [providerStatus, setProviderStatus] = useState("not_sure");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status === "submitting") return;
    setStatus("submitting");
    setMessage("שומרים את הבקשה ושולחים מייל לאימות…");
    const form = new FormData(event.currentTarget);
    try {
      const { response, payload } = await requestJson<SubmissionResponse>("/api/applications", {
        method: "POST",
        body: {
          applicantName: form.get("applicantName"),
          applicantEmail: form.get("applicantEmail"),
          applicantPhone: form.get("applicantPhone"),
          organizationName: form.get("organizationName"),
          organizationType: form.get("organizationType"),
          organizationRegistrationNumber: form.get("organizationRegistrationNumber"),
          campaignName: form.get("campaignName"),
          category: form.get("category"),
          purpose: form.get("purpose"),
          story: form.get("story"),
          targetAmount: form.get("targetAmount"),
          publicLink: form.get("publicLink"),
          externalProviderStatus: form.get("externalProviderStatus"),
          externalProviderUrl: form.get("externalProviderUrl"),
          consentAccepted: form.get("consentAccepted") === "on",
          companyWebsite: form.get("companyWebsite"),
        },
      });
      setMessage(payload.message || (response.ok ? "הבקשה נשמרה." : "שמירת הבקשה נכשלה."));
      setReferenceCode(payload.referenceCode || "");
      setVerificationUrl(payload.developmentVerificationUrl || "");
      setStatus(response.ok ? "success" : "error");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "לא הצלחנו לשלוח את הבקשה. אפשר לנסות שוב.");
      setStatus("error");
    }
  };

  return <div id="goodraise-application-root" dir="rtl">
    <SkipLink />
    <Header />
    <main id="main" className="application-page-main" tabIndex={-1}>
      <section className="application-intro">
        <span>מתחילים בפשטות</span>
        <h1>ספרו לנו על הקמפיין שתרצו לפתוח</h1>
        <p>טופס אחד קצר, בלי הרשמה ובלי פרטים טכניים. לאחר אימות המייל הבקשה תעבור ישירות לצוות GoodRaise.</p>
        <div className="application-steps" aria-label="שלבי התהליך">
          <strong>1. שולחים בקשה</strong>
          <strong>2. מאמתים מייל</strong>
          <strong>3. הצוות בודק</strong>
          <strong>4. פותחים טיוטת קמפיין</strong>
        </div>
      </section>

      {status === "success" ? <section className="application-success" role="status">
        <div className="application-success-mark" aria-hidden="true">✓</div>
        <h2>הבקשה התקבלה</h2>
        <p>{message}</p>
        {referenceCode && <p><strong>מספר הבקשה: <span dir="ltr">{referenceCode}</span></strong></p>}
        {verificationUrl && <p className="development-verification">
          סביבת פיתוח: <a href={verificationUrl}>פתיחת קישור האימות</a>
        </p>}
        <a className="application-secondary-link" href="/">חזרה לדף הבית</a>
      </section> : <form className="application-form" onSubmit={submit} noValidate={false}>
        <fieldset>
          <legend><span>1</span> מי מגיש/ה את הבקשה?</legend>
          <div className="application-fields application-fields--three">
            <label>שם מלא
              <input name="applicantName" autoComplete="name" minLength={2} maxLength={100} required />
            </label>
            <label>כתובת מייל
              <input name="applicantEmail" type="email" autoComplete="email" dir="ltr" required />
            </label>
            <label>טלפון
              <input name="applicantPhone" type="tel" autoComplete="tel" dir="ltr" required />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend><span>2</span> על ההתארגנות</legend>
          <div className="application-fields application-fields--three">
            <label>שם העמותה, העסק או היוזמה
              <input name="organizationName" minLength={2} maxLength={160} required />
            </label>
            <label>סוג ההתארגנות
              <select name="organizationType" defaultValue="" required>
                <option value="" disabled>בחירה</option>
                <option value="private">יוזמה פרטית</option>
                <option value="community">יוזמה קהילתית</option>
                <option value="nonprofit">עמותה או מלכ״ר</option>
                <option value="business">עסק או חברה</option>
                <option value="other">אחר</option>
              </select>
            </label>
            <label>מספר רישום <small>אם קיים</small>
              <input name="organizationRegistrationNumber" maxLength={80} dir="ltr" />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend><span>3</span> על הקמפיין</legend>
          <div className="application-fields application-fields--two">
            <label>שם הקמפיין
              <input name="campaignName" minLength={2} maxLength={120} required />
            </label>
            <label>קטגוריה
              <select name="category" defaultValue="" required>
                <option value="" disabled>בחירה</option>
                {categories.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </label>
            <label className="application-field-wide">מה מטרת הקמפיין? <small>משפט אחד ברור</small>
              <input name="purpose" minLength={10} maxLength={240} required placeholder="לדוגמה: גיוס ציוד לימודי לילדי השכונה" />
            </label>
            <label className="application-field-wide">הסיפור בקצרה <small>לא חובה; אפשר להשלים לאחר האישור</small>
              <textarea name="story" maxLength={5000} rows={5} />
            </label>
            <label>יעד הגיוס בש״ח
              <input name="targetAmount" type="number" min="1" max="1000000000" step="1" inputMode="numeric" dir="ltr" required />
            </label>
            <label>אתר או עמוד שמספר על הפעילות <small>לא חובה</small>
              <input name="publicLink" type="url" placeholder="https://" dir="ltr" />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend><span>4</span> חיבור לתרומות</legend>
          <div className="application-fields application-fields--two">
            <label>האם כבר קיים עמוד אצל ספק תרומות חיצוני?
              <select name="externalProviderStatus" value={providerStatus} onChange={(event) => setProviderStatus(event.target.value)} required>
                <option value="not_sure">עדיין לא בטוחים</option>
                <option value="existing">כן, כבר קיים עמוד</option>
                <option value="needs_setup">לא, נצטרך להקים חיבור</option>
              </select>
            </label>
            {providerStatus === "existing" && <label>קישור לעמוד התרומות
              <input name="externalProviderUrl" type="url" placeholder="https://" dir="ltr" required />
            </label>}
          </div>
          <p className="application-field-help">אין להזין כאן סיסמאות, מפתחות API או פרטי סליקה. נחבר את הספק בצורה מאובטחת רק לאחר אישור הבקשה.</p>
        </fieldset>

        <label className="application-honeypot" aria-hidden="true">Company website
          <input name="companyWebsite" tabIndex={-1} autoComplete="off" />
        </label>
        <label className="application-consent">
          <input name="consentAccepted" type="checkbox" required />
          <span>אני מאשר/ת שהפרטים נכונים ושצוות GoodRaise יוכל ליצור איתי קשר בנוגע לבקשה. קראתי את <a href="/privacy" target="_blank">מדיניות הפרטיות</a>.</span>
        </label>
        <div className={`application-form-message${status === "error" ? " is-error" : ""}`} role="status">{message}</div>
        <button className="application-submit" type="submit" disabled={status === "submitting"}>
          {status === "submitting" ? "שולחים…" : "שליחת הבקשה לאישור"}
        </button>
        <p className="application-submit-note">לא ייפתח חשבון ולא ייווצר קמפיין לפני אישור של מנהל/ת האתר.</p>
      </form>}
    </main>
    <SiteFooter />
  </div>;
}

export function CampaignApplicationVerificationPage() {
  const token = useMemo(() => new URLSearchParams(window.location.search).get("token") || "", []);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState(token ? "" : "קישור האימות חסר או אינו תקין.");
  const [referenceCode, setReferenceCode] = useState("");

  const verify = async () => {
    if (!token || status === "loading") return;
    setStatus("loading");
    setMessage("מאמתים את כתובת המייל…");
    try {
      const { response, payload } = await requestJson<{ verified?: boolean; message?: string; referenceCode?: string }>("/api/applications/verify", {
        method: "POST",
        body: { token },
      });
      setStatus(response.ok ? "success" : "error");
      setMessage(payload.message || (response.ok ? "המייל אומת." : "האימות נכשל."));
      setReferenceCode(payload.referenceCode || "");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "האימות נכשל. אפשר לנסות שוב.");
    }
  };

  return <div id="goodraise-application-root" dir="rtl">
    <SkipLink />
    <Header />
    <main id="main" className="application-verification-page" tabIndex={-1}>
      <section className="application-success">
        <div className="application-success-mark" aria-hidden="true">{status === "success" ? "✓" : "✉"}</div>
        <h1>{status === "success" ? "המייל אומת" : "אימות כתובת המייל"}</h1>
        <p>{message || "לחצו על הכפתור כדי להעביר את הבקשה לבדיקת צוות GoodRaise."}</p>
        {referenceCode && <p><strong>מספר בקשה: <span dir="ltr">{referenceCode}</span></strong></p>}
        {status !== "success" && <button className="application-submit" type="button" onClick={verify} disabled={!token || status === "loading"}>
          {status === "loading" ? "מאמתים…" : "אימות ושליחת הבקשה לבדיקה"}
        </button>}
        {status === "success" && <a className="application-secondary-link" href="/">חזרה לדף הבית</a>}
      </section>
    </main>
    <SiteFooter />
  </div>;
}
