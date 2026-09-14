import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { CONTACT_LIMITS, CONTACT_TOPICS } from "../../../../shared/contact.mjs";
import { requestJson } from "../api";
import type { PublicHelpRoute } from "../platform";
import { Header } from "./Header";
import { SiteFooter } from "./SiteFooter";
import { SkipLink } from "./SkipLink";
import { Button, ButtonLink } from "./Button";

const faqGroups: { title: string; items: { question: string; answer: ReactNode }[] }[] = [
  { title: "מתחילים לעשות טוב", items: [
    { question: "מה אפשר לעשות עם גודרייז?", answer: <>גודרייז עוזרת לארגונים ולקהילות לנהל קמפיינים לגיוס תרומות, לרכז נתוני גיוס ולעבוד יחד עם צוותים ושגרירים. אפשר גם להכיר מטרות וסיפורים דרך <a href="/campaigns">קמפיינים שהסתיימו</a>.</> },
    { question: "מי יכול להגיש בקשה לפתיחת קמפיין?", answer: <>כל אחד ואחת יכולים למלא את <a href="/start">טופס הבקשה לפתיחת קמפיין</a>, גם בלי חשבון קיים. נבקש פרטי קשר, מידע על הארגון או היוזמה, תיאור המטרה ויעד גיוס. שליחת הבקשה אינה פותחת קמפיין באופן אוטומטי.</> },
    { question: "מה קורה אחרי ששולחים בקשה?", answer: <>תחילה נשלח אימייל לאימות הכתובת שלכם. לאחר האימות, הבקשה תועבר לבדיקה של מנהלי גודרייז. אם תאושר, ייפתח קמפיין במצב טיוטה ותישלח אליכם הודעה עם קישור לכניסה. אישור הבקשה אינו מפרסם את הקמפיין או מתחיל גבייה.</> },
    { question: "האם כבר אפשר לגבות תשלומים דרך גודרייז?", answer: <>חיבור לספק סליקה לגביית תשלומים נמצא בתכנון ואינו זמין כרגע כתהליך תשלום באתר. טופס הבקשה אינו אוסף פרטי כרטיס אשראי או סיסמאות לספקי תשלום. לבירור אופן הגיוס של קמפיין מסוים, יש לפנות לצוות הקמפיין.</> },
  ] },
  { title: "כניסה ועבודה עם הצוות", items: [
    { question: "איך מקבלים חשבון ונכנסים למערכת?", answer: <>הכניסה מיועדת למשתמשים שאושרו מראש וקיבלו הרשאות. אין הרשמה חופשית למערכת הניהול. לאחר האישור, נכנסים דרך <a href="/login">עמוד הכניסה</a> עם כתובת האימייל שאושרה; אם טרם הוגדרה סיסמה, ממשיכים להגדרתה בתהליך הכניסה.</> },
    { question: "לא מצליחים להיכנס או לראות קמפיין. מה עושים?", answer: <>בדקו שנכנסתם עם כתובת האימייל שאושרה ושקיבלתם הרשאה לארגון או לקמפיין המבוקש. עצם קיומו של חשבון אינו מעניק גישה לכל הפרויקטים. אם הבעיה נמשכת, <a href="/contact">כתבו לנו</a> וציינו את שם הקמפיין והודעת השגיאה — בלי לשלוח סיסמה.</> },
    { question: "אפשר לעבוד על כמה פרויקטים עם אותו חשבון?", answer: <>כן. חשבון אחד יכול להיות משויך לכמה ארגונים או קמפיינים, עם תפקיד שונה בכל אחד. כשיש כמה פרויקטים זמינים, בוחרים ביניהם בעמוד הפרויקטים שלי. פרויקטים פעילים ופרויקטים שהסתיימו מופיעים בנפרד, והפעולות הזמינות תלויות בהרשאות שהוקצו לכם.</> },
  ] },
  { title: "קמפיינים, נתונים ועזרה", items: [
    { question: "מה אפשר לראות בקמפיינים שהסתיימו?", answer: <>העמודים הציבוריים של קמפיינים שהסתיימו פתוחים לצפייה ללא התחברות. הם מציגים סיכום: שם הקמפיין, התיאור, סכום הגיוס, מספר התומכים ותמונות או מדיה, ככל שהמידע זמין. אלו עמודי צפייה בלבד, ללא פעולות ניהול וללא טבלאות תחרות מפורטות.</> },
    { question: "מה פירוש מספר התומכים בקמפיין?", answer: <>תומכים הם תורמים ייחודיים לפי נתוני הקמפיין, ולא מספר התרומות. לכן כמה תרומות של אותו תורם אינן בהכרח כמה תומכים נפרדים.</> },
    { question: "איך מדווחים על בעיה או על קושי בנגישות?", answer: <>אפשר להשתמש ב<a href="/contact">טופס יצירת הקשר</a> ולבחור את נושא הפנייה. כדי שנוכל להבין מה קרה, כדאי לציין את כתובת העמוד, סוג המכשיר והפעולה שניסיתם לבצע. אין לצרף מידע רפואי, פרטי תשלום או סיסמאות. מידע נוסף מופיע ב<a href="/accessibility">הצהרת הנגישות</a>.</> },
  ] },
];

