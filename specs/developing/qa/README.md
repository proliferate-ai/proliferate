# QA

Status: authoritative entry point for release QA and manual verification.

Use this folder for release QA process, smoke matrices, surface-specific
manual checks, and final QA reporting. Feature-specific acceptance criteria
stay in the owning feature or primitive spec under `specs/codebase/**`; this
runbook owns how an operator plans, executes, records, and reports a QA pass.

## Read Order

- [../README.md](../README.md)
  - developer process contract, required tools, permissions, and final report
    shape for process docs
- [../local/README.md](../local/README.md)
  - profile-backed full-stack local testing, local Stripe, hosted web, desktop,
    mobile web, native mobile, and verification commands
- [../deploying/ci-cd.md](../deploying/ci-cd.md)
  - CI gates, deploy verification, release lanes, updater publishing,
    TestFlight, E2B templates, and production/staging promotion
- [../debugging/README.md](../debugging/README.md)
  - support issue triage, tenant/session correlation, diagnostics, Sentry, and
    production/local investigation workflow
- [../analytics/README.md](../analytics/README.md)
  - Customer.io, Metabase, PostHog, Sentry, anonymous telemetry, and freshness
    expectations when QA changes analytics surfaces

Read feature specs when the release touches their workflows:

- [../../codebase/features/web-cloud-local-parity.md](../../codebase/features/web-cloud-local-parity.md)
  for Web/Mobile/Desktop cloud workspace parity and fixture matrix
- [../../codebase/features/mobile-cloud-client.md](../../codebase/features/mobile-cloud-client.md)
  for mobile cloud-client smoke coverage
- [../../codebase/primitives/workspace-lifecycle.md](../../codebase/primitives/workspace-lifecycle.md)
  for workspace archive, restore, cleanup, and profile-isolated QA
- [../../codebase/primitives/billing.md](../../codebase/primitives/billing.md)
  for billing, credits, Stripe checkout, refill, and portal smoke coverage
- [../../codebase/features/chat-composer.md](../../codebase/features/chat-composer.md)
  for composer playground verification

## Operator Requirements

Required tools and surfaces:

- GitHub MCP, `gh`, or GitHub web access for PRs, issues, labels, CI runs,
  release notes, workflow artifacts, and linked support reports.
- Local shell access in a clean worktree with Rust, Node 22+, pnpm, Python
  3.12, and `uv`.
- Browser or Chrome access with the right logged-in profile for local Web,
  Desktop renderer, GitHub, Stripe, PostHog, Sentry, Customer.io, Metabase,
  Vercel, Expo, Apple, or AWS dashboards.
- Local dev profiles through `make dev-init PROFILE=<name>` and
  `make dev PROFILE=<name>`.
- Stripe CLI when billing checkout, portal, subscription, refill, meter, or
  webhook behavior is in scope.
- Expo/EAS and an iOS/Android simulator or device when native mobile behavior,
  OAuth redirects, deep links, keyboard behavior, or TestFlight submission is
  in scope.
- AWS CLI, Vercel CLI, or E2B/provider access when QA must inspect hosted
  deploy lanes, cloud worker logs, public templates, or production runtime
  state.

Required permissions:

- GitHub repo read access for PRs, issues, Actions logs, artifacts, and release
  notes.
- GitHub repo write access when the QA operator may label issues/PRs, update
  the release checklist, or push a fix.
- GitHub environment approval rights when QA is part of a staging or production
  promote.
- Access to staging and production app accounts that are safe for smoke tests.
- Stripe test-mode access for local or staging billing QA; production Stripe
  access only for read-only verification unless an explicit release operation
  requires more.
- Sentry, PostHog, Customer.io, and Metabase access when the release changes
  events, replay, lifecycle messaging, dashboards, alerts, or support
  correlation.
- AWS/Vercel/E2B/Expo/App Store Connect access only for the surfaces that the
  release or incident actually touches.

Secrets policy:

- Do not paste secret values, refresh tokens, cookies, auth headers, private
  keys, Sentry DSNs, Stripe keys, webhook secrets, GitHub App private keys,
  Apple credentials, or AWS credentials into chat, PRs, issues, docs, or logs.
