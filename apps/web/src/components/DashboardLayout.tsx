import { Header } from './Header';
import { ProjectPage } from './ProjectPage';
import { PrizesPage } from './PrizesPage';
import { RulesPage } from './RulesPage';
import { PrivacyPage } from './PrivacyPage';
import { AdminPage } from './AdminPage';
import { ManualContributionDialog } from './ManualContributionDialog';

export function DashboardLayout() {
  return (<div id="goodraise-root" dir="rtl">


  <div className="app-shell">
    <Header />

    <main className="app-content">
      <ProjectPage />

      <PrizesPage />

      <RulesPage />

      <PrivacyPage />

      <AdminPage />
    </main>
  </div>
  <ManualContributionDialog />

</div>);
}
