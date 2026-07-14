# Development Procedures

Status: current procedure index

Use this area to perform and verify work. System architecture, code ownership,
and product behavior belong under [`../codebase/`](../codebase/).

## Read Map

| Task | Start here |
| --- | --- |
| Set up or run a local worktree, profile, Stripe, Web, Desktop, or Mobile | [`local/README.md`](local/README.md) |
| Write or run automated tests and release qualification | [`testing/README.md`](testing/README.md) |
| Investigate a local or production defect | [`debugging/README.md`](debugging/README.md) |
| Change CI, package, release, deploy, or promote | [`deploying/README.md`](deploying/README.md) |
| Inspect or operate analytics, engagement, and observability providers | [`operating/analytics/README.md`](operating/analytics/README.md) |
| Run manual release QA | [`testing/manual-release-qa.md`](testing/manual-release-qa.md) |
| Follow a focused operational runbook | [`runbooks/README.md`](runbooks/README.md) |
| Find environment and command reference data | [`reference/README.md`](reference/README.md) |

PR title, label, release-note, and checklist rules live in
[`deploying/ci-cd.md`](deploying/ci-cd.md) and
[`../../.github/pull_request_template.md`](../../.github/pull_request_template.md).

## Procedure Contract

A focused procedure should answer only what the operator needs:

```text
When to use
Prerequisites and access
Steps
Verification
Failure or rollback
What to report
```

Name concrete commands, workflows, tools, dashboards, permissions, and
configuration when they are required. Link to the canonical environment
reference instead of copying secret values. Never paste secrets into a
document, chat, PR, or log.

Parent README files may own shared prerequisites, access rules, and report
shape. Leaf procedures should state only their deltas instead of repeating the
same boilerplate.

## Operating Rules

- Use one named local profile per worktree.
- Keep local profile and runtime state isolated from the branch under test.
- Use the narrowest verification that proves the change, then add broader
  checks when crossing an API, runtime, or release boundary.
- Begin production debugging from the durable support or issue artifact when
  one exists, then follow its identifiers into the owning systems.
- Keep temporary debugging artifacts out of commits unless they are the
  requested output.
- Documentation must describe the procedure that works now; implementation
  progress and future cleanup plans belong in the delivery tracker.
