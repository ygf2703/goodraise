

export function InsightsPanel() {
  return (<div id="admin-tab-panel-insights" className="admin-tab-panel">
              <section className="admin-overview-grid">
                <article className="brand-command app-card app-card--dark">
                  <div className="brand-command-head">
                    <div className="brand-copy">
                      <span className="brand-kicker">Executive campaign operations</span>
                      <h1 className="hero-title">מרכז השליטה של הקמפיין</h1>
                      <p className="hero-subtitle">מסך ניהולי מרוכז לפילוח לפי תאריך, שעה, טווח שעות, יום פרויקט, שגריר/ה, תורם/ת וסכום, כולל השוואת קבצים, יעדים, גרפים, טבלאות וייצוא.</p>
                    </div>
                    <div className="brand-command-logos">
                      <div className="logo-wrap logo-wrap--campaign">
                        <img id="brand-logo" alt="לוגו הקמפיין" />
                      </div>
                      <div className="logo-wrap logo-wrap--organization">
                        <img id="brand-org-logo" alt="לוגו הארגון" />
                      </div>
                    </div>
                  </div>
                  <div className="hero-meta-grid" aria-label="נתוני כותרת">
                    <div className="hero-meta">
                      <span>טווח נתונים פעיל</span>
                      <strong id="admin-window-label">-</strong>
                    </div>
                    <div className="hero-meta">
                      <span>עדכון נתונים אחרון</span>
                      <strong id="admin-last-updated">-</strong>
                    </div>
                    <div className="hero-meta">
                      <span>קובץ מקור</span>
                      <strong id="admin-source-file">-</strong>
                    </div>
                    <div className="hero-meta">
                      <span>רשומות פעילות</span>
                      <strong id="admin-record-count">-</strong>
                    </div>
                  </div>
                  <div id="hero-badges" className="hero-badges" aria-live="polite"></div>
                </article>

                <section className="insight-assistant-panel app-card app-card--elevated" aria-labelledby="insight-assistant-title">
                  <div className="section-header">
                    <div>
                      <h3 id="insight-assistant-title">שאל את הנתונים</h3>
                      <p className="text-small text-muted">שאלו שאלה חופשית על הקמפיין הפעיל וקבלו תשובה המבוססת על הנתונים המעודכנים בלבד.</p>
                    </div>
                    <div id="insight-assistant-scope" className="status-chip">ממתין לנתוני הקמפיין</div>
                  </div>
                  <form id="insight-assistant-form" className="insight-assistant-form" noValidate>
                    <label className="form-field" htmlFor="insight-assistant-question">
                      <span>השאלה שלך</span>
                      <textarea id="insight-assistant-question" className="form-control insight-assistant-question" rows={3} maxLength={500} required placeholder="לדוגמה: מי הם שלושת השגרירים המובילים ומה הפער ביניהם?"></textarea>
                    </label>
                    <div className="control-actions control-actions--inline">
                      <button id="insight-assistant-submit" className="button-primary action-button" type="submit">קבלת תשובה</button>
                    </div>
                  </form>
                  <div id="insight-assistant-status" className="status-note text-small" aria-live="polite"></div>
                  <article id="insight-assistant-answer" className="insight-assistant-answer" aria-live="polite">
                    <h4>תשובה</h4>
                    <p id="insight-assistant-answer-text">התשובה תופיע כאן לאחר שליחת השאלה.</p>
                  </article>
                </section>

                <aside className="control-panel app-card app-card--elevated">
                  <div className="section-header">
                    <div>
                      <h3>Control Center</h3>
                      <div className="text-small text-muted">מרכז שליטה לקבצים, למסננים וליעדים. כל היכולות הקיימות נשמרות, רק מוצגות בצורה מדויקת ונוחה יותר.</div>
                    </div>
                  </div>
                  <div className="control-actions control-actions--inline">
                    <button id="add-manual-contribution" className="button-secondary action-button secondary" type="button">הוספת הכפלה ידנית</button>
                  </div>
                  <div className="control-groups">
                    <section className="control-group">
                      <div className="control-group-header">
                        <h4>תאריכי הפרויקט לניתוח</h4>
                        <p>הגדרה זו קובעת את ימי הפרויקט, טווח ברירת המחדל והפילוחים. היא אינה מסננת את הנתונים בלבד.</p>
                      </div>
                      <div className="filters-grid">
                        <label className="form-label">
                          תחילת הפרויקט
                          <input id="analysis-project-start" className="form-control" type="date" />
                        </label>
                        <label className="form-label">
                          סיום הפרויקט
                          <input id="analysis-project-end" className="form-control" type="date" />
                        </label>
                      </div>
                      <div className="control-actions control-actions--inline">
                        <button id="save-analysis-project-dates" className="button-secondary action-button secondary" type="button">שמירת תאריכי הפרויקט</button>
                      </div>
                      <div id="analysis-project-dates-status" className="status-note text-small" aria-live="polite"></div>
                    </section>

                    <section className="control-group">
                      <div className="control-group-header">
                        <h4>נתונים</h4>
                        <p>קבצי הבסיס, ההשוואה והפרסים</p>
                      </div>
                      <div className="filters-grid filters-grid--three">
                        <label className="form-label">
                          קובץ עסקאות
                          <input id="csv-upload" className="form-control" type="file" accept=".csv,text/csv" />
                        </label>
                        <label className="form-label">
                          קובץ השוואה
                          <input id="compare-upload" className="form-control" type="file" accept=".csv,text/csv" />
                        </label>
                        <label className="form-label">
                          החלפת טבלת פרסים (אופציונלי)
                          <input id="prize-upload" className="form-control" type="file" accept=".xlsx,.xls,.csv,text/csv" />
                        </label>
                      </div>
                      <div id="import-status" className="status-note text-small" aria-live="polite">טבלת הפרסים הקבועה כבר טעונה במערכת. העלאת קובץ פרסים היא אופציונלית בלבד ונועדה רק להחלפה יזומה.</div>
                    </section>

                    <section className="control-group">
                      <div className="control-group-header">
                        <h4>מקור נתונים</h4>
                        <p>בחירה בין העלאת קובץ ידנית לבין חיבור ל-API של מערכת הגיוס לצורך משיכה שוטפת לאורך הקמפיין</p>
                      </div>
                      <div className="filters-grid filters-grid--three">
                        <label className="form-label">
                          מקור פעיל
                          <select id="source-mode" className="form-select">
                            <option value="file">קובץ CSV / Excel</option>
                            <option value="api">API של מערכת הגיוס</option>
                            <option value="google_sheets">Google Sheets</option>
                          </select>
                        </label>
                        <label className="form-label">
                          שיטת בקשה
                          <select id="source-api-method" className="form-select">
                            <option value="GET">GET</option>
                            <option value="POST">POST</option>
                          </select>
                        </label>
                        <label className="form-label">
                          פורמט תגובה
                          <select id="source-api-format" className="form-select">
                            <option value="csv">CSV</option>
                            <option value="json">JSON</option>
                          </select>
                        </label>
                      </div>
                      <div id="source-api-fields">
                        <div className="filters-grid">
                          <label className="form-label">
                            כתובת endpoint
                            <input id="source-api-endpoint" className="form-control" type="url" placeholder="https://api.example.org/campaign/export" dir="ltr" />
                          </label>
                          <label className="form-label">
                            נתיב לרשומות ב-JSON
                            <input id="source-api-records-path" className="form-control" type="text" placeholder="data.records" dir="ltr" />
                          </label>
                          <label className="form-label">
                            אימות
                            <select id="source-api-auth-type" className="form-select">
                              <option value="none">ללא אימות</option>
                              <option value="bearer">Bearer Token</option>
                            </select>
                          </label>
                          <label className="form-label">
                            רענון אוטומטי בדקות
                            <input id="source-api-auto-refresh" className="form-control" type="number" min="0" step="1" placeholder="5" />
                          </label>
                          <label className="form-label">
                            Bearer Token
                            <input id="source-api-bearer-token" className="form-control" type="password" autoComplete="off" placeholder="השאר/י ריק כדי לשמור את הערך הקיים" dir="ltr" />
                          </label>
                        </div>
                        <div className="filters-grid">
                          <label className="form-label">
                            Headers נוספים
                            <textarea id="source-api-headers" className="form-control settings-textarea" placeholder="X-Client-Id: 12345&#10;X-Campaign: campaign-example" dir="ltr"></textarea>
                          </label>
                          <label className="form-label">
                            Body לבקשת POST
                            <textarea id="source-api-body" className="form-control settings-textarea" placeholder="{&quot;campaign&quot;:&quot;campaign-example&quot;}" dir="ltr"></textarea>
                          </label>
                        </div>
                        <label className="form-label">
                          מיפוי שדות JSON לשדות הדשבורד
                          <textarea id="source-api-field-map" className="form-control settings-textarea" dir="ltr"></textarea>
                        </label>
                      </div>
                      <div id="source-google-fields" hidden>
                        <div className="filters-grid">
                          <label className="form-label">
                            קישור ל-Google Sheets
                            <input id="source-google-url" className="form-control" type="url" placeholder="https://docs.google.com/spreadsheets/d/..." dir="ltr" />
                          </label>
                          <label className="form-label">
                            Spreadsheet ID
                            <input id="source-google-id" className="form-control" type="text" placeholder="1AbCdEf..." dir="ltr" />
                          </label>
                          <label className="form-label">
                            GID
                            <input id="source-google-gid" className="form-control" type="text" placeholder="0" dir="ltr" />
                          </label>
                          <label className="form-label">
                            Sheet Name
                            <input id="source-google-sheet-name" className="form-control" type="text" placeholder="Sheet1" dir="ltr" />
                          </label>
                          <label className="form-label">
                            Range
                            <input id="source-google-range" className="form-control" type="text" placeholder="Sheet1!A:Z" dir="ltr" />
                          </label>
                          <label className="form-label">
                            שיטת גישה
                            <select id="source-google-access-mode" className="form-select">
                              <option value="public_csv">Public CSV export</option>
                              <option value="service_account">Service Account</option>
                            </select>
                          </label>
                          <label className="form-label">
                            סנכרון אוטומטי בדקות
                            <input id="source-google-sync-interval" className="form-control" type="number" min="1" step="1" placeholder="5" />
                          </label>
                        </div>
                        <label className="form-label">
                          מיפוי שדות Google Sheets לשדות המערכת
                          <textarea id="source-google-field-map" className="form-control settings-textarea" dir="ltr"></textarea>
                        </label>
                      </div>
                      <div className="control-actions control-actions--inline">
                        <button id="save-source-config" className="button-secondary action-button secondary" type="button">שמירת חיבור מקור</button>
                        <button id="refresh-source-api" className="button-primary action-button" type="button">משיכת נתונים מהמערכת</button>
                      </div>
                      <div id="source-config-status" className="status-note text-small" aria-live="polite">כרגע המערכת עובדת על בסיס קובץ. כשה-API יהיה מוכן, אפשר יהיה לעבור למצב משיכה ישירה.</div>
                    </section>

                    <section className="control-group">
                      <div className="control-group-header">
                        <h4>זמן</h4>
                        <p>יום פרויקט, תאריך מדויק, טווח תאריכים ושעות</p>
                      </div>
                      <div className="filters-grid filters-grid--three">
                        <label className="form-label">
                          יום פרויקט
                          <select id="project-day-filter" className="form-select"></select>
                        </label>
                        <label className="form-label">
                          תאריך מדויק
                          <select id="date-exact" className="form-select"></select>
                        </label>
                        <label className="form-label">
                          שעה
                          <select id="hour-filter" className="form-select"></select>
                        </label>
                        <label className="form-label">
                          תאריך התחלה
                          <input id="date-from" className="form-control" type="date" />
                        </label>
                        <label className="form-label">
                          תאריך סיום
                          <input id="date-to" className="form-control" type="date" />
                        </label>
                        <label className="form-label">
                          משעה
                          <select id="hour-from-filter" className="form-select"></select>
                        </label>
                        <label className="form-label">
                          עד שעה
                          <select id="hour-to-filter" className="form-select"></select>
                        </label>
                        <label className="form-label">
                          משעת התחלה לספרינט
                          <input id="time-from-filter" className="form-control" type="time" step="60" />
                        </label>
                        <label className="form-label">
                          עד שעת סיום לספרינט
                          <input id="time-to-filter" className="form-control" type="time" step="60" />
                        </label>
                      </div>
                    </section>

                    <section className="control-group">
                      <div className="control-group-header">
                        <h4>אנשים וסכומים</h4>
                        <p>פילוח לפי שגריר, תורם וסכום</p>
                      </div>
                      <div className="filters-grid">
                        <label className="form-label">
                          שגריר/ה
                          <select id="ambassador-filter" className="form-select"></select>
                        </label>
                        <label className="form-label">
                          שם התורם/ת
                          <input id="donor-filter" className="form-control" type="text" placeholder="חיפוש לפי שם תורם" />
                        </label>
                        <label className="form-label">
                          סכום מינימלי
                          <input id="amount-min-filter" className="form-control" type="number" min="0" step="50" placeholder="למשל 180" />
                        </label>
                        <label className="form-label">
                          סכום מקסימלי
                          <input id="amount-max-filter" className="form-control" type="number" min="0" step="50" placeholder="למשל 5000" />
                        </label>
                      </div>
                    </section>

                    <section className="control-group">
                      <div className="control-group-header">
                        <h4>יעדים</h4>
                        <p>מדדי יעד כוללים ויומיים</p>
                      </div>
                      <div className="filters-grid">
                        <label className="form-label">
                          יעד כולל
                          <input id="goal-total" className="form-control" type="number" min="0" step="100" placeholder="למשל 1500000" />
                        </label>
                        <label className="form-label">
                          יעד יומי
                          <input id="goal-daily" className="form-control" type="number" min="0" step="100" placeholder="למשל 150000" />
                        </label>
                      </div>
                    </section>

                    <section className="control-group">
                      <div className="control-group-header">
                        <h4>איפוס נתוני עבודה</h4>
                        <p>ניקוי מהיר של נתוני הניתוח כדי לטעון קבצים חדשים מבלי לפגוע בעיצוב הקמפיין ובהגדרות המנהלים</p>
                      </div>
                      <div className="status-note text-small">
                        האיפוס מחזיר את קובץ הבסיס, קובץ ההשוואה, רשימת השגרירים וטבלת הפרסים למצב ברירת המחדל המקומי, ומנקה את שדות ההעלאה הפעילים.
                      </div>
                      <div className="control-actions control-actions--inline">
                        <button id="reset-working-data" className="button-secondary action-button secondary" type="button">איפוס נתוני עבודה</button>
                      </div>
                    </section>
                  </div>
                  <div className="control-actions">
                    <button id="export-filtered" className="button-primary action-button" type="button">ייצוא הנתונים המסוננים</button>
                    <button id="clear-compare" className="button-secondary action-button secondary" type="button">ניקוי קובץ ההשוואה</button>
                    <button id="clear-filters" className="button-ghost" type="button">ניקוי מסננים</button>
                  </div>
                  <div id="active-filter-summary" className="status-chip active-filter-summary" aria-live="polite">אין מסננים פעילים</div>
                  <div id="control-note" className="status-note text-small" aria-live="polite"></div>
                </aside>
              </section>

              <section id="metrics-grid" className="metric-grid" aria-label="מדדי סיכום"></section>

              <section className="dashboard-section">
                <div className="section-header">
                  <h3>יעדים מול ביצוע</h3>
                  <div id="goals-summary" className="text-small text-muted"></div>
                </div>
                <div id="goals-board" className="analysis-shell"></div>
              </section>

              <section className="dashboard-section">
                <div className="section-header">
                  <h3>מה דורש תשומת לב עכשיו</h3>
                  <div id="executive-summary" className="text-small text-muted"></div>
                </div>
                <div id="executive-board" className="analysis-shell"></div>
              </section>

              <section className="dashboard-section chart-frame">
                <div className="chart-panel chart-card app-card">
                  <div className="section-header">
                    <div className="chart-header-copy">
                      <span className="chart-overline">מבט מגמה</span>
                      <h3>מגמה יומית</h3>
                      <div id="daily-chart-summary" className="chart-insights" aria-live="polite"></div>
                    </div>
                    <div className="data-toolbar metric-toolbar" data-metric-group="daily" aria-label="בחירת מדד לגרף היומי">
                      <button className="metric-toggle" type="button" data-metric-select="daily-metric-select" data-value="amount">סכום גיוס</button>
                      <button className="metric-toggle" type="button" data-metric-select="daily-metric-select" data-value="count">מספר עסקאות</button>
                      <button className="metric-toggle" type="button" data-metric-select="daily-metric-select" data-value="average">ממוצע לעסקה</button>
                    </div>
                  </div>
                  <select id="daily-metric-select" className="visually-hidden-select" aria-label="בחירת מדד לגרף יומי">
                    <option value="amount">סכום גיוס</option>
                    <option value="count">מספר עסקאות</option>
                    <option value="average">ממוצע לעסקה</option>
                  </select>
                  <div id="daily-chart" className="chart-surface"></div>
                  <div className="chart-footnote">לחיצה על עמוד או נקודה בגרף תסנן את הדשבורד לאותו יום.</div>
                </div>
                <div id="daily-tooltip" className="tooltip" role="status" aria-live="polite"></div>
              </section>

              <section className="dashboard-section chart-frame">
                <div className="chart-panel chart-card app-card">
                  <div className="section-header">
                    <div className="chart-header-copy">
                      <span className="chart-overline">עומסים לפי זמן</span>
                      <h3>מפת חום לגיוס כספים</h3>
                      <div id="heatmap-summary" className="chart-insights" aria-live="polite"></div>
                      <div className="legend-row text-small text-muted">
                        <span className="legend-item"><span className="legend-swatch" style={{"background":"rgba(255, 214, 41, 0.18)","border":"1px solid rgba(17, 29, 74, 0.14)"}}></span>עוצמה נמוכה</span>
                        <span className="legend-item"><span className="legend-swatch" style={{"background":"rgba(255, 214, 41, 0.95)","border":"1px solid rgba(17, 29, 74, 0.14)"}}></span>עוצמה גבוהה</span>
                      </div>
                    </div>
                    <div className="data-toolbar metric-toolbar" data-metric-group="heatmap" aria-label="בחירת מדד למפת החום">
                      <button className="metric-toggle" type="button" data-metric-select="heatmap-metric-select" data-value="amount">סכום גיוס</button>
                      <button className="metric-toggle" type="button" data-metric-select="heatmap-metric-select" data-value="count">מספר עסקאות</button>
                    </div>
                  </div>
                  <select id="heatmap-metric-select" className="visually-hidden-select" aria-label="בחירת מדד למפת החום">
                    <option value="amount">סכום גיוס</option>
                    <option value="count">מספר עסקאות</option>
                  </select>
                  <div id="heatmap-chart" className="chart-surface chart-surface--wide"></div>
                  <div className="chart-footnote">לחיצה על תא במפה תפעיל פילוח משולב של יום ושעה.</div>
                </div>
                <div id="heatmap-tooltip" className="tooltip" role="status" aria-live="polite"></div>
              </section>

              <section className="dashboard-section chart-frame">
                <div className="chart-panel chart-card app-card">
                  <div className="section-header">
                    <div className="chart-header-copy">
                      <span className="chart-overline">פעילות שגרירים</span>
                      <h3>תנועת שגרירים</h3>
                      <div id="movement-summary" className="chart-insights" aria-live="polite"></div>
                    </div>
                    <div className="data-toolbar metric-toolbar" data-metric-group="movement" aria-label="בחירת מדד לתנועת השגרירים">
                      <button className="metric-toggle" type="button" data-metric-select="movement-metric-select" data-value="amount">סכום גיוס</button>
                      <button className="metric-toggle" type="button" data-metric-select="movement-metric-select" data-value="count">מספר עסקאות</button>
                    </div>
                  </div>
                  <select id="movement-metric-select" className="visually-hidden-select" aria-label="בחירת מדד לתנועת שגרירים">
                    <option value="amount">סכום גיוס</option>
                    <option value="count">מספר עסקאות</option>
                  </select>
                  <div id="movement-chart" className="chart-surface chart-surface--wide"></div>
                  <div className="chart-footnote">לחיצה על שגריר או על תא במטריצה תעדכן את כל המסכים לפי אותו חיתוך.</div>
                </div>
                <div id="movement-tooltip" className="tooltip" role="status" aria-live="polite"></div>
              </section>

              <section className="dashboard-section">
                <div className="section-header">
                  <h3>דירוגים ופילוחים</h3>
                  <div id="segment-summary" className="text-small text-muted"></div>
                </div>
                <div id="segment-board" className="analysis-shell"></div>
              </section>

              <section className="dashboard-section">
                <div className="section-header">
                  <h3>איכות נתונים וסיכונים</h3>
                  <div id="quality-summary" className="text-small text-muted"></div>
                </div>
                <div id="quality-board" className="analysis-shell"></div>
              </section>

              <section className="dashboard-section">
                <div className="section-header">
                  <h3>ולידציה של קבצי הקלט</h3>
                  <div id="validation-summary" className="text-small text-muted"></div>
                </div>
                <div id="validation-board" className="analysis-shell"></div>
              </section>

              <section className="dashboard-section">
                <div className="section-header">
                  <h3>השוואת קבצים</h3>
                  <div id="comparison-summary" className="text-small text-muted"></div>
                </div>
                <div id="comparison-board" className="comparison-shell"></div>
              </section>

              <section className="dashboard-section">
                <div className="section-header">
                  <h3>טבלת הרשומות</h3>
                  <div style={{"display":"flex","alignItems":"center","gap":"12px","flexWrap":"wrap"}}>
                    <div id="table-summary" className="text-small text-muted"></div>
                    <button id="table-toggle" className="button-ghost" type="button" aria-expanded="false" aria-controls="table-panel">הצג רשומות</button>
                  </div>
                </div>
                <div id="table-panel" className="table-panel" hidden>
                  <div id="table-root" className="table-wrap"></div>
                </div>
              </section>
            </div>);
}
