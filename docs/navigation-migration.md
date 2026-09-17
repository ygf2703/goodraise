# Navigation migration

The landing page and all campaign, legal and admin pages share one persistent
`Header` component from `apps/web/src/components/Header.tsx`. `ApplicationRouter`
owns the header, skip link and footer outside the replaceable route frames.
The build server-renders the homepage into the same shell, retaining its content
before JavaScript starts; preparation extracts its markup from `work/goodraise-landing.html`.
`work/assets/site-header.css` and `site-header.js` provide the shared appearance,
session-aware navigation and mobile menu behavior.

Guests see homepage section links, `/login`, and a separate “start fundraising”
CTA that remains outside the existing-user login flow. After login, all approved
accounts see “my projects”; site admins also see campaign applications and
`/admin/users`. Campaign-specific links are not part of the global header. Logout is available
to every authenticated account.

| Existing destination | Direct URL | Current navigation | Migration status |
| --- | --- | --- | --- |
| כניסת משתמש קיים | `/login` | Guest header | Implemented; approval required before first-password setup |
| הפרויקטים שלי | `/admin` | Authenticated header | Implemented; explicit navigation always opens the active/completed selector |
| ניהול משתמשים | `/admin/users` | Site-admin header | Implemented; approvals, roles, memberships and deactivation |
| דף הפרויקט | `/project`, `/<campaign>` or `/<campaign>/<ambassador>` | Local navigation inside an accessible campaign | Access migrated; content migration pending |
| פרסים ותחרות | `/prizes` | Local navigation inside an accessible campaign | Access migrated; content migration pending |
| תנאי שימוש ותקנון השתתפות | `/rules` | Shared footer on every page | Content migration pending |
| מדיניות פרטיות | `/privacy` | Shared footer on every page | Removed from the header; content migration pending |
| הצהרת נגישות | `/accessibility` | Shared footer on every page | Public statement; direct contact details and independent audit pending |
| ניהול הקמפיין | `/admin?organizationId=…&campaignId=…` | Project card and analyst+ local campaign navigation | Content migration pending |
| התנתקות | Shared header and `/admin` | Available for any authenticated account | Ends the server session and returns to the homepage |

Direct private campaign and prizes URLs redirect guests to `/login` with a safe
return target. Successful login resumes the requested page only if the scoped
authorization succeeds. Local campaign links retain the selected organization, campaign
and ambassador context, including when opened in a new tab. Legal pages remain public.

When login opens the project selector, the URL is replaced with `/admin` without
an extra page reload. `/admin` and `/admin/users` have separate headings and
content: the selector never initializes or fetches the account editor, and the
user-management page hides the project lists. The single-project shortcut applies
only to login; explicit `/admin` links, including “back to my projects”, always show
the selector. Authorization checks are unchanged.

Each project card is one real link with a visible shared-style action: management
for managers, data viewing for analysts, and campaign/archived-summary viewing for
viewers. Inside a selected campaign, `CampaignNavigation` shows its name, a back
link, and the three campaign destinations with the active page marked. It stays
hidden until the controller has authorized a server-resolved campaign scope; the
management link is omitted for viewers. Links and the name update together when
the selected campaign changes and disappear on lost access. No campaign is chosen
implicitly by a global dashboard button.

The shared header identifies destinations with `data-site-page`; the current
visible destination receives `aria-current="page"` and an active visual marker.
`getSitePage` resolves direct URLs, while `setSitePage` updates the browser title
and selection after authentication and in-app campaign/prize navigation. This
keeps the project selector distinct from the campaign-scoped `/admin?...` dashboard.

`ApplicationRouter` handles same-tab homepage, help, archive, application, login,
management, legal, campaign and prize routes
without a document reload. It pauses the previous route's requests/timers, prepares
the destination in a detached React portal and attaches it only after session and
page data are ready. The previous DOM stays in place beneath the fixed loading
overlay, with background interaction disabled. Detached preparation avoids
duplicate IDs or unfinished/login content appearing in the live document.
Back/Forward cancel stale preparation; direct links still work through the server.
External links, downloads, same-page fragments and modified/new-tab clicks
retain native browser behavior. Cross-page homepage anchors scroll after the new
content is attached. Active campaign project/prize links
keep their existing one-request revalidation rather than remounting the controller.

The first application's content stays hidden until ready, preventing the guest-login
flash on direct authenticated loads; the shared header remains in place. The
server-rendered homepage is visible immediately. Header actions reserve space
during the initial session check; subsequent navigation reuses the session-aware
header without repeating that lookup. A late header response cannot overwrite a
newer login result. The blue CTA has a stable width, active links keep their usual
font weight, and every route uses the same font stylesheet. The overlay lives outside page layout, uses
stable scrollbar space and releases on handled load failures. No private rendered
page or API result is persisted for navigation caching. A delayed, read-only local
proxy check confirmed unchanged document identity and heading position while the
next page loaded; a failed users-list request displayed its error and released the
overlay.

Completed campaigns use anonymous read-only routes: `/campaigns` lists the archive and `/campaigns/:organization/:campaign` shows a minimal historical detail page. Homepage carousel cards link to these scoped URLs, avoiding campaign-slug collisions between organizations.

The login form works before the session lookup finishes. Session restoration
uses `/api/auth/status`; login/setup responses are enriched with the explicit
accessible-campaign portfolio before routing. Campaign code is imported only
after assigned access is confirmed; the account selector is a separate typed module.

Project and Prizes load one `/api/campaign-view` response containing the scoped
presentation configuration and prize rules. Viewer responses contain aggregate
campaign/ambassador totals and no donation rows. Analyst+ campaign views receive
redacted rows; donor contact fields and source/settings payloads are omitted.
Local navigation between these two views retains the application
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
