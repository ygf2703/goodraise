

export function LoginPanel() {
  return (<section id="admin-lock" className="admin-lock app-card app-card--elevated">
          <div className="login-shell">
            <div className="login-visual app-card--dark">
              <div className="login-brand-row">
                <div className="login-copy">
                  <span className="brand-kicker">גישה למנהלים מורשים בלבד</span>
                  <h2>כניסה למערכת הניהול</h2>
                  <p>מסך הכניסה מספק גישה לפאנל הניהול, לבקרה על קבצי המקור, לפילוחים המתקדמים, להשוואות הקבצים ולכל שכבת האנליטיקה של הקמפיין.</p>
                </div>
                <div className="login-logos">
                  <div className="login-logo-frame">
                    <img id="login-campaign-logo" src="/assets/goodraise-logo-transparent.png" alt="גודרייז" />
                  </div>
                  <div className="login-logo-frame">
                    <img id="login-org-logo" src="/assets/goodraise-logo-transparent.png" alt="גודרייז" />
                  </div>
                </div>
              </div>
            </div>
            <form id="login-form" className="login-card app-card">
              <div className="section-header">
                <div>
                  <h2>כניסה למערכת הניהול</h2>
                  <div className="text-small text-muted">כניסה באמצעות מייל מורשה מראש. אם זו כניסה ראשונה, המערכת תעבור אוטומטית להגדרת סיסמה.</div>
                </div>
              </div>
              <label className="form-label">
                מייל מנהל/ת
                <input id="login-email" className="form-control" type="email" autoComplete="username" placeholder="name@example.org" />
              </label>
              <label className="form-label">
                סיסמה
                <div className="password-field">
                  <input id="login-password" className="form-control" type="password" autoComplete="current-password" placeholder="הקלד/י סיסמה" />
                  <button id="login-password-toggle" className="button-ghost password-toggle" type="button" aria-label="הצג או הסתר סיסמה">הצג</button>
                </div>
                <div id="login-password-setup-note" className="text-small text-muted" hidden style={{"display":"none"}}>בכניסה ראשונה יש לבחור סיסמה באורך 8 תווים לפחות.</div>
              </label>
              <label id="login-password-confirm-label" className="form-label" hidden style={{"display":"none"}}>
                אימות סיסמה
                <input id="login-password-confirm" className="form-control" type="password" autoComplete="new-password" placeholder="הקלד/י שוב את הסיסמה" />
              </label>
              <div className="login-actions">
                <button id="login-button" className="button-primary action-button" type="submit">כניסה לפאנל הניהול</button>
                <button id="login-reset-button" className="button-ghost" type="button" hidden>איפוס סיסמה</button>
              </div>
              <div id="login-mode-hint" className="text-small text-muted">הגישה לנתוני הקמפיין זמינה למנהלים מורשים בלבד.</div>
              <div id="login-message" className="login-message text-small" aria-live="polite"></div>
            </form>
          </div>
        </section>);
}
