import { LoginPanel } from './LoginPanel';
import { InsightsPanel } from './InsightsPanel';
import { DesignPanel } from './DesignPanel';

export function AdminPage() {
  return (<section id="page-admin" className="page-shell">
        <LoginPanel />

        <div id="admin-content" className="admin-content" hidden>
          <div className="dashboard-shell">
            <section className="admin-tabs-shell app-card app-card--elevated">
              <div className="admin-tabs-head">
                <div className="admin-tabs-copy">
                  <h3>פאנל הניהול</h3>
                  <p>הפרדנו בין שכבת הניתוח והבקרה לבין שכבת עיצוב דף הפרויקט, כדי שהעבודה תהיה ממוקדת וברורה יותר.</p>
                </div>
                <div className="admin-tabbar" role="tablist" aria-label="לשוניות ניהול">
                  <button className="admin-tab-button is-active" type="button" role="tab" aria-selected="true" data-admin-tab-target="insights">בקרה ותובנות</button>
                  <button className="admin-tab-button" type="button" role="tab" aria-selected="false" data-admin-tab-target="design">עיצוב ומדיה</button>
                </div>
              </div>
            </section>

            <InsightsPanel />

            <DesignPanel />
          </div>
        </div>
      </section>);
}
