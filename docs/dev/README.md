# Development Process

Status: authoritative for day-to-day local development process.

Use this folder for operating procedures: running the product locally.
Architecture and ownership rules stay in the area docs under `docs/frontend`,
`docs/server`, `docs/anyharness`, `docs/proliferate-worker`, `docs/desktop`,
and `docs/ci-cd`.

## Read Order

- [running-locally.md](running-locally.md)
  - full local stack, dev profiles, local Stripe, web, desktop, and mobile
    testing

PR title, label, release-note, and checklist rules live in
[`docs/ci-cd/README.md`](../ci-cd/README.md) and
[`../../.github/pull_request_template.md`](../../.github/pull_request_template.md).

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
