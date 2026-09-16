import { useEffect, useRef } from "react";
import { mountSiteHeader } from "../../../../work/assets/site-header.js";
import { Button, ButtonLink } from "./Button";

// Also rendered into the static homepage by prepareAssets.
export function Header({ loadSession = false }: { loadSession?: boolean } = {}) {
  const header = useRef<HTMLElement>(null);
  useEffect(() => {
    if (header.current) return mountSiteHeader(header.current, { loadSession });
  }, [loadSession]);

  return (<header id="site-header" className="site-header" ref={header} dir="rtl">
    <div className="site-header-inner">
      <Button className="site-header-toggle" variant="secondary" size="sm" icon aria-label="פתיחת תפריט" aria-controls="main-nav" aria-expanded="false">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
      </Button>
      <a className="site-header-brand" href="/" aria-label="גודרייז — דף הבית">
        <img src="/assets/goodraise-logo-transparent.png" width="980" height="330" alt="גודרייז" />
      </a>
      <nav id="main-nav" className="site-header-nav" aria-label="ניווט ראשי">
        <a data-site-audience="public" href="/#how-it-works">איך זה עובד</a>
        <a data-site-audience="public" data-site-page="campaigns" href="/campaigns">קמפיינים שהסתיימו</a>
        <a data-site-audience="public" href="/#about">קצת עלינו</a>
        <a data-site-audience="public" data-site-page="contact" href="/contact">בואו נדבר</a>
        <a data-site-audience="session" data-site-page="projects" href="/admin" hidden>הפרויקטים שלי</a>
        <a data-site-audience="site-admin" data-site-page="applications" href="/admin/applications" hidden>בקשות לקמפיינים</a>
        <a data-site-audience="site-admin" data-site-page="users" href="/admin/users" hidden>משתמשים והרשאות</a>
        <a data-site-audience="guest" data-site-page="login" className="site-header-mobile-login" href="/login" hidden>כניסה למערכת</a>
      </nav>
      <div className="site-header-actions">
        <a data-site-audience="guest" data-site-page="login" className="site-header-login" href="/login" hidden>כניסה</a>
        <ButtonLink data-site-audience="guest" data-site-page="start" className="site-header-cta" size="sm" href="/start" hidden>מתחילים לגייס <span aria-hidden="true">←</span></ButtonLink>
        <Button data-site-audience="session" className="site-header-logout" variant="secondary" size="sm" hidden>התנתקות</Button>
        <span className="site-header-error" role="status" hidden></span>
      </div>
    </div>
  </header>);
}
