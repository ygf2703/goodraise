export function AccountHomePanel() {
  return (<section id="account-home" className="account-home" hidden>
    <div className="account-home-heading">
      <div>
        <span className="brand-kicker">החשבון שלי</span>
        <h1>הפרויקטים שלי</h1>
        <p>הגישה לכל פרויקט נקבעת לפי התפקיד שהוגדר עבורך על ידי מנהלי האתר.</p>
      </div>
    </div>

    <section className="account-project-section" aria-labelledby="active-projects-title">
      <div className="public-panel-header">
        <h2 id="active-projects-title">פרויקטים פעילים</h2>
        <span id="active-projects-count" className="status-chip"></span>
      </div>
      <div id="active-projects-list" className="account-project-grid"></div>
      <p id="active-projects-empty" className="account-empty" hidden>אין כרגע פרויקטים פעילים המשויכים לחשבון.</p>
    </section>

    <section className="account-project-section" aria-labelledby="completed-projects-title">
      <div className="public-panel-header">
        <h2 id="completed-projects-title">פרויקטים שהסתיימו</h2>
        <span id="completed-projects-count" className="status-chip"></span>
      </div>
      <div id="completed-projects-list" className="account-project-grid"></div>
      <p id="completed-projects-empty" className="account-empty" hidden>אין פרויקטים שהסתיימו המשויכים לחשבון.</p>
    </section>

    <section id="site-access-management" className="site-access-management app-card app-card--elevated" hidden aria-labelledby="site-access-title">
      <div className="public-panel-header">
        <div>
          <span className="brand-kicker">Site administration</span>
          <h2 id="site-access-title">משתמשים והרשאות</h2>
          <p>רק מנהלי האתר יכולים לאשר חשבונות ולשייך תפקידים לארגונים ולפרויקטים.</p>
        </div>
        <div className="site-access-heading-actions">
          <a className="button-secondary action-button secondary" href="/admin/applications">בקשות לקמפיינים</a>
          <button id="new-account-button" className="button-secondary action-button secondary" type="button">אישור משתמש חדש</button>
        </div>
      </div>
      <div id="account-management-status" className="status-note text-small" aria-live="polite"></div>
      <div className="site-access-layout">
        <div>
          <h3>משתמשים קיימים</h3>
          <div id="managed-account-list" className="managed-account-list"></div>
        </div>
        <form id="managed-account-form" className="managed-account-form">
          <h3 id="managed-account-form-title">אישור משתמש חדש</h3>
          <label className="form-label">
            כתובת מייל מאושרת
            <input id="managed-account-email" className="form-control" type="email" autoComplete="off" required placeholder="name@example.org" dir="ltr" />
          </label>
          <div className="managed-account-flags">
            <label><input id="managed-account-active" type="checkbox" defaultChecked /> חשבון פעיל</label>
            <label><input id="managed-account-site-admin" type="checkbox" /> מנהל/ת אתר</label>
          </div>
          <div id="managed-memberships-shell">
            <div className="public-panel-header">
              <h3>שיוכים ותפקידים</h3>
              <button id="add-membership-button" className="button-ghost" type="button">הוספת שיוך</button>
            </div>
            <div id="managed-memberships" className="managed-memberships"></div>
            <p className="text-small text-muted">מנהל/ת ארגון מקבל/ת גישה לכל הפרויקטים בארגון. שאר התפקידים משויכים לפרויקט מסוים.</p>
          </div>
          <div className="login-actions">
            <button id="save-managed-account" className="button-primary action-button" type="submit">שמירת משתמש והרשאות</button>
            <button id="cancel-managed-account" className="button-ghost" type="button">ביטול</button>
          </div>
        </form>
      </div>
    </section>
  </section>);
}
