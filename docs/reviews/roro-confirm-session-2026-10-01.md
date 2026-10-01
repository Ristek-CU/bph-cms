# Roro confirmation and session incident — 1 October 2026

## Confirm failure

The production activity log records three failed create_form confirmations around 10:05 UTC. Each attempted to insert 12 form fields with 11 bound values per row (132 parameters), exceeding D1's 100-parameter query limit: https://developers.cloudflare.com/d1/platform/limits/.

The old implementation committed the form before inserting its fields. Each retry left another empty draft. The new implementation inserts the parent and chunks of eight fields in one D1 batch. Replacing fields batches the delete and inserts, preserving old fields if any insert fails. D1 batch rollback semantics: https://developers.cloudflare.com/d1/worker-api/d1-database/#batch.

Tests enforce the production parameter limit, create 12 and 100 fields, replace 100 fields, force a later-chunk failure, and verify rollback. The Roro stream-to-confirm regression checks a 12-question form and an idempotent retry.

## Session handling

The production console alone does not prove why the reported session was rejected. Code inspection found two independent failure paths: auth upstream network/5xx errors were converted to 401, and the constant panel-session marker could let a delayed 401 from a previous login clear a newer login. Upstream network, timeout, 5xx and rate-limit failures now return 503 without granting access or invalidating the browser session. Genuine invalid sessions still return 401. Panel requests capture the session generation, so old responses cannot revoke a new login. Streaming requests use the same generation guard.

Integration tests cover auth outage and invalid session status. Browser regressions verify 503 preserves the marker and delayed 401 cannot revoke a newer session.

## Recovery

Prepared a private backup of the exact affected form rows and proposal. Recovery restores the original draft's 12 fields from its stored proposal, links the confirmed proposal to that form, and removes only two untouched empty retry duplicates. Guards check exact IDs, creator, draft status, unchanged timestamps, no fields and no submissions. No form was published; no unrelated record or submitted response was removed.