- Local env files are QA fixtures and must remain uncommitted:
  `.env`, `.env.local`, `.env.*`, `server/.env`, and `server/.env.local`.
- Use [../reference/env-vars.yaml](../reference/env-vars.yaml) for canonical
  deployment variable ownership and storage.

## Release QA Intake

Before starting a QA pass:

1. Identify the exact commit SHA, PRs, release lane, or deploy run under test.
2. Read the PR summary, labels, changed files, linked issues, support reports,
   and release notes.
3. Map the change to touched surfaces: Desktop, Web, Mobile, Server, AnyHarness,
   cloud workers, supervisor, SDK, billing, analytics, deployment, or docs.
4. Read the owning structure, primitive, and feature specs for those surfaces.
5. Decide the narrowest QA matrix that proves the release while covering every
   changed surface.
6. Record intentionally skipped surfaces before execution, with the reason and
   owner.

Use release labels to set the default depth:

| Release label | QA depth |
| --- | --- |
| `release:large-feature` | Full touched-surface matrix plus one realistic end-to-end path through the main user workflow. |
| `release:minor-feature` | Touched-surface matrix plus focused regression checks for adjacent workflows. |
| `release:performance` | Baseline/after comparison, affected workflow smoke, and Sentry/error regression check. |
| `release:fix` | Reproduce or inspect the failing case, verify the fix, and smoke the nearest adjacent workflow. |
| `release:docs` | Link, command, and source-of-truth verification for the changed docs. |
| `release:maintenance` | CI plus targeted smoke for any public surface affected by the maintenance change. |
| `release:skip` | Confirm the reason for skipping release notes; still run verification required by the code change. |

## Baseline Verification

Start with automated checks that match the touched area. Use broader checks
only when the change crosses an API, runtime, release, or product boundary.

Common commands:

```bash
cargo test --workspace
pnpm --filter @proliferate/product-domain test
pnpm --filter @proliferate/web typecheck
pnpm --filter @proliferate/mobile typecheck
pnpm --filter @proliferate/product-ui typecheck
cd server && uv run pytest -q
```

Release and deployment changes must follow the workflow/helper checks in
[../deploying/ci-cd.md](../deploying/ci-cd.md). Server changes must include
the relevant `uv run pytest` slice. SDK contract changes must regenerate and
build the SDK through the owning SDK workflow.

## Local Full-Stack QA

Use a named profile for local full-stack QA:

```bash
make dev-init PROFILE=<name>
make dev PROFILE=<name>
```

Use `STRIPE=1` only when billing, checkout, portal, subscription, refill, or
webhook behavior is part of the release:

```bash
make dev PROFILE=<name> STRIPE=1
```

Profile QA must use the URLs and ports printed by that profile. Do not mix
state from the default local stack with a release QA profile.

When provider auth, billing, cloud commands, or real user-scoped visibility is
in scope, copy the developer's local non-example env files into the worktree
before startup and keep them uncommitted. Without local secrets and a human
login, QA can still verify type/build behavior but cannot fully verify provider
auth, cloud command delivery, billing/account settings, or user-scoped
workspace visibility.

## Surface Matrix

Select the rows that match the release. Do not require untouched surfaces unless
the change crosses a shared contract.

