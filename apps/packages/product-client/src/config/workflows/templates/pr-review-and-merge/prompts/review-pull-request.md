Independently review the exact pull-request head recorded in @doc:delivery-record against @input:change_context.

This is a read-only review. Rebuild understanding from the accepted context, repository guidance, exact base-to-head diff, raw tests, and live pull-request evidence. Do not rely on the preparer's conversation. Confirm the worktree and remote head are pinned before judging the change. Do not edit code, amend commits, push, merge, resolve threads, or change pull-request metadata.

Inspect correctness, behavior preservation, ownership, ordering, lifecycle and failure handling, permissions and security, persistence and migrations, compatibility, test realism, documentation, observability, and pull-request scope. Report only material findings. Every finding needs a stable `RV-NN` identifier, class (`BLOCKER`, `DECISION`, or `FOLLOW_UP`), concrete counterexample, exact code evidence, expected versus actual behavior, owner, and proof required to close it. Omit style nits and speculative redesigns.

Write the verdict and findings to @doc:review-findings. Use `ACCEPT`, `REPAIR REQUIRED`, or `HUMAN DECISION REQUIRED` as the status. If this is a later review of a changed head, retain prior finding history and verify every existing identifier against the new exact head. Stop after the review artifact is complete.
