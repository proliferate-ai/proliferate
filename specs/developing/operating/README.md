# Operating

Status: authoritative index for routine operator procedures.

Use this area when the system already exists and an authorized operator needs
to inspect or operate it. Architecture, product behavior, and code ownership
belong under [`../../codebase/`](../../codebase/); incident investigation
starts under [`../debugging/`](../debugging/); deployment and promotion belong
under [`../deploying/`](../deploying/).

## Read Map

| Task | Procedure |
| --- | --- |
| Discover and verify current Customer.io, Metabase, PostHog, and Sentry state | [Analytics and observability](analytics/README.md) |
| Grant a user free or discounted Pro access through Stripe | [Pro early-access promo codes](billing-pro-promo-codes.md) |
| Triage Stripe webhook delivery or billing-mirror failures | [Stripe webhook failure](stripe-webhook-failure.md) |
| Roll an E2B runtime template tag back to an immutable build | [E2B template rollback](e2b-template-rollback.md) |
| Triage cloud sandbox, repository materialization, or workspace creation failures | [Cloud provisioning failure](cloud-provisioning-failure.md) |
| Triage Worker enrollment, heartbeat, or version convergence after checking AnyHarness independently | [Worker enrollment failure](worker-enrollment-failure.md) |
| Prepare for break-glass access, secret rotation, support-bundle handling, or audit closeout | [Operator security posture](operator-security-posture.md) |

## Procedure Rules

- Start with read-only discovery. A provider dashboard is execution-time
  evidence, not repository truth.
- State which deployment modes and permissions a procedure applies to.
- Link to the owning system contract for behavior; do not duplicate it here.
- Never place secret values in CLI arguments, shell history, output,
  screenshots, issues, pull requests, documentation, or chat.
- Require explicit authorization before changing provider or production state.
- Finish with concrete verification and record only sanitized evidence.

## Adding A Procedure

Add a focused procedure when an operation is repeatable, specific enough to
need step-by-step guidance, and not already covered by
[`../deploying/README.md`](../deploying/README.md),
[`../debugging/README.md`](../debugging/README.md), or
[`../local/README.md`](../local/README.md).

Every focused procedure must name:

- required tools and MCP surfaces;
- required permissions;
- the happy path from trigger to verified completion;
- the verification step or dashboard;
- common failure modes and their first response; and
- the applicable secrets policy, including any procedure-specific additions to
  the shared rules above.

Do not publish a procedure for an operation the product cannot perform safely.
Document the current diagnostic boundary and escalate instead of prescribing
manual database mutation, provider destruction, or credential repair.
