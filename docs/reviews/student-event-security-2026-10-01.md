# Student Event — security and UI review

Reviewed on 1 October 2026. Projects: `bph-cms` and sibling `sga-landing-page`.

## Changes

| Finding | Result |
| --- | --- |
| Panel credentials persisted in localStorage, including a workspace copy | Panel login now uses a Secure, HttpOnly, SameSite=Strict, host-only cookie with an eight-hour browser lifetime. Storage contains only a non-secret session marker; old token copies are removed. |
| Cookie session needs protection against CSRF and cross-origin disclosure | Panel requests require an explicit Authorization marker. Cookie reads reject foreign Origin; writes require matching Origin. Login/logout also require matching Origin. Bearer integrations remain supported. |
| Logout previously cleared browser state only | Panel logout calls the auth service sign-out endpoint and expires the local cookie. The upstream route and Better Auth sign-out implementation were reviewed read-only. |
| Partial event date updates could invert the saved time range | The service validates the merged existing/new timestamps before updating the database. |
| Auth proxy accepted arbitrary JSON fields and unbounded bodies | Only allowed credential fields are forwarded; authentication bodies are limited to 16 KiB. Event JSON bodies are limited to 1 MiB. |
| Login aliases and dynamic detail slugs could divide rate-limit counters | Both login paths share a counter; event-detail slugs share a stable route counter. Public pagination is bounded. |
| Event URLs could embed credentials; LP trusted event response shapes | API rejects credentials in URLs. LP validates list/detail data, discards unsafe URL schemes or embedded credentials, and checks HTTP success. |
| Upcoming event cards were blurred and blocked by an overlay | Published upcoming events are readable and their detail links work. Cards show WIB dates and a day/hour/minute countdown. |
| Sharing could silently fail or falsely report a copied link | Native sharing, explicit WhatsApp, and copy-link actions are available. Failed clipboard writes display an error; cancelled native sharing is respected. Shared text includes title, WIB schedule, and location. |
| Multi-day date labels omitted the ending date | Dates spanning multiple days show both dates in WIB. Finished events hide registration CTA. |
| Social crawlers saw generic SPA metadata | A Cloudflare Worker rewrites title, canonical URL, description, and cover metadata for published event pages. It uses the fixed public CMS API, escapes HTML, rejects unsafe image URLs, and does not store event HTML in cache. Unavailable/unpublished metadata gets a generic preview and noindex. |
| LP lacked security headers | Static assets and event Worker responses now receive CSP, anti-framing, nosniff, referrer policy, and HSTS. CSP permits the existing official Google Maps embed. |
| Dependency audit advisories | Hono, Cloudflare tooling and vulnerable transitive packages were patched; Browserslist lockfile was updated in LP. Native audits report zero known advisories in CMS, panel and LP. |

## Existing controls verified

Published-only public responses and draft detail 404; internal agendas separated from public routes; permission and division ownership checks for event/session mutations; contributor draft-only rules; viewer write denial; platform administrator scope; active memberships; disabled-by-default bootstrap; restricted development authentication; auth failure sanitization; upload permissions, size/type/signature validation; restricted public storage prefix; SQL parameterization; audit trails; public and auth rate limits; CORS origin allowlist; security headers on error responses.

## Validation

- CMS full regression suite: 605 checks passed before the final three request/URL cases. Final security run: **181 checks passed**, including those three cases. TypeScript check passed.
- Panel: **36 UI tests passed**, plus production build.
- LP: TypeScript/production build and contract tests passed; countdown tests cover days, hours, minutes, WIB equivalence, invalid dates, and start boundary.
- Browser checks at **320, 768, 1024 and 1440 px** passed for opening upcoming events, countdown visibility, WhatsApp payload, clipboard success, unsafe URL rejection, no horizontal overflow, and no page errors.
- Metadata Worker tests passed with the real HTMLRewriter in Miniflare: HTML escaping, URL allowlist, canonical/cover metadata, CSP/cache headers, and unpublished event privacy.
- Wrangler deployment dry-run passed with the ASSETS binding. No production deployment was performed.
- Production read-only probe: public events returned **200**; admin events without credentials returned **401** and a generic Unauthorized body. API nosniff, anti-framing, referrer policy and CSP headers were present.

## Deployment implications and scope

Deploy the CMS Worker and its rebuilt panel together; users with old localStorage sessions must sign in again. LP must be deployed with `worker.js` and the updated Wrangler asset binding/routing so event-specific social previews work. A static-only hosting deployment serves the UI but cannot generate the new server metadata. Social platforms may retain their own cached previews after publication.

The completed review verifies these code changes and the listed checks. It is not a comprehensive audit of the upstream auth service, infrastructure IAM, runtime dashboard overrides, or production authenticated flows. Zero package advisories is the current audit result, not a guarantee against unknown vulnerabilities.

## References

- [OWASP REST security](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html): endpoint access control, validation, and request size limits.
- [MDN Web Share API](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share): native sharing and cancellation behavior.
- [Cloudflare static asset headers](https://developers.cloudflare.com/workers/static-assets/headers/): Worker responses need their own security headers.
