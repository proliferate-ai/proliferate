# Operating

Status: authoritative index for routine operator procedures.

Use this area when the system already exists and an authorized operator needs
to inspect or operate it. Architecture, product behavior, and code ownership
belong under [`../../codebase/`](../../codebase/); incident investigation
starts under [`../debugging/`](../debugging/); deployment and promotion belong
under [`../deploying/`](../deploying/).

## Read Map

- [Analytics and observability](analytics/README.md) — discover and verify
  current Customer.io, Metabase, PostHog, and Sentry state.

## Procedure Rules

- Start with read-only discovery. A provider dashboard is execution-time
  evidence, not repository truth.
- State which deployment modes and permissions a procedure applies to.
- Link to the owning system contract for behavior; do not duplicate it here.
- Never place secret values in CLI arguments, shell history, output,
  screenshots, issues, pull requests, documentation, or chat.
- Require explicit authorization before changing provider or production state.
- Finish with concrete verification and record only sanitized evidence.
