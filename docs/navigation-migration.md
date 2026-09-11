# Navigation migration

The landing page and all campaign, legal and admin pages render the same
`Header` component from `apps/web/src/components/Header.tsx`. The static homepage
receives the component during asset preparation; React renders it in the app.
`work/assets/site-header.css` and `site-header.js` provide the shared appearance,
session-aware navigation and mobile menu behavior.

Guests see homepage section links, `/login`, and a separate “start fundraising”
CTA that remains outside the existing-user login flow. After login, all approved
accounts see “my projects”; assigned accounts see project/prize links, analysts+
see the dashboard, and site admins also see `/admin/users`. Logout is available
to every authenticated account.

| Existing destination | Direct URL | Current navigation | Migration status |
| --- | --- | --- | --- |
| כניסת משתמש קיים | `/login` | Guest header | Implemented; approval required before first-password setup |
| הפרויקטים שלי | `/admin` | Authenticated header | Implemented; direct single project or active/completed selector |
| ניהול משתמשים | `/admin/users` | Site-admin header | Implemented; approvals, roles, memberships and deactivation |
| דף הפרויקט | `/project`, `/<campaign>` or `/<campaign>/<ambassador>` | Main menu for assigned users | Access migrated; content migration pending |
| פרסים ותחרות | `/prizes` | Main menu for assigned users | Access migrated; content migration pending |
| תנאי שימוש ותקנון השתתפות | `/rules` | Shared footer on every page | Content migration pending |
| מדיניות פרטיות | `/privacy` | Shared footer on every page | Removed from the header; content migration pending |
| הצהרת נגישות | `/accessibility` | Shared footer on every page | Public statement; direct contact details and independent audit pending |
| דשבורד ניהולי | `/admin?organizationId=…&campaignId=…` | Analyst+ main menu/project selector | Content migration pending |
| התנתקות | Shared header and `/admin` | Available for any authenticated account | Ends the server session and returns to the homepage |

Direct private campaign and prizes URLs redirect guests to `/login` with a safe
return target. Successful login resumes the requested page only if the scoped
authorization succeeds. Header links retain the selected organization, campaign
and ambassador context, including when opened in a new tab. Legal pages remain public.

Completed campaigns use anonymous read-only routes: `/campaigns` lists the archive and `/campaigns/:organization/:campaign` shows a minimal historical detail page. Homepage carousel cards link to these scoped URLs, avoiding campaign-slug collisions between organizations.

The login form works before the session lookup finishes. Session restoration
uses `/api/auth/status`; login/setup responses are enriched with the explicit
accessible-campaign portfolio before routing. Campaign code is imported only
after assigned access is confirmed; the account selector is a separate typed module.

Project and Prizes load one `/api/campaign-view` response containing the scoped
presentation configuration and prize rules. Viewer responses contain aggregate
campaign/ambassador totals and no donation rows. Analyst+ campaign views receive
redacted rows; donor contact fields and source/settings payloads are omitted.
Header navigation between these two views retains the application
and revalidates the campaign through the server. Back/forward navigation is
supported; entering the management dashboard loads its full data and settings.

The campaign view, legacy `/api/public-context` and scoped `/public-dataset` endpoints
require assigned viewer+ authorization. Context discovery only considers accessible
campaigns; dataset reads enforce the existing organization and campaign scope
through `campaign_page_view`. The static bundle contains neither donor rows nor
prize data. A hidden menu is not the authorization boundary.

The existing page contents remain in place while they are migrated one at a
time. Campaign-specific logos remain within authenticated campaign content;
the shared header always uses the GoodRaise brand.
