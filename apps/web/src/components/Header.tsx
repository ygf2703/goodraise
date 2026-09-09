import { useEffect, useRef } from "react";
import { mountSiteHeader } from "../../../../work/assets/site-header.js";

// Also rendered into the static homepage by prepareAssets.
export function Header() {
  const header = useRef<HTMLElement>(null);
  useEffect(() => {
    if (header.current) return mountSiteHeader(header.current, { loadSession: false });
  }, []);

  return (<header id="site-header" className="site-header" ref={header} dir="rtl">
    <div className="site-header-inner">
      <a className="site-header-brand" href="/" aria-label="גודרייז — דף הבית">
        <img src="/assets/goodraise-logo-transparent.png" width="980" height="330" alt="גודרייז" />
      </a>
      <nav id="main-nav" className="site-header-nav" aria-label="ניווט ראשי">
        <a data-site-audience="public" href="/#how-it-works">איך זה עובד</a>
        <a data-site-audience="public" href="/#about">קצת עלינו</a>
        <a data-site-audience="public" href="/#footer">בואו נדבר</a>
        <a data-site-audience="manager" data-page-target="admin" href="/admin" hidden>דשבורד ניהולי</a>
        <a data-site-audience="manager" data-page-target="project" href="/project" hidden>דף הפרויקט</a>
        <a data-site-audience="manager" data-page-target="prizes" href="/prizes" hidden>פרסים ותחרות</a>
        <a data-site-audience="guest" className="site-header-mobile-login" href="/admin">כניסה למערכת</a>
      </nav>
      <div className="site-header-actions">
        <a data-site-audience="guest" className="site-header-login" href="/admin">כניסה</a>
        <a data-site-audience="guest" className="site-header-cta" href="/admin">מתחילים לגייס <span aria-hidden="true">←</span></a>
        <button data-site-audience="session" className="site-header-logout" type="button" hidden>התנתקות</button>
        <span className="site-header-error" role="status" hidden></span>
      </div>
      <button className="site-header-toggle" type="button" aria-label="פתיחת תפריט" aria-controls="main-nav" aria-expanded="false">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
      </button>
    </div>
  </header>);
}
