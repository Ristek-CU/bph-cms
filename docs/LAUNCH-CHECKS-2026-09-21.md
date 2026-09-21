# Launch verification — 21 September 2026

## Functional checks

- All eight production accounts (BPH, Ristek, UKM, Advokasi, BNP, ICD, PR, Media) successfully signed in and read their identity, events, forms, Roro history, and usage.
- Only Ristek received HTTP 200 from oversight; the other seven accounts received HTTP 403. Only BPH could access account management.
- All eight production accounts received a real streamed AI reply. These tests created conversations only, not events or published forms.
- The real provider passed normal request → blocked injection → valid event proposal in the same conversation against an isolated local database. Five provider calls totaled 14,280 input and 1,536 output tokens; stored totals matched.
- All 429 backend checks passed. Backend regressions cover permissions, cross-account isolation, blocked-message recovery, streaming usage (including cache tokens), interruption, monthly boundaries, memory usage, and full paginated transcripts.
- Twenty automated browser tests pass, including mobile login mascot, reduced motion, per-role UI, Ristek log details, token/chat ranking, keyboard navigation, and no horizontal overflow.
- API typecheck, panel lint/build, Worker deployment dry run, and production dependency audits passed. Lint reports existing warnings but no errors; dependency audits reported zero known production vulnerabilities.

A production form proposal was generated after an injection block in the same conversation, with exact fields and required flags. The provider then failed during its closing explanation. The follow-up fix preserves that valid proposal and uses a clear deterministic confirmation message when the final provider round fails; a regression test covers this outage. Errors and the successful proposal were both visible to Ristek. Production test conversations were archived after verification.

## What changed

The guard no longer treats ordinary Indonesian “dan” as DAN jailbreak. Blocked turns preserve the conversation ID, are logged with their full text, and do not poison later model context. Form insight now checks permission to read submissions. User data and memory are explicitly treated as untrusted prompt context.

Tokens are recorded per provider call for normal replies, tool/retry rounds, and memory summaries. Streaming errors cannot expose internal exceptions. Ristek can inspect tool inputs/results, blocked messages, token breakdowns, archived conversations, and account rankings by month. Missing provider usage is flagged rather than represented as verified zero consumption.

The login shows an animated Roro mascot with reduced-motion support. Login and sidebar footers show SGA Hub CMS v1.0, deployment workflow sequence/attempt, and source commit. The sequence includes deployment attempts; successful deployments are verified separately in GitHub Actions.

Authentication failures no longer forward upstream bodies containing submitted email/password. Published credential text was removed from current account documentation. Worker observability is enabled with full sampling as a fallback to database event logs.

## Remaining launch blocker

**All eight existing passwords were committed to Git and still worked during the audit. They must be rotated and existing sessions revoked through the identity service before calling the release security-ready.** Removing text from current files does not revoke credentials or erase Git history. Credential rotation/distribution needs the account owner's coordination because users will need to sign in again. No passwords or session tokens are included in this report.

## Coverage limits

- Historical streaming token zeros cannot be accurately reconstructed from visible messages.
- Operational logs and user-deleted conversation audit copies are retained for 90 days. Already-deleted historical data cannot be recovered.
- Browser checks are automated; they do not prove every visual detail or every possible model response is correct.
- Prompt guards plus server authorization reduce risk; a passing test suite is not proof against all future jailbreaks. AI proposals still require explicit confirmation and remain drafts.
