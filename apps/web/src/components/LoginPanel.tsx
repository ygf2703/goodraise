

export function LoginPanel() {
  return (<section id="admin-lock" className="admin-lock app-card app-card--elevated">
          <div className="login-shell">
            <div className="login-visual app-card--dark">
              <div className="login-brand-row">
                <div className="login-copy">
                  <span className="brand-kicker">גישה למשתמשים שאושרו מראש</span>
                  <h1>כניסה לחשבון GoodRaise</h1>
                  <p>לאחר הכניסה נציג את הפרויקטים ששויכו אליך ואת כלי הצפייה, הניתוח או הניהול הזמינים לפי התפקיד שלך בכל פרויקט.</p>
                </div>
                <div className="login-logos">
                  <div className="login-logo-frame">
                    <img id="login-campaign-logo" src="/assets/goodraise-logo-transparent.png" alt="גודרייז" />
                  </div>
                </div>
              </div>
            </div>
            <form id="login-form" className="login-card app-card">
              <div className="section-header">
                <div>
                  <h2>כניסה לחשבון</h2>
                  <div className="text-small text-muted">כניסה באמצעות מייל מורשה מראש. אם זו כניסה ראשונה, המערכת תעבור אוטומטית להגדרת סיסמה.</div>
                </div>
              </div>
              <label className="form-label">
                כתובת מייל
                <input id="login-email" className="form-control" type="email" autoComplete="username" placeholder="name@example.org" aria-describedby="login-mode-hint login-message" required />
              </label>
              <label className="form-label">
                סיסמה
                <div className="password-field">
                  <input id="login-password" className="form-control" type="password" autoComplete="current-password" placeholder="הקלד/י סיסמה" aria-describedby="login-password-setup-note login-message" required />
                  <button id="login-password-toggle" className="button-ghost password-toggle" type="button" aria-label="הצג או הסתר סיסמה">הצג</button>
                </div>
                <div id="login-password-setup-note" className="text-small text-muted" hidden style={{"display":"none"}}>בכניסה ראשונה יש לבחור סיסמה באורך 8 תווים לפחות.</div>
              </label>
              <label id="login-password-confirm-label" className="form-label" hidden style={{"display":"none"}}>
                אימות סיסמה
                <input id="login-password-confirm" className="form-control" type="password" autoComplete="new-password" placeholder="הקלד/י שוב את הסיסמה" aria-describedby="login-password-setup-note login-message" />
              </label>
              <div className="login-actions">
                <button id="login-button" className="button-primary action-button" type="submit">כניסה לחשבון</button>
                <button id="login-reset-button" className="button-ghost" type="button" hidden>איפוס סיסמה</button>
              </div>
              <div id="login-mode-hint" className="text-small text-muted">הגישה זמינה רק לחשבונות שאושרו ושויכו מראש.</div>
              <div id="login-message" className="login-message text-small" aria-live="polite"></div>
            </form>
          </div>
        </section>);
}
