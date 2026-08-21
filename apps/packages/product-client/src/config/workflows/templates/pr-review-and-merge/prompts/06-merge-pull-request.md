Merge @input:pull_request_url under the approval immediately before this node.

Read the repository's merge policy and @doc:merge-readiness. Confirm the pull request is still open and the live head still represents the approved patch. Immediately before merging, verify mergeability, base ancestry, required checks, the exact-head `5/5` automated-review gate, and zero unresolved actionable threads.

If the base branch advanced after approval, a conflict-free rebase is allowed only when a range comparison proves the approved patch is equivalent. Push it with an explicit lease, run the affected production-faithful proof, obtain a fresh independent exact-head review, and wait for all exact-head gates again. Do not make semantic fixes after approval. Stop without merging if the patch changed, a conflict needs judgment, a new material finding appears, any required gate is missing, or the pull-request head changed unexpectedly.

When every gate is current on one head, merge with the repository's standard strategy. Confirm the resulting commit is on the base branch. Close @input:issue_url only when it names the issue completed by this merge and the provider did not close it automatically.

Write @doc:merge-receipt with `MERGED` or `BLOCKED`, the approved and final heads, final base head, gate receipts, merge commit, linked-issue result, and any blocker. Do not begin follow-up work after the merge.
