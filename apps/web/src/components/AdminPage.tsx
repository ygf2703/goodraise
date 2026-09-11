import { LoginPanel } from './LoginPanel';
import { InsightsPanel } from './InsightsPanel';
import { DesignPanel } from './DesignPanel';
import { AccountHomePanel } from './AccountHomePanel';

export function AdminPage() {
  return (<section id="page-admin" className="page-shell is-active">
        <div className="admin-session-bar">
          <span id="session-status" aria-live="polite">מצב ניהול: אורח/ת</span>
          <button id="logout-button" className="button-ghost" type="button" hidden>התנתקות</button>
        </div>
        <LoginPanel />
        <AccountHomePanel />

        <div id="admin-content" className="admin-content" hidden>
          <div className="dashboard-shell">
            <section className="admin-tabs-shell app-card app-card--elevated">
              <div className="admin-tabs-head">
                <div className="admin-tabs-copy">
                  <h3>פאנל הניהול</h3>
                  <p>הפרדנו בין שכבת הניתוח והבקרה לבין שכבת עיצוב דף הפרויקט, כדי שהעבודה תהיה ממוקדת וברורה יותר.</p>
                </div>
                <div className="admin-tabbar" role="tablist" aria-label="לשוניות ניהול">
                  <button id="admin-tab-insights" className="admin-tab-button is-active" type="button" role="tab" aria-selected="true" aria-controls="admin-tab-panel-insights" tabIndex={0} data-admin-tab-target="insights">בקרה ותובנות</button>
                  <button id="admin-tab-design" className="admin-tab-button" type="button" role="tab" aria-selected="false" aria-controls="admin-tab-panel-design" tabIndex={-1} data-admin-tab-target="design">עיצוב ומדיה</button>
                </div>
              </div>
            </section>

            <InsightsPanel />

            <DesignPanel />
          </div>
        </div>
      </section>);
}
