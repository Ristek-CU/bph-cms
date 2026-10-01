# Roro streaming and multi-draft audit — 1 October 2026

## Evidence and causes

Read the operational events for the two reported conversation IDs. Their three streaming failures occurred exactly at 20,000 ms, after text or tool progress had started. The first provider attempt used a 20-second absolute timeout; any emitted event disabled retry, so the longer request budget was ineffective.

The same transcript shows three valid create_internal_event calls in one turn. A single variable was overwritten for each call, leaving only the last draft available for confirmation. No missing drafts were recreated automatically from the old transcript: their dates or details may have since changed.

Seven-day aggregate audit: 36 chat requests, six provider failures (three streaming timeouts, two response timeouts, one connection interruption). No other error category was recorded in this window. This review is scoped to the stored operational logs, not every upstream provider log.

## Changes

- Use a bounded 120-second round deadline, a 150-second total provider budget and a 180-second browser deadline for active streaming instead of cancelling at 20 seconds.
- Prefer provider reliability routing. A synthetic three-event test on the latency route still timed out at 60 seconds; reliability returned all three calls in 8.8 seconds; the final adapter with the updated default returned all three in 7.3 seconds. A repeat reliability call progressed slowly and exceeded 60 seconds; this motivated the coordinated longer server/browser budgets instead of promising consistent low latency. Retry uses the alternate route only before output, preventing duplicated text or actions.
- Allow up to 20 validated draft proposals per turn. Store a separate pending message and confirmation claim for each; return and display all cards immediately and on history reload.
- Preserve partial text with an explicit interruption notice. Interrupted or length-truncated tool arguments are not executed.
- Bound event frames, tool input size and tool count; increase output budget for multiple drafts.
- Include draft data/status in bounded conversation context for follow-up edits.
- Support organizational planning, rundown, announcements, program ideas, task breakdowns and summaries. Unsupported actions must be described honestly.
- Keep server-enforced RBAC, division scope, schema validation, draft-only creation, explicit per-card confirmation and idempotent retry. Check permissions even on retries of already executed proposals.
- A request containing both public activities and an internal meeting can propose both kinds; meeting titles still cannot be proposed as public events.

## Verification

Full CMS regression suite, focused streaming/guard tests, API typecheck and panel build/lint. Browser tests cover all multi-draft cards, draft revision, failed follow-up recovery and existing mobile interactions. New integration tests create three internal drafts and two student event drafts, deny cross-account confirmation, verify no creation before confirmation, distinct IDs, draft status, retry idempotency and revoked permissions.

Live provider tests use synthetic data and invoke only the provider adapter: no production event is created or published. Provider availability cannot be guaranteed by application changes. An unfinished response produces a recoverable notice; it must never claim successful creation.
