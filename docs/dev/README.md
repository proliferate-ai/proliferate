# Development Process

Status: authoritative for day-to-day local development process.

Use this folder for operating procedures: running the product locally,
preparing PRs, and deploying to staging or production. Architecture and
ownership rules stay in the area docs under `docs/structures/**`.

## Read Order

- [running-locally.md](running-locally.md)
  - full local stack, dev profiles, local Stripe, web, desktop, and mobile
    testing
- [ci-cd.md](ci-cd.md)
  - CI, PR metadata, staging deploys, production promotion, desktop releases,
    runtime releases, E2B template releases, and deployment infra
- [billing-pro-promo-codes.md](billing-pro-promo-codes.md)
  - granting free / discounted Pro via Stripe coupons and per-person promotion
    codes

PR title, label, release-note, and checklist rules live in
[`ci-cd.md`](ci-cd.md) and
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
- the normal happy path from request to verification
- the exact verification commands or dashboards that prove the process worked
- the failure modes that are common enough to have a first response
- the secrets policy, including where values live and what must never be pasted
  into chat, docs, PRs, or logs
- the final report shape an agent should give back to the user

Developer process specs belong here under `docs/dev/**`. Architecture,
ownership, and product behavior still belong under `docs/structures/**`,
`docs/primitives/**`, and `docs/features/**`.

## Operating Rules

- Use a named dev profile for full-stack product work.
- Keep profile state isolated from the branch or worktree under test.
- Run mobile against the same profile state when testing web/mobile parity.
- Enable Stripe locally only when billing, checkout, portal, subscriptions,
  refill, or webhook behavior is part of the task.
- Use the narrowest verification that proves the change, then add broader
  checks when the change crosses an API, runtime, or release boundary.
- Keep debugging artifacts out of commits unless the artifact is itself the
  requested output.
