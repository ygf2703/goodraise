// Also rendered into the static homepage by prepareAssets.
export function SiteFooter() {
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
          </div>
        </nav>
        <nav aria-label="מידע ועזרה">
          <h2 className="footer-heading">כאן בשבילכם</h2>
          <div className="footer-links">
            <a href="/contact">יצירת קשר</a>
            <a href="/faq">שאלות נפוצות</a>
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
  </footer>;
}
