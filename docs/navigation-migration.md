# Navigation migration

The landing page and all campaign, legal and admin pages render the same
`Header` component from `apps/web/src/components/Header.tsx`. The static homepage
receives the component during asset preparation; React renders it in the app.
`work/assets/site-header.css` and `site-header.js` provide the shared appearance,
session-aware navigation and mobile menu behavior.

Guests see homepage section links and login actions. After login, accounts with
the server-granted `permissions.campaignPages` capability see the dashboard,
project and prizes links in the main menu, plus logout. The current allowed roles
are `platform_admin`, `organization_admin` and `campaign_manager`; analyst and
viewer accounts do not receive these links or access to these pages.

| Existing destination | Direct URL | Current navigation | Migration status |
| --- | --- | --- | --- |
| דף הפרויקט | `/project`, `/<campaign>` or `/<campaign>/<ambassador>` | Main menu for signed-in managers | Access migrated; content migration pending |
| פרסים ותחרות | `/prizes` | Main menu for signed-in managers | Access migrated; content migration pending |
| תקנון השתתפות | `/rules` | Campaign footer; homepage footer uses תנאי שימוש | Content migration pending |
| מדיניות פרטיות | `/privacy` | Homepage and campaign footers | Removed from the header; content migration pending |
| דשבורד ניהולי | `/admin` | Manager main menu; guests reach the login screen through header actions | Content migration pending |
| התנתקות | Shared header and `/admin` | Available for any authenticated account | Ends the server session and returns to the homepage |

Direct campaign and prizes URLs show login to guests and an access message to
accounts without manager permission. Successful login resumes the requested
page. Header links retain the selected organization, campaign and ambassador
context, including when opened in a new tab. Legal pages remain public.

The login form works before the session lookup finishes. Session restoration
uses `/api/auth/status?includeCampaigns=false`; successful login/setup returns
the same identity and capability without another status request. Campaign code
is imported only after manager access is confirmed.

Project and Prizes load one `/api/campaign-view` response containing the scoped
presentation configuration, prize rules and donation fields needed for totals
and rankings. Donor contact fields and administrative source/settings payloads
are omitted. Header navigation between these two views retains the application
and revalidates the campaign through the server. Back/forward navigation is
supported; entering the management dashboard loads its full data and settings.

The campaign view, legacy `/api/public-context` and scoped `/public-dataset` endpoints
require manager authorization. Context discovery only considers accessible
campaigns; dataset reads enforce the existing organization and campaign scope
through `campaign_page_view`. The static bundle contains neither donor rows nor
prize data. A hidden menu is not the authorization boundary.

The existing page contents remain in place while they are migrated one at a
time. Campaign-specific logos remain within authenticated campaign content;
the shared header always uses the GoodRaise brand.
