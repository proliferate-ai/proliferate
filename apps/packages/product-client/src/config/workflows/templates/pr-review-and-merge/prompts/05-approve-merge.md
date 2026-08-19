Review @doc:merge-readiness, @doc:review-findings, and @doc:review-resolution for @input:pull_request_url.

Approve only when merge readiness says `READY FOR HUMAN APPROVAL`, every receipt names the same accepted head, the observable change matches @input:change_context, and you want the pull request merged. Approval authorizes the next node to merge the reviewed change. It also permits a conflict-free, patch-equivalent rebase if the base branch advances before the merge; it does not permit semantic code changes, new scope, weakened checks, or an unresolved material finding.

If anything is incomplete or the direction is wrong, redo the merge-readiness node with a steering prompt. Do not approve an outdated or ambiguous proof bundle.
