

export function DesignPanel() {
  return (<div id="admin-tab-panel-design" className="admin-tab-panel" role="tabpanel" aria-labelledby="admin-tab-design" tabIndex={0} hidden>
              <section className="dashboard-section">
                <div className="section-header">
                  <h3>עיצוב, טקסטים ומדיה של עמוד הפרויקט</h3>
                  <div className="text-small text-muted">כל מה שקשור לבאנר, מדיה, צבעים, פונטים, טקסטים וסכומי התרומה של עמוד הפרויקט הציבורי מרוכז כאן.</div>
                </div>
                <div id="campaign-designer-panel" className="app-card app-card--elevated"></div>
              </section>
            </div>);
}
