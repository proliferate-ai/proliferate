Prepare @input:pull_request_url for an independent post-implementation review.

Read the repository instructions and pull-request guidance first. Treat @input:change_context as the desired-behavior authority and the repository, exact diff, tests, and live pull-request state as the current-behavior authority. Resolve the repository, base branch, pull-request branch, linked issue, and exact revisions yourself. Do not ask the user to supply bookkeeping.

Inspect the pull-request description, existing review threads, status checks, changed files, and commit history. Rebase onto the current base-branch head when required. Preserve the intended patch, resolve conflicts narrowly, and use a lease-protected force push only when a rebase makes it necessary. Never weaken a check, change repository rules, or absorb unrelated defects to make the branch green.

Address existing actionable in-scope failures or review comments, run the narrowest production-faithful tests that establish the changed behavior, and update the pull-request description with the actual testing, documentation, and observability impact. Push a clean reviewable head. Do not merge or mark a draft ready unless the repository's own process requires it at this stage.

Write @doc:delivery-record with the exact base and head revisions, accepted change context, diff scope, changes made during preparation, tests and checks run, unresolved blockers, and the next review action. Stop when the durable pull-request head is ready for a fresh read-only review or one material blocker is recorded.
