Address the independent verdict in @doc:review-findings for @input:pull_request_url.

Read the repository instructions, @input:change_context, @doc:delivery-record, and the exact current pull-request head. Verify that every finding still targets that head. Apply `BLOCKER` findings and already-resolved `DECISION` findings only. Record `FOLLOW_UP` findings without implementing them. If a finding is stale, incorrect, outside scope, or conflicts with an authoritative requirement, preserve it and answer with exact evidence instead of silently complying.

Make the smallest complete ownership-correct repair. Add or update production-faithful regression coverage that would fail without the fix. Run the affected proof, update the pull-request description and review threads when appropriate, and push safely. Do not weaken gates, redesign the accepted change, merge, or add unrelated cleanup. If the review status is `ACCEPT`, make no code change and record the verified no-op resolution.

Write @doc:review-resolution with the prior and new head revisions, one resolution row per finding, changed files and symbols, verification, disputed findings, remaining blockers, and the exact next action. Update @doc:delivery-record when the durable head or proof changes. Stop with a reviewable pushed head or one material blocker.
