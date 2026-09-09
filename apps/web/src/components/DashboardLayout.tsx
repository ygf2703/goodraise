import { Header } from './Header';
import { ProjectPage } from './ProjectPage';
import { PrizesPage } from './PrizesPage';
import { RulesPage } from './RulesPage';
import { PrivacyPage } from './PrivacyPage';
import { AdminPage } from './AdminPage';
import { ManualContributionDialog } from './ManualContributionDialog';

export function DashboardLayout() {
  return (<div id="goodraise-root" dir="rtl">
  <Header />

  <div className="app-shell">

    <main className="app-content">
      <ProjectPage />

      <PrizesPage />

      <RulesPage />

      <PrivacyPage />

      <AdminPage />
    </main>

    <footer className="app-footer">
      <nav aria-label="קישורים בתחתית העמוד">
        <button type="button" data-page-target="rules">תקנון השתתפות</button>
        <a href="/privacy">מדיניות פרטיות</a>
      </nav>
    </footer>
  </div>
  <ManualContributionDialog />

</div>);
}