function FaqContent() {
  return <>
    <div className="help-intro">
      <span className="help-eyebrow">טוב ששאלתם</span>
      <h1>שאלות נפוצות</h1>
      <p>מהצעד הראשון ועד ניהול הקמפיין — כמה תשובות שיעזרו לכם בדרך.</p>
    </div>
    <div className="help-faq">
      {faqGroups.map((group) => <section className="help-faq-group" key={group.title} aria-label={group.title}>
        <h2>{group.title}</h2>
        {group.items.map((item) => <details key={item.question}>
          <summary>{item.question}</summary>
          <p>{item.answer}</p>
        </details>)}
      </section>)}
      <section className="help-callout" aria-labelledby="more-help-title">
        <div><h2 id="more-help-title">השאלה שלכם לא כאן?</h2><p>נשמח לשמוע ולעזור לכם להתקדם.</p></div>
        <ButtonLink href="/contact" size="lg">בואו נדבר <span aria-hidden="true">←</span></ButtonLink>
      </section>
    </div>
  </>;
}

function ContactForm() {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<{ development: boolean } | null>(null);
  const successHeading = useRef<HTMLHeadingElement>(null);
  const pending = useRef<AbortController | null>(null);
  const submission = useRef({ fingerprint: "", id: "" });
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => { if (success) successHeading.current?.focus(); }, [success]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending.current) return;
    const data = new FormData(event.currentTarget);
    const fields = {
      name: String(data.get("name") || "").trim(),
      email: String(data.get("email") || "").trim(),
      topic: String(data.get("topic") || ""),
      message: String(data.get("message") || "").trim(),
      website: String(data.get("website") || ""),
      consentAccepted: data.get("consentAccepted") === "on",
    };
    const abort = new AbortController();
    pending.current = abort;
    setSending(true);
    setError("");
    try {
      const fingerprint = JSON.stringify(fields);
      if (submission.current.fingerprint !== fingerprint) submission.current = { fingerprint, id: crypto.randomUUID() };
      const { response, payload } = await requestJson<{ sent?: boolean; development?: boolean; message?: string }>("/api/contact", {
        method: "POST", body: { ...fields, requestId: submission.current.id },
      }, abort.signal);
      if (!response.ok || payload.sent !== true) throw new Error(payload.message || "לא ניתן לאשר שהפנייה נשלחה. נסו שוב מאוחר יותר.");
      setSuccess({ development: payload.development === true });
    } catch (failure) {
      if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : "שליחת הפנייה נכשלה. נסו שוב מאוחר יותר.");
    } finally {
      if (!abort.signal.aborted) { pending.current = null; setSending(false); }
    }
  };

  if (success) return <section className="help-card help-success" role="status" aria-labelledby="contact-success-title">
    <span className="help-success-mark" aria-hidden="true">✓</span>
    <h2 id="contact-success-title" ref={successHeading} tabIndex={-1}>{success.development ? "הפנייה נשמרה בסביבת הפיתוח" : "תודה שכתבתם לנו"}</h2>
    <p>{success.development ? "זהו מצב בדיקה: ההודעה נשמרה בתיבת הפיתוח המקומית ולא נשלחה באימייל." : "הפנייה הועברה לשירות הדוא״ל למשלוח לצוות גודרייז. נוכל לחזור אליכם לכתובת האימייל שמסרתם."}</p>
    <a href="/faq">בחזרה לשאלות הנפוצות</a>
  </section>;

  return <form className="help-card help-form" onSubmit={submit} aria-labelledby="contact-form-title" aria-busy={sending}>
    <h2 id="contact-form-title">על מה תרצו לדבר?</h2>
    <p className="help-form-note">כל השדות בטופס נדרשים.</p>
    <fieldset disabled={sending}>
      <legend className="help-sr-only">פרטי הפנייה</legend>
      <div className="help-form-row">
        <label htmlFor="contact-name">שם מלא<input id="contact-name" name="name" autoComplete="name" minLength={2} maxLength={CONTACT_LIMITS.name} required /></label>
        <label htmlFor="contact-email">כתובת אימייל<input id="contact-email" name="email" type="email" dir="ltr" autoComplete="email" maxLength={CONTACT_LIMITS.email} required /></label>
      </div>
      <label htmlFor="contact-topic">נושא הפנייה<select id="contact-topic" name="topic" defaultValue="" required>
        <option value="" disabled>בחרו נושא</option>
        {CONTACT_TOPICS.map((topic) => <option key={topic.value} value={topic.value}>{topic.label}</option>)}
      </select></label>
      <label htmlFor="contact-message">איך נוכל לעזור?<textarea id="contact-message" name="message" rows={6} minLength={10} maxLength={CONTACT_LIMITS.message} aria-describedby="contact-message-hint" required /></label>
      <p id="contact-message-hint" className="help-form-note">10–4,000 תווים. אין לשלוח סיסמאות, פרטי כרטיס אשראי או מידע רגיש.</p>
      <div className="help-honeypot" aria-hidden="true"><label htmlFor="contact-website">Website<input id="contact-website" name="website" tabIndex={-1} autoComplete="off" /></label></div>
      <label className="help-consent" htmlFor="contact-consent"><input id="contact-consent" name="consentAccepted" type="checkbox" required /><span>אני מסכימ/ה לשימוש בפרטים שמסרתי לצורך טיפול בפנייה וחזרה אליי, בהתאם ל<a href="/privacy">מדיניות הפרטיות</a>.</span></label>
      {error && <p className="help-error" role="alert">{error}</p>}
      <Button type="submit" size="lg" busy={sending}>{sending ? "שולחים את הפנייה…" : "שליחת הפנייה"}<span aria-hidden="true">←</span></Button>
    </fieldset>
  </form>;
}

