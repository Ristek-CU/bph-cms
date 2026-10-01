# Student Event production deployment — 1 October 2026

## Deployment

| Service | Production URL | Active version | Previous rollback version |
| --- | --- | --- | --- |
| CMS and panel | https://cms.sga-cakrawala.org | `94799ae8-3b69-4be4-a9d9-04845e8cf10d` | `34c4d93b-99d5-46a4-8b98-ef2007670a66` |
| Landing page | https://sga-cakrawala.org | `65045d51-84df-4496-b4f9-cacef43f34ff` | `574c391f-ecc3-4140-8a63-aa0822937635` |

CMS also serves the legacy domain https://bph-cms.sga-cakrawala.org. D1 migration check found no outstanding migrations. Existing auth, D1, R2, rate-limit, scheduled trigger and dashboard variables were preserved. LP deployment now explicitly targets its existing custom domain and includes the ASSETS binding and event metadata Worker.

## Production API checks

- CMS D1 health: HTTP 200.
- Public published event list: HTTP 200.
- Unauthenticated admin denied on https://cms.sga-cakrawala.org: HTTP 401.
- Remote dev-token denied on https://cms.sga-cakrawala.org: HTTP 401.
- Unauthenticated admin denied on https://bph-cms.sga-cakrawala.org: HTTP 401.
- Remote dev-token denied on https://bph-cms.sga-cakrawala.org: HTTP 401.
- Draft/missing public event hidden: HTTP 404.
- Excessive public page rejected: HTTP 422.
- Panel cross-origin login denied: HTTP 403.
- Panel cross-origin session write denied: HTTP 403.
- Panel marker without valid cookie denied: HTTP 401.
- Auth invalid JSON rejected: HTTP 400.
- Auth validation does not echo credentials: HTTP 401.
- Foreign CORS origin denied: HTTP 204.
- Published detail minisoccer-mingguan-mahasiswa-cakrawala-x-dibimbing: HTTP 200.
- Published detail launching-resmi-sga-cms-hub-dashboard-digital-pengurus-organisasi-sga-cakrawala: HTTP 200.

## Production authentication checks

- Signup strips privilege injection and returns default user.
- Production panel login succeeds with HttpOnly Secure Strict host cookie.
- Live cookie session validates through AUTH_SERVICE.
- Default account without CMS membership denied admin access.
- Real authenticated cookie cannot mutate from foreign Origin.
- Production logout expires browser session cookie.
- Logout revokes upstream session: replayed old cookie returns 401.
- Temporary QA account and sessions removed with exact identity checks.

A uniquely named QA account with a random password was created only for this test. It received no CMS membership or elevated role. Cleanup matched its exact ID, email and fixture name, then verified the user and its sessions were gone. Credentials were not printed or saved to the report.

## Production UI and social preview checks

- Live event social metadata and document security headers.
- Real production event and share UI at 320px.
- Real production event and share UI at 768px.
- Real production event and share UI at 1024px.
- Real production event and share UI at 1440px.
- Deployed countdown UI with browser-only upcoming fixture (no production record created).
- Production panel login screen loads.

Both published events are currently past events. Countdown rendering was verified on the deployed production frontend using a browser-only upcoming response fixture; no new event was published or production event record changed. Authenticated admin event writes and the complete role matrix were covered by the local integration suite, not by production admin mutations.

## Build and pre-deploy gates

- CMS TypeScript check and panel production build passed.
- LP production build and contract/countdown tests passed.
- Local CMS full regression suite passed; final security run passed 181 checks; panel passed 36 UI tests.
- Dependency audits previously reported zero known advisories for CMS, panel and LP.

## Rollback

Use Wrangler rollback with the exact previous version ID for the affected Worker. No database schema migration was performed by this release. Rollback reinstates the previous session implementation; users may need to sign in again.

Production was initially deployed directly using the authenticated Wrangler session. The corresponding source changes are maintained on main in both repositories. CMS pushes to main trigger the production deployment workflow; the landing page is released using Wrangler to its existing custom domain. The version IDs above identify the initial verified release.
