

export function PrivacyPage() {
  return (<section id="page-privacy" className="page-shell">
        <article className="legal-hero app-card app-card--elevated">
          <h1>מדיניות פרטיות</h1>
          <p>עמוד זה מציג את מבנה הפרטיות והמידע עבור גרסת הפיילוט של המערכת, בלי להוסיף התחייבויות משפטיות חדשות מעבר לנוסח שכבר הוגדר.</p>
        </article>
        <div className="legal-layout">
          <aside className="legal-sidebar app-card">
            <div className="section-header">
              <h2>תוכן עניינים</h2>
            </div>
            <nav aria-label="תוכן עניינים - פרטיות">
              <a href="#privacy-section-1">1. מידע שנאסף</a>
              <a href="#privacy-section-2">2. מטרות השימוש</a>
              <a href="#privacy-section-3">3. הרשאות וגישה</a>
              <a href="#privacy-section-4">4. שמירת מידע</a>
              <a href="#privacy-section-5">5. אבטחת מידע</a>
              <a href="#privacy-section-6">6. זכויות המשתמשים</a>
              <a href="#privacy-section-7">7. יצירת קשר</a>
              <a href="#privacy-section-8">8. תאריך עדכון</a>
            </nav>
          </aside>
          <article className="legal-document app-card legal-layout__content">
            <section id="privacy-section-1">
              <h2>1. מידע שנאסף</h2>
              <p>המערכת עשויה לקלוט נתוני תרומה ותפעול לצורך בקרה ודשבורד, לרבות שם תורם, כתובת דוא״ל, סכום, זמן ביצוע, שיוך לשגריר וסטטוס עסקה.</p>
            </section>
            <section id="privacy-section-2">
              <h2>2. מטרות השימוש</h2>
              <ul>
                <li>הצגת נתונים ניהוליים בזמן אמת.</li>
                <li>זיהוי מגמות גיוס, זוכים, שגרירים מובילים, תקלות וחריגות.</li>
                <li>השוואות בין קבצים, בין תקופות ובין מחזורי קמפיין שונים.</li>
              </ul>
            </section>
            <section id="privacy-section-3">
              <h2>3. הרשאות וגישה</h2>
              <ul>
                <li>עמודי התקנון והפרטיות זמינים לכלל המבקרים. דף הפרויקט והפרסים זמינים כרגע למנהלים מורשים לאחר כניסה.</li>
                <li>הדשבורד הניהולי זמין למשתמשים מורשים לפי מייל שהוגדר מראש ובאמצעות סיסמה.</li>
                <li>לפני עלייה לאוויר יש להעביר את מנגנון הזיהוי לאימות שרת אמיתי.</li>
              </ul>
            </section>
            <section id="privacy-section-4">
              <h2>4. שמירת מידע</h2>
              <p>בגרסת הפיילוט המערכת עובדת מקומית ולכן מצמצמת חשיפה, אך עדיין יש לנהוג בזהירות בקובצי המקור ובהרשאות הגישה אליהם.</p>
            </section>
            <section id="privacy-section-5">
              <h2>5. אבטחת מידע</h2>
              <ul>
                <li>מומלץ להגדיר מדיניות שמירה, מחיקה, גיבוי והרשאות צפייה לפי תפקיד.</li>
                <li>בעתיד יש להוסיף שכבת Backend, ניהול משתמשים ורישום פעולות לצורכי בקרה.</li>
              </ul>
            </section>
            <section id="privacy-section-6">
              <h2>6. זכויות המשתמשים</h2>
              <p>כל בקשה לעדכון, מחיקה, תיקון או בירור נתונים צריכה להתבצע לפי נהלי הארגון והדין החל.</p>
            </section>
            <section id="privacy-section-7">
              <h2>7. יצירת קשר</h2>
              <p>לצורכי בקרה, פרטיות או אבטחת מידע יש לפנות לארגון המנהל את הקמפיין ולגורמים המורשים מטעמו.</p>
            </section>
            <section id="privacy-section-8">
              <h2>8. תאריך עדכון</h2>
              <p>טיוטת מערכת ליום 28.07.2026. לפני שימוש חיצוני יש להשלים אישור סופי.</p>
            </section>
          </article>
        </div>
      </section>);
}
