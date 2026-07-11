# Development Process

Status: authoritative for day-to-day local development process.

Use this folder for developer processes: running the product locally,
deploying and releasing, debugging production and local issues, operating
analytics surfaces, and running QA. Architecture and ownership rules stay in
the area docs under `specs/codebase/structures/**`.

## Read Order

- [local/README.md](local/README.md)
  - full local stack, dev profiles, local Stripe, web, desktop, and mobile
    testing
- [deploying/README.md](deploying/README.md)
  - CI, PR metadata, staging deploys, production promotion, desktop releases,
    runtime releases, E2B template releases, and deployment infra
- [debugging/README.md](debugging/README.md)
  - support issue triage, local debugging, diagnostics, tenant correlation, and
    performance profiling
- [analytics/README.md](analytics/README.md)
  - Customer.io, Metabase, PostHog, Sentry, anonymous telemetry, ownership, and
    freshness expectations
- [qa/README.md](qa/README.md)
  - release QA process and per-surface verification checklist
- [testing/core-release-validation.md](testing/core-release-validation.md)
  - complete automated Tier 2/3/4 core-flow manifest and exact-SHA release
    qualification contract
- [runbooks/README.md](runbooks/README.md)
  - specific, repeatable operational runbooks (billing promo codes, Stripe
    webhook failures, E2B template rollback, and future cloud/worker/sandbox
    operational procedures)
- [reference/README.md](reference/README.md)
  - canonical environment variable inventory, secrets matrix, and workspace
    command environment reference

## Developer Process Map

| Process bucket | Current owner |
| --- | --- |
| Deploying / updating to production / infra | [deploying/README.md](deploying/README.md), [deploying/ci-cd.md](deploying/ci-cd.md), and self-hosted deploy docs. |
| Environment variables and where they live | [reference/README.md](reference/README.md), [reference/env-vars.yaml](reference/env-vars.yaml), and [reference/env-secrets-matrix.md](reference/env-secrets-matrix.md). |
| Developing locally with profiles, Stripe, and mobile | [local/README.md](local/README.md), [local/dev-profiles.md](local/dev-profiles.md), [local/stripe-local-testing.md](local/stripe-local-testing.md), and [local/mobile.md](local/mobile.md). |
| Debugging and support issue triage | [debugging/README.md](debugging/README.md), [debugging/support-reports.md](debugging/support-reports.md), and [debugging/performance-profiling.md](debugging/performance-profiling.md). |
| Analytics and keeping observability fresh | [analytics/README.md](analytics/README.md) plus the Customer.io, Metabase, PostHog, Sentry, and anonymous telemetry docs in that folder. |
| Automated qualification and release QA | [testing/core-release-validation.md](testing/core-release-validation.md), [testing/README.md](testing/README.md), and [qa/README.md](qa/README.md), with feature-specific acceptance criteria under [../codebase/features/](../codebase/features/) and primitive smoke expectations under [../codebase/primitives/](../codebase/primitives/). |

PR title, label, release-note, and checklist rules live in
[`deploying/ci-cd.md`](deploying/ci-cd.md) and
[`../../.github/pull_request_template.md`](../../.github/pull_request_template.md).

## Process Spec Contract

Every durable developer process spec in this folder must make the operator
path explicit. A process is not documented enough until it names:

- the GitHub workflows, scripts, dashboards, hosted services, and local tools
  that own the process
- the MCPs, connectors, CLIs, or browser surfaces an agent or human operator
  needs to use
- the user permissions required, such as GitHub environment approval, repo
  write access, AWS deploy role access, Vercel team access, Expo/App Store
  Connect access, Stripe access, or analytics admin access
- the configuration and environment variables the process depends on, with a
  link to `specs/developing/reference/env-vars.yaml` when the values are canonical
  deployment variables
- the normal happy path from request to verification
- the exact verification commands or dashboards that prove the process worked
- the failure modes that are common enough to have a first response
- the secrets policy, including where values live and what must never be pasted
  into chat, docs, PRs, or logs
- the final report shape an agent should give back to the user

Developer process specs belong here under `specs/developing/**`. Architecture,
ownership, and product behavior still belong under `specs/codebase/structures/**`,
`specs/codebase/primitives/**`, and `specs/codebase/features/**`.

## Operating Rules

- Use a named dev profile for full-stack product work.
- Keep profile state isolated from the branch or worktree under test.
- Run mobile against the same profile state when testing web/mobile parity.
- Enable Stripe locally only when billing, checkout, portal, subscriptions,
  refill, or webhook behavior is part of the task.
- Start debugging from the durable support artifact or GitHub issue when one
  exists, then follow the linked workspace/session/tenant ids into Cloud and
  observability tools.
- Keep analytics docs current when product events, lifecycle emails, Sentry
  projects, dashboards, or replay/privacy posture changes.
- Keep QA checklists tied to release surfaces so a release operator can verify
  only what actually shipped while still seeing skipped surfaces.
- Use the narrowest verification that proves the change, then add broader
  checks when the change crosses an API, runtime, or release boundary.
- Keep debugging artifacts out of commits unless the artifact is itself the
  requested output.
