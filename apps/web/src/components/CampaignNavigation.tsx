export function CampaignNavigation() {
  return <section className="campaign-navigation" data-campaign-navigation aria-label="הקמפיין שנבחר" hidden>
    <div className="campaign-navigation-heading">
      <div>
        <span className="campaign-navigation-label">הקמפיין שנבחר</span>
        <strong data-campaign-name dir="auto" />
      </div>
      <a className="campaign-navigation-back" href="/admin">חזרה לפרויקטים שלי <span aria-hidden="true">←</span></a>
    </div>
    <nav className="campaign-navigation-links" aria-label="ניווט בקמפיין">
      <a data-page-target="admin" hidden>ניהול הקמפיין</a>
      <a data-page-target="project" hidden>דף הפרויקט</a>
      <a data-page-target="prizes" hidden>פרסים ותחרות</a>
    </nav>
  </section>;
}