| Surface | Minimum manual smoke | Supporting docs |
| --- | --- | --- |
| Desktop | Sign in, open a workspace, send a prompt, reload transcript, verify settings affected by the release, and inspect updater behavior only when packaging/updater changed. | [../local/README.md](../local/README.md), [../../codebase/structures/desktop-native/README.md](../../codebase/structures/desktop-native/README.md) |
| Web | Sign in through the profile or staging URL, open/create the affected workspace, send a prompt when commandability is in scope, reload, and verify settings/modal/deep-link behavior. | [../../codebase/features/web-cloud-local-parity.md](../../codebase/features/web-cloud-local-parity.md) |
| Mobile web | Source the profile launch env, run mobile web against the same profile, verify auth state, navigation, chat, sessions, automations, and settings touched by the release. | [../local/mobile.md](../local/mobile.md), [../../codebase/features/mobile-cloud-client.md](../../codebase/features/mobile-cloud-client.md) |
| Native mobile | Verify the same user workflow in simulator/device when native OAuth, SecureStore, deep links, keyboard, safe-area, or TestFlight behavior changed. | [../local/mobile.md](../local/mobile.md), [../../codebase/features/mobile-cloud-client.md](../../codebase/features/mobile-cloud-client.md) |
| Server/API | Exercise changed API paths locally or in staging, verify auth/permission behavior, and confirm migrations/tests passed. | [../../codebase/structures/server/README.md](../../codebase/structures/server/README.md) |
| AnyHarness runtime | Start a real session, stream transcript events, execute the changed tool/session/workspace behavior, and verify contract compatibility with Desktop/Web/Mobile callers. | [../../codebase/structures/anyharness/README.md](../../codebase/structures/anyharness/README.md) |
| Cloud workers/supervisor | Provision or reuse a cloud target, verify command delivery, target status, logs, failure handling, and runtime version expectations. | [../../codebase/structures/proliferate-worker/README.md](../../codebase/structures/proliferate-worker/README.md), [../../codebase/structures/proliferate-supervisor/README.md](../../codebase/structures/proliferate-supervisor/README.md) |
| Billing | Use Stripe test mode, verify checkout/portal/refill/webhook behavior, budget/credit reconciliation, and UI state after webhook delivery. | [../local/stripe-local-testing.md](../local/stripe-local-testing.md), [../../codebase/primitives/billing.md](../../codebase/primitives/billing.md) |
| Analytics/observability | Verify events, dashboards, replay gates, alerts, release health, and support-correlation ids without leaking sensitive content. | [../analytics/README.md](../analytics/README.md) |
| Deploy/release | Verify the exact lanes that ran, environment gates, URLs, updater manifests, TestFlight submission, E2B smoke, and release/docs follow-up. | [../deploying/ci-cd.md](../deploying/ci-cd.md) |

## Regression Rules

- A QA pass must include at least one real commandable smoke when the release
  changes chat, workspace, session, runtime, cloud dispatch, agent auth,
  billing credits, or command delivery.
- Faux visual fixtures are acceptable for UI-only state coverage, but they do
  not prove command delivery, auth, billing, or runtime behavior.
- For composer-adjacent Desktop changes, load the dev playground and verify the
  affected scenario set from
  [../../codebase/features/chat-composer.md](../../codebase/features/chat-composer.md).
- For shared product-domain changes, run the product-domain tests and at least
  one consuming surface smoke.
- For migrations, verify both forward application and the user-facing workflow
  backed by the migrated rows.
- For analytics changes, verify the no-env/no-op local path and the vendor or
  dashboard path after deploy when ingestion is required.
- For release/deploy changes, do not call QA complete until the workflow lane,
  artifact, URL, manifest, or app-store surface that changed has been verified.

## Failure Handling

When QA fails:

1. Capture the exact surface, profile/environment, commit SHA, app version,
   workflow run, browser/device, user/account type, workspace id, session id,
   command id, and request id when available.
2. Prefer stable ids and support report ids over screenshots or free-form user
   content.
3. Check GitHub issues first when the failure resembles an existing report.
4. Check Sentry, deploy runs, and release artifacts when the failure follows a
   deploy or release.
5. Reproduce with the narrowest local profile or staging path that still uses
   real auth/runtime state.
6. File or update the GitHub issue with sanitized evidence and link the
   failing PR, run, support report, or deploy.

## Final Report Shape

A QA report must include:

- commit SHA, branch, PR, release, or deploy run under test
- surfaces included and surfaces intentionally skipped
- automated checks run, with pass/fail status
- manual smoke cases run, with environment/profile and pass/fail status
- links to relevant GitHub Actions runs, dashboards, issues, or support reports
- production/staging URLs, updater manifests, TestFlight builds, E2B template
  refs, or artifacts verified when applicable
- failures, mitigations, owners, and remaining risk
- docs, release notes, landing page, public docs, support docs, analytics, or
  dashboard updates completed or explicitly assigned

For clean passes, keep the summary short and concrete. For failures, lead with
the failing behavior, reproduction path, and current owner.
