

export function Header() {
  return (<header className="app-topbar brand-header">
      <div className="topbar-actions">
        <nav className="top-nav" aria-label="ניווט עמודים">
          <button className="nav-button" type="button" data-page-target="project">דף הפרויקט</button>
          <button className="nav-button" type="button" data-page-target="prizes">פרסים ותחרות</button>
          <button className="nav-button" type="button" data-page-target="rules">תקנון השתתפות</button>
          <button className="nav-button" type="button" data-page-target="privacy">פרטיות</button>
          <button className="nav-button" type="button" data-page-target="admin">דשבורד ניהולי</button>
        </nav>
        <div className="session-box">
          <div id="session-status" className="session-chip" aria-live="polite">מצב ניהול: אורח/ת</div>
          <button id="go-admin-login" className="button-secondary action-button secondary" type="button" data-admin-login="" data-legacy-id="public-admin-login">כניסת מנהלים</button>
          <button id="logout-button" className="button-ghost" type="button" hidden>התנתקות</button>
        </div>
      </div>
      <div className="topbar-brand">
        <div className="brand-logo-cluster">
          <img id="topbar-campaign-logo" className="topbar-campaign-logo" alt="לוגו הקמפיין" />
          <span className="brand-divider" aria-hidden="true"></span>
          <img id="topbar-logo" className="topbar-logo" alt="לוגו הארגון" />
        </div>
        <div id="topbar-meta" className="topbar-meta" hidden>
          <div id="topbar-title" className="topbar-title">מערכת ניהול קמפיין</div>
        </div>
      </div>
    </header>);
}