function ContactContent() {
  return <>
    <div className="help-intro">
      <span className="help-eyebrow">כאן בשבילכם</span>
      <h1>בואו נדבר</h1>
      <p>יש שאלה, רעיון או משהו שלא מסתדר? כתבו לנו.</p>
    </div>
    <div className="help-contact-grid">
      <aside className="help-contact-aside" aria-label="לפני ששולחים">
        <h2>כל מטרה טובה<br />מתחילה בשיחה.</h2>
        <p>הפנייה תישלח באימייל לצוות גודרייז. לא צריך חשבון כדי ליצור קשר.</p>
        <div className="help-aside-link"><h3>רוצים לפתוח קמפיין?</h3><p>כדי שנקבל את כל הפרטים במקום אחד, התחילו בטופס הבקשה.</p><a href="/start">לבקשה לפתיחת קמפיין <span aria-hidden="true">←</span></a></div>
        <div className="help-aside-link"><h3>אולי התשובה כבר כאן</h3><a href="/faq">לשאלות הנפוצות <span aria-hidden="true">←</span></a></div>
      </aside>
      <ContactForm />
    </div>
  </>;
}

export function PublicHelpPage({ route }: { route: PublicHelpRoute }) {
  return <div id="goodraise-help-root" dir="rtl">
    <div id="top" /><SkipLink /><Header />
    <main id="main" className="help-main" tabIndex={-1}>
      {route === "faq" ? <FaqContent /> : <ContactContent />}
    </main>
    <SiteFooter />
  </div>;
}
