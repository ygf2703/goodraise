export function AccessibilityPage() {
  return <section id="page-accessibility" className="page-shell">
    <article className="legal-hero app-card app-card--elevated">
      <h1>הצהרת נגישות</h1>
      <p>GoodRaise פועלת כדי לאפשר לכל אדם להשתמש באתר ובשירותיו באופן שוויוני, עצמאי ונוח.</p>
    </article>
    <div className="legal-layout">
      <aside className="legal-sidebar app-card">
        <div className="section-header"><h2>תוכן עניינים</h2></div>
        <nav aria-label="תוכן עניינים - הצהרת נגישות">
          <a href="#accessibility-standard">תקן ורמת הנגישות</a>
          <a href="#accessibility-adjustments">התאמות שבוצעו</a>
          <a href="#accessibility-testing">בדיקות ותחזוקה</a>
          <a href="#accessibility-limitations">מגבלות ידועות</a>
          <a href="#accessibility-contact">פניות בנושא נגישות</a>
        </nav>
      </aside>
      <article className="legal-document app-card legal-layout__content">
        <div className="status-note text-small">האתר נמצא בתהליך הנגשה ובדיקה. הצהרה זו תעודכן בהתאם לממצאי הבדיקות ולשינויים בשירות.</div>
        <section id="accessibility-standard">
          <h2>תקן ורמת הנגישות</h2>
          <p>האתר מפותח בהתאם לדרישות תקנות שוויון זכויות לאנשים עם מוגבלות (התאמות נגישות לשירות) ולתקן הישראלי ת״י 5568 חלק 1 ברמה AA. הנחיות WCAG 2.2 ברמה AA משמשות יעד הנדסי משלים.</p>
        </section>
        <section id="accessibility-adjustments">
          <h2>התאמות שבוצעו</h2>
          <ul>
            <li>מבנה סמנטי, כותרות, אזורי ניווט וקישור לדילוג ישירות לתוכן המרכזי.</li>
            <li>תפעול באמצעות מקלדת, חיווי מיקוד ברור ותשתית סמנטית לשימוש בתוכנות קוראות מסך.</li>
            <li>תוויות לשדות ולטפסים, משוב נגיש לפעולות והודעות שגיאה שאינן מסתמכות על צבע בלבד.</li>
            <li>תצוגה מותאמת למסכים בגדלים שונים, הגדלת טקסט והפחתת תנועה לפי הגדרות המשתמש.</li>
            <li>טקסט חלופי לתמונות משמעותיות ותיאור נגיש לתרשימים ולמידע חזותי.</li>
          </ul>
        </section>
        <section id="accessibility-testing">
          <h2>בדיקות ותחזוקה</h2>
          <p>בוצעו בדיקות מבנה אוטומטיות ובדיקות ידניות ראשוניות של ניווט מקלדת, סדר כותרות, הגדלה ותצוגה במובייל. לפני פתיחת השירות לציבור תבוצע גם בדיקה עצמאית מלאה ברמת AA, לרבות שימוש בקורא מסך, טפסים, תרשימים ותוכן שמגיע מצדדים שלישיים. בדיקות חוזרות יבוצעו בעת הוספת מסכים ותהליכים חדשים.</p>
        </section>
        <section id="accessibility-limitations">
          <h2>מגבלות ידועות</h2>
          <p>ייתכן שתוכן שמקורו בצדדים שלישיים, לרבות מדיה ושירותי תשלום עתידיים, לא יהיה בשליטת GoodRaise במלואו. אנו נעדיף ספקים נגישים ונפעל להציע חלופה נגישה כאשר יתגלה קושי.</p>
        </section>
        <section id="accessibility-contact">
          <h2>פניות בנושא נגישות</h2>
          <p>אם נתקלתם בקושי, נשמח לקבל תיאור של הפעולה שניסיתם לבצע, כתובת העמוד, הדפדפן והטכנולוגיה המסייעת שבה השתמשתם. פרטי איש או אשת הקשר לנגישות ודרכי הפנייה הישירות יפורסמו כאן לפני פתיחת השירות לציבור.</p>
        </section>
        <section>
          <h2>הסדרי נגישות במקום פיזי</h2>
          <p>השירות המוצג באתר ניתן בשלב זה באופן מקוון. אם תיפתח קבלת קהל או יינתן שירות במקום פיזי, פרטי הסדרי הנגישות של המקום יפורסמו כאן לפני פתיחתו לציבור.</p>
        </section>
        <section>
          <h2>עדכון ההצהרה</h2>
          <p>הצהרה זו עודכנה לאחרונה ביום 11 בספטמבר 2026.</p>
        </section>
      </article>
    </div>
  </section>;
}
