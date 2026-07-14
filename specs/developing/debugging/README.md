# Debugging

Status: authoritative for developer-facing debugging process.

Use this folder for issue triage, support-report correlation, production/local
debugging, and performance profiling. Product behavior belongs under
`specs/codebase/**`; this folder owns operator workflow.

## Start From The Symptom

Write down what failed, where it failed, and when it was observed before
collecting more context. Start with the strongest stable id already available.
For a support report, use the support report id. Otherwise use the user id,
surface, and exact version or source revision when available.

Do not request every possible correlation id up front. Add an id only when it
helps cross the seam that is actually failing:

| Failing seam | Add only what is useful |
| --- | --- |
| Hosted account, auth, billing, or control-plane request | organization id, workspace id, or request id |
| Sandbox provisioning or repository setup | sandbox/provider id or materialization id |
| Runtime, transcript, or agent session | AnyHarness workspace id or session id |
| Worker connection or remote execution | Worker id and the relevant request id |
| Desktop or mobile crash | app version, platform, and matching Sentry event |
| Deploy, updater, or release regression | release artifact, deploy run, and source revision |

The goal is the smallest evidence set that can locate and reproduce the
failure, not a complete inventory of the user's environment.

## Investigate The Failing Seam

1. Confirm the symptom, affected surface, environment, observation time, and
   version or revision.
2. If a support report exists, use its stable id to retrieve the durable report
   and diagnostics. The current private Support path provides durable capture
   plus best-effort Slack delivery. It does not automatically create a GitHub
   or Linear issue and does not run autonomous triage or fixes.
3. Choose the failing seam, then collect only the correlation ids required to
   move between that seam's product state, logs, Sentry events, or provider
   state.
4. Check recent deploys or artifacts when timing suggests a release, updater,
   runtime, Worker, or infrastructure regression.
5. Inspect the narrowest source of evidence for the seam: a failing request,
   Sentry event, sanitized log tail, workflow run, provider state, or retained
   support diagnostic.
6. Reproduce with an isolated local profile when code inspection or controlled
   state is needed. Follow [Local Development](../local/README.md).
7. Record the diagnosis, proof, fix or remaining owner, and user follow-up. If
   durable issue tracking is needed, search for an existing issue before
   creating or updating one; do not assume Support already did so.

## Tools And Access

Use only the tools needed for the failing seam:

- GitHub access for issues, PRs, workflow runs, deploys, and release artifacts.
- Sentry for production exceptions, native crashes, releases, and matching
  support correlation tags.
- Approved support tooling for support reports and retained diagnostics; do
  not make report objects public.
- AWS, Vercel, E2B, Stripe, PostHog, Metabase, Customer.io, Expo/EAS, or App
  Store Connect only when that provider owns evidence for the failing seam.
- An isolated local profile for reproduction:

  ```bash
  make setup PROFILE=<name>
  make build # first clean worktree or after generated/Rust/frontend artifacts change
  make run PROFILE=<name>
  ```

Use an appropriately authorized account. Keep secrets, raw user content, and
unredacted diagnostics out of issues, chat, shared logs, and documentation.
Start provider investigation read-only. If private or provider access is
unavailable, retain the stable id and hand off to an authorized operator
without asking them to copy raw evidence; any provider or production write
requires separately approved remediation scope and the applicable runbook.

## Focused Runbooks

- [support-reports.md](support-reports.md): retrieve, correlate, and close out a
  private support report.
- [performance-profiling.md](performance-profiling.md): capture privacy-safe
  renderer and AnyHarness timing baselines.
- [../runbooks/stripe-webhook-failure.md](../runbooks/stripe-webhook-failure.md):
  inspect and recover Stripe webhook delivery failures.
- [../runbooks/e2b-template-rollback.md](../runbooks/e2b-template-rollback.md):
  roll back a managed-cloud E2B runtime release.
- [../operating/analytics/sentry.md](../operating/analytics/sentry.md): inspect
  Sentry projects, releases, alerts, privacy behavior, and support tags.
- [../deploying/ci-cd.md](../deploying/ci-cd.md): investigate deploy and release
  failures.

## Closeout

Leave a concise record containing:

- the symptom, surface, environment, and exact version or revision;
- the stable starting id and only the seam-specific ids used;
- the shortest confirmed reproduction, or why it could not be reproduced;
- the evidence checked and the resulting diagnosis;
- the linked fix, deploy, remaining owner, and required user follow-up; and
- confirmation that secrets and sensitive user content were omitted.
