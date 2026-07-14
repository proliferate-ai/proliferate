# Runbooks

Status: authoritative index for operational runbooks.

Runbooks cover specific, repeatable operations that do not fit the general
deploying, debugging, or local-dev process docs. Each runbook names the tools,
permissions, happy path, verification, and failure modes for one operation.

## Runbook Map

| Runbook | Operation |
| --- | --- |
| [billing-pro-promo-codes.md](billing-pro-promo-codes.md) | Grant a user free or discounted Pro access via a Stripe promotional code. |
| [stripe-webhook-failure.md](stripe-webhook-failure.md) | Triage and recover Stripe webhook delivery or billing mirror failures. |
| [e2b-template-rollback.md](e2b-template-rollback.md) | Roll an E2B cloud runtime template rolling tag back to a known-good immutable build. |
| [cloud-provisioning-failure.md](cloud-provisioning-failure.md) | Triage cloud sandbox connection, repository materialization, and workspace creation failures. |
| [worker-enrollment-failure.md](worker-enrollment-failure.md) | Triage Worker enrollment, heartbeat, and version-convergence failures after checking AnyHarness independently. |
| [operator-security-posture.md](operator-security-posture.md) | Baseline for break-glass access, secret rotation, support bundle handling, and audit closeout. |

## Adding A Runbook

Add a runbook when an operation is:

- repeatable and specific enough to need step-by-step operator guidance
- not already covered by [`../deploying/ci-cd.md`](../deploying/ci-cd.md),
  [`../debugging/README.md`](../debugging/README.md), or
  [`../local/README.md`](../local/README.md)

Every runbook must name:

- required tools and MCPs
- required permissions
- happy path from trigger to verified completion
- verification step or dashboard
- common failure modes and first response
- secrets policy (no secrets in chat, docs, PRs, or logs)

Do not publish a runbook for an operation the product cannot perform safely.
Document the current diagnostic boundary and escalate instead of prescribing
manual database mutation, provider destruction, or credential repair.
