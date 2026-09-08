

export function PrizesPage() {
  return (<section id="page-prizes" className="page-shell">
        <article className="public-hero app-card--dark">
          <div className="public-hero-watermark" aria-hidden="true">
            <img id="public-org-logo" alt="לוגו הארגון" />
          </div>
          <div className="public-hero-grid">
            <div className="public-hero-copy">
              <span className="brand-kicker">תמונת מצב מיידית של הפרויקט</span>
              <h1 className="public-hero-title">מצב הקמפיין ברגע זה</h1>
              <p>כל מה שחשוב להבין בשנייה הראשונה: כמה גויס, מי מוביל, כמה שגרירים פעילים ומהו חלון הנתונים הפעיל כרגע.</p>
              <div id="public-hero-badges" className="public-badges" aria-live="polite"></div>
            </div>
          </div>
        </article>

        <section className="page-panel app-card app-card--elevated">
          <div className="public-panel-header">
            <h3>פודיום, מדרגות פרס ומצב אמת</h3>
            <div id="prize-summary" className="text-small text-muted"></div>
          </div>
          <div className="prize-page-layout">
            <div id="prize-board" className="prize-shell"></div>
            <aside className="prize-ambassador-sidebar" aria-label="דירוג שגרירים">
              <div className="prize-directory-head">
                <h4>דירוג שגרירים</h4>
                <div className="text-small text-muted">מוצגים שגרירים עם גיוס של ₪20 ומעלה.</div>
              </div>
              <label className="visually-hidden" htmlFor="prize-ambassador-search">חיפוש שגריר/ה לפי שם</label>
              <input id="prize-ambassador-search" className="prize-directory-search" type="search" placeholder="חיפוש לפי שם" autoComplete="off" />
              <div id="prize-ambassador-directory" className="prize-directory-list" aria-live="polite"></div>
            </aside>
          </div>
        </section>
      </section>);
}
