

export function ManualContributionDialog() {
  return (<dialog id="manual-contribution-dialog" className="manual-contribution-dialog" aria-labelledby="manual-contribution-title">
    <form id="manual-contribution-form" className="manual-contribution-form" noValidate>
      <div className="manual-contribution-header">
        <h3 id="manual-contribution-title">הוספת הכפלה ידנית</h3>
        <p className="text-small text-muted">הסכום יתווסף מיד לקמפיין וישמר כרשומה בשם תורם/ת: הכפלה - שם המכניס/ה.</p>
      </div>
      <label className="form-label">
        שם המכניס/ה
        <input id="manual-contribution-entered-by" className="form-control" type="text" autoComplete="name" maxLength={120} required />
      </label>
      <label className="form-label">
        סכום להוספה
        <input id="manual-contribution-amount" className="form-control" type="number" inputMode="decimal" min="0.01" step="0.01" required dir="ltr" />
      </label>
      <label className="form-label">
        תאריך ושעת שיוך
        <input id="manual-contribution-attributed-at" className="form-control" type="datetime-local" required dir="ltr" />
        <span className="field-hint">הסכום יוצג בדוחות, בדירוגים ובספרינטים לפי המועד שתבחרו.</span>
      </label>
      <div id="manual-contribution-status" className="status-note text-small" aria-live="polite"></div>
      <div className="manual-contribution-actions">
        <button className="button-primary action-button" type="submit">הוספת סכום</button>
        <button id="manual-contribution-cancel" className="button-ghost" type="button">ביטול</button>
      </div>
    </form>
  </dialog>);
}
