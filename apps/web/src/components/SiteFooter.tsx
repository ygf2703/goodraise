import { useRef, useState } from "react";

const placeholderContent = {
  partners: ["שותפים לדרך", "כאן יוצגו הארגונים, הקהילות והשותפים שעושים איתנו טוב. התוכן יתווסף בהמשך."],
  contact: ["יצירת קשר", "כאן יופיעו פרטי יצירת הקשר שלנו: כתובת דואר אלקטרוני, מספר טלפון ודרכים נוספות לדבר איתנו. הפרטים יתווספו בהמשך."],
  faq: ["שאלות נפוצות", "כאן יופיעו תשובות לשאלות על פתיחת קמפיין, שיתוף עם הקהילה וניהול הגיוס. התוכן יתווסף בהמשך."],
} as const;

type Placeholder = keyof typeof placeholderContent;

// Also rendered into the static homepage by prepareAssets.
export function SiteFooter() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [placeholder, setPlaceholder] = useState<Placeholder>("contact");
  const [title, description] = placeholderContent[placeholder];

  const openPlaceholder = (next: Placeholder) => {
    setPlaceholder(next);
    dialog.current?.showModal();
  };

  return <footer id="footer" className="footer">
    <div className="container">
      <div className="footer-main">
        <div className="footer-brand">
          <a href="/" aria-label="גודרייז — דף הבית"><img src="/assets/goodraise-logo-transparent.png" width="980" height="330" alt="גודרייז" /></a>
          <p>מחברים אנשים למטרות טובות.<br />יחד, עושים יותר טוב.</p>
        </div>
        <nav aria-label="על גודרייז">
          <h2 className="footer-heading">נעים להכיר</h2>
          <div className="footer-links">
            <a href="/#about">קצת עלינו</a>
            <a href="/#how-it-works">איך זה עובד</a>
            <button type="button" data-placeholder="partners" onClick={() => openPlaceholder("partners")}>שותפים לדרך</button>
          </div>
        </nav>
        <nav aria-label="מידע ועזרה">
          <h2 className="footer-heading">כאן בשבילכם</h2>
          <div className="footer-links">
            <button type="button" data-placeholder="contact" onClick={() => openPlaceholder("contact")}>יצירת קשר</button>
            <button type="button" data-placeholder="faq" onClick={() => openPlaceholder("faq")}>שאלות נפוצות</button>
            <a href="/login">כניסה למערכת</a>
          </div>
        </nav>
        <nav aria-label="מידע משפטי ונגישות">
          <h2 className="footer-heading">חשוב לדעת</h2>
          <div className="footer-links">
            <a href="/rules">תנאי שימוש</a>
            <a href="/privacy">מדיניות פרטיות</a>
            <a href="/accessibility">הצהרת נגישות</a>
          </div>
        </nav>
      </div>
      <div className="footer-bottom">
        <span>© גודרייז. כל הזכויות שמורות.</span>
        <a className="back-top" href="#top">בחזרה למעלה <span aria-hidden="true">↑</span></a>
      </div>
    </div>
    <dialog ref={dialog} id="placeholder-dialog" aria-labelledby="dialog-title" aria-describedby="dialog-description" onClose={() => setPlaceholder("contact")}>
      <button className="dialog-close" type="button" aria-label="סגירה" onClick={() => dialog.current?.close()} autoFocus>×</button>
      <h2 id="dialog-title">{title}</h2>
      <p id="dialog-description">{description}</p>
      <form method="dialog"><button className="button button-primary">סגירה</button></form>
    </dialog>
  </footer>;
}
