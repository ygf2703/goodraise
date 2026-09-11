import { Header } from './Header';
import { ProjectPage } from './ProjectPage';
import { PrizesPage } from './PrizesPage';
import { RulesPage } from './RulesPage';
import { PrivacyPage } from './PrivacyPage';
import { AccessibilityPage } from './AccessibilityPage';
import { AdminPage } from './AdminPage';
import { ManualContributionDialog } from './ManualContributionDialog';
import { SiteFooter } from './SiteFooter';
import { SkipLink } from './SkipLink';

export function DashboardLayout() {
  return (<div id="goodraise-root" dir="rtl">
  <SkipLink />
  <Header />

  <div className="app-shell">

    <main id="main" className="app-content" tabIndex={-1}>
      <ProjectPage />

      <PrizesPage />

      <RulesPage />

      <PrivacyPage />

      <AccessibilityPage />

      <AdminPage />
    </main>
  </div>
  <SiteFooter />
  <ManualContributionDialog />

</div>);
}
