Converge @input:pull_request_url on a merge-ready exact head without merging it.

Read the repository and pull-request guidance plus @doc:delivery-record, @doc:review-findings, and @doc:review-resolution. Live repository and pull-request state supersede stale receipts. Keep the accepted change in @input:change_context fixed.

Establish all of these conditions on the same final head:

- the pull request is open, reviewable, and based on the current base-branch head;
- the patch still matches the independently reviewed change;
- every required status check passes;
- the configured automated code-review gate reports its maximum `5/5` score on that exact head, with no unresolved actionable finding;
- all human and automated review threads are resolved or explicitly classified as non-actionable;
- the pull-request description accurately records scope, tests, documentation, and observability; and
- the branch is mergeable under the repository's normal policy.

If the base branch advances, rebase with an explicit lease, preserve patch equivalence, rerun affected production-faithful proof, and repeat exact-head checks. If code or semantics change after the independent review, obtain a fresh read-only review in a separate delegated session or workspace when that capability exists. Repair accepted material findings narrowly, push, and repeat until the exact final head is accepted. If independent review is unavailable, the automated review does not name the final head, a required check cannot run, or a semantic conflict needs human judgment, stop as not ready. Never replace a missing gate with self-attestation, weaken a test, or merge from this node.

Wait for pending checks. Rerun an unchanged infrastructure failure only after proving it is not a product failure; fix pull-request-owned failures within scope and re-review the resulting head. Before finishing, fetch the base branch once more so the ancestry receipt is current.

Write @doc:merge-readiness with status `READY FOR HUMAN APPROVAL` or `NOT READY`, exact base and head revisions, ancestry, mergeability, independent-review receipt, every check, automated-review score and head, unresolved-thread count, local proof, pull-request-description audit, blockers, and the precise change the human would authorize. Do not merge.
