# CI/CD

Read this doc before touching release workflows, deployment infra, updater
publishing, or the desktop in-app update flow.

## Agent Deployment Runbook

Use this section when another agent is asked to deploy a merged change to
staging or production. The detailed reference sections below explain how the
workflows are built; this section is the operator path.

### Operator Requirements

Required tools and surfaces:

- GitHub Actions through the GitHub MCP, `gh`, or the GitHub web UI
- local `git` for resolving the exact commit SHA and checking dirty worktrees
- `curl`, `jq`, and shell access for deploy verification and summary artifacts
- AWS CLI access when deployment infra, S3, CloudFront, ECS, ECR, IAM, or SSM
  secrets need inspection or repair
- Vercel CLI or Vercel dashboard access for hosted web deploy failures
- Expo/EAS and App Store Connect access when mobile build or TestFlight submit
  lanes are enabled
- Sentry access when release, sourcemap, native debug file, or crash
  verification is part of the change
- a browser with the right logged-in profile when GitHub, Vercel, Expo, Apple,
  Stripe, or analytics dashboards require interactive auth

Required operator permissions:

- GitHub repo read access for workflow logs and artifacts
- GitHub repo write access when the operator may need to push a fix
- GitHub `Production` environment approval rights for production promotes
- GitHub environment variable and secret admin rights when repairing deploy
  configuration, such as a stale `VERCEL_TOKEN`
- AWS access to assume or inspect the relevant deploy roles, SSM parameters,
  S3 buckets, CloudFront distributions, ECR repositories, and ECS services
- Vercel team access for the `proliferate-web` project
- Expo project access and App Store Connect access when mobile submit is
  enabled
- Apple Developer signing, notarization, and App Store Connect secrets must
  remain in GitHub or Apple systems; operators verify presence and failures,
  but do not copy secret values into docs or chat

Configuration and secret locations:

- `specs/developing/reference/env-vars.yaml` is the canonical variable catalog. Keep it
  current when a deployment lane gains, removes, or renames an environment
  variable.
- GitHub `staging` and `Production` environments are the deploy-time source of
  truth for workflow variables and secrets. Local `.env` files, dev profiles,
  and shell exports are not production deploy configuration.
- GitHub environment variables hold non-secret lane config and gates, including
  `AWS_REGION`, `AWS_DEPLOY_ROLE_ARN`, `VERCEL_*`, `WEB_URL`, `API_*`,
  `MOBILE_DEPLOY_ENABLED`, `EAS_*`, `DESKTOP_DEPLOY_ENABLED`,
  `DESKTOP_DOWNLOADS_BASE_URL`, `WORKERS_DEPLOY_ENABLED`,
  `LITELLM_DEPLOY_ENABLED`, E2B template refs,
  and non-secret support SSM parameter names plus legacy tracker
  ids/labels/limits retained during cleanup.
- GitHub environment secrets hold deploy credentials used directly by Actions,
  including `VERCEL_TOKEN`, `EXPO_TOKEN`, `E2B_API_KEY`, `E2B_ACCESS_TOKEN`,
  `SUPPORT_SLACK_WEBHOOK_URL`, `SUPPORT_GITHUB_APP_PRIVATE_KEY`, and
  `SUPPORT_LINEAR_API_KEY`.
- Server deploys may copy GitHub environment secrets into AWS SSM SecureString
  parameters for ECS runtime use, such as
  `/proliferate/<environment>/support/slack-webhook-url`,
  `/proliferate/<environment>/support/github-app-private-key`, and
  `/proliferate/<environment>/support/linear-api-key`. Treat SSM as the runtime
  destination and GitHub as the deploy orchestration source unless the workflow
  says otherwise.
- S3 buckets, CloudFront distributions, ECR repositories, ECS services, and IAM
  roles live in AWS and are referenced by GitHub environment variables. Repair
  the AWS resource or GitHub pointer explicitly; do not paper over a missing
  resource with a local override.
- Vercel project settings live in Vercel. GitHub only stores the deploy token
  and project/team identifiers needed for the hosted workflow.
- Expo/EAS and App Store Connect own mobile build credentials and submission
  state. GitHub stores the token and profile names needed to start the lane.

Operating invariants:

- Deploy from an exact SHA on `main`; do not deploy a local branch or dirty
  worktree.
- If `main` advances during a production deploy, the deployed SHA is still the
  older SHA. Promote the newer tip separately before saying production matches
  latest `main`.
- A selected lane that fails means the deploy run failed, even if another lane
  produced the artifact the operator cared about.
- `force_surfaces` is additive. It cannot suppress other detected lanes.
- `only_surfaces` is exact. Use it for targeted staging plans, production
  hotfixes, and any release where unrelated detected lanes must not move.
- Staging desktop validates the plan but does not publish the stable updater.
  Production desktop publish is the point where `latest.json` becomes live.
- Publishing the same desktop version twice does not update installed apps.
  The desktop updater compares versions, so visible desktop fixes require a
  real version bump.
- Do not call a deployment done until every selected lane is complete, every
  required approval gate is resolved, and the relevant URLs or artifacts have
  been verified.

Safe prompt to give an agent:

```text
Read specs/developing/deploying/ci-cd.md, then deploy <surface or all> to <staging or production>
from latest main. Watch the GitHub Actions run end to end, approve required
environment gates, fix or report any failing lane with the exact failing job
and logs, and verify the deployed URLs/artifacts before finishing.
```

Before deploying:

1. Confirm the target commit is on `main`.
2. Confirm CI passed for that commit.
3. Decide whether this is a normal detected-surface deploy, a forced full
   deploy, or an exact `only_surfaces` deploy.
4. Inspect the target environment gates before dispatching:
   - `MOBILE_DEPLOY_ENABLED`
   - `EAS_SUBMIT_ENABLED`
   - `DESKTOP_DEPLOY_ENABLED`
   - `WORKERS_DEPLOY_ENABLED`
   - `LITELLM_DEPLOY_ENABLED`
5. For user-facing releases, confirm whether the landing page, public docs,
   changelog/release notes, in-app copy, install docs, or support docs need to
   change with the release. Update them before deployment when they are part of
   the shipped behavior, or record the owner when they are not.
6. Do not print or document secret values. If a secret is invalid, update the
   GitHub environment secret and mention only that it was refreshed.

### Staging

Normal staging flow:

1. Merge the PR to `main`.
2. Wait for `CI` on `main` to finish successfully.
3. Let `Deploy Staging` run from the `workflow_run` trigger.
4. Watch the `Deploy Staging` run until every selected lane finishes.
5. Verify the staging surfaces that ran.

Manual staging dispatch is allowed when the automatic run did not start or
when explicitly requested:

```text
Workflow: Deploy Staging
ref: <main SHA or ref>
force_surfaces: <blank, comma-separated surfaces, or all>
only_surfaces: <blank, comma-separated surfaces, or all>
dry_run: false
```

For a staging plan only, use `dry_run=true` and do not treat it as a deploy.
Dry-run staging runs upload `deploy-plan-staging`, not
`deploy-summary-staging`; deploy-base resolution and production's staging
success check require the real deploy summary artifact. When a staging run is
triggered by `workflow_run`, the GitHub run-level SHA can point at the branch
tip even if the deploy job checked out the CI commit that triggered it. Use the
deploy summary artifact's `headSha` as the deployed commit of record.

### Production

Production is promoted manually from a staging-tested commit:

```text
Workflow: Promote Production
ref: <main SHA>
force_surfaces: <blank, comma-separated surfaces, or all>
only_surfaces: <blank, comma-separated surfaces, or all>
require_staging_success: true
dry_run: false
```

Normal production flow:

1. Confirm a successful `Deploy Staging` run exists for the exact `main` SHA.
   The run must be a non-dry-run deploy with a `deploy-summary-staging`
   artifact whose JSON `headSha` matches the promoted SHA; a dry-run plan is
   not enough.
2. Dispatch `Promote Production` with `require_staging_success=true`.
3. The promote plan verifies the promoted commit is reachable from `main`.
4. Approve the GitHub `Production` environment gates as they appear.
5. Watch every selected lane until completion.
6. Verify the production surfaces that ran.

The production GitHub environment currently exists as `Production`; workflow
inputs and reusable workflow calls use `production`, and GitHub resolves that
to the existing protected environment.

Bypass `require_staging_success` only when explicitly directed. If bypassing
staging, the agent must state that staging was bypassed and should watch the
E2B lane closely because production will build and smoke the immutable template
before moving the rolling production tag.
If a human operator explicitly asks to go to production while a staging run is
still in progress, dispatch production from the exact `main` SHA with
`require_staging_success=false`. Leave the staging run alone, but do not treat
it as the production gate; production is successful only after the production
run itself completes and the live production URLs/artifacts verify.

If forcing `e2b` in production while `require_staging_success=true`, first
force `e2b` in staging for the same SHA. Production uses `promote_only` in
this mode and expects the immutable `sha-<shortsha>` template to already exist.
Dry-run production promotes upload `deploy-plan-production`, not
`deploy-summary-production`, and are excluded from future production
deploy-base resolution.

### Nightly Release Train

The nightly train coordinates the public Proliferate product version, artifact
versions, artifact releases, and staging deploys from `main`.

```text
Workflow: Nightly Release Train
ref: <blank or main SHA/ref>
only_surfaces: <blank, comma-separated surfaces, or all>
version_bump: patch
dry_run: false
```

Train behavior:

1. Resolve a shared train id, `release-YYYY-MM-DD`.
2. Diff the selected SHA against the previous `release-*` train tag.
3. If `only_surfaces` is blank, release the detected surfaces. If
   `only_surfaces` is set, release exactly those surfaces.
4. If no surfaces are selected, do not mint a new product version or train tag.
5. Otherwise, bump the public product version from `VERSION` and the latest
   `proliferate-v*` tag. The normal train bump is `patch`; manual train runs
   may choose `minor` or `major`.
6. For selected artifact lanes, use the same semver as the product version:
   - desktop creates `desktop-vX.Y.Z` and updates `apps/desktop/package.json`,
     `apps/desktop/src-tauri/tauri.conf.json`, and
     `apps/desktop/src-tauri/Cargo.toml`
   - runtime creates `runtime-vX.Y.Z` and updates `anyharness/sdk/package.json`
   - server creates `server-vX.Y.Z` without a tracked server version file
7. Commit `VERSION` and any artifact version files back to `main`.
8. Create `proliferate-vX.Y.Z`, `release-YYYY-MM-DD`, and selected artifact
   tags at the final release commit.
9. Run selected artifact release lanes and selected staging deploy lanes.
10. After all selected lanes succeed, create or update the public GitHub
    Release at `proliferate-vX.Y.Z` with raw release notes, compare metadata,
    selected surfaces, artifact tags, and linked PRs/commits. Dry runs generate
    the same body in the Actions summary without publishing.

Feature changelog pages and social launch copy should cite
`Proliferate vX.Y.Z` first. The `release-*` train id is the date/ops alias, and
artifact tags are install/update plumbing. The train publishes raw technical
notes to GitHub Releases; polished public changelog pages remain a separate
product/website surface.

### Production Hotfix

Use `Hotfix Production` when an urgent fix must move exact surfaces to
production without waiting for the next train.

```text
Workflow: Hotfix Production
ref: <main SHA or ref>
only_surfaces: <comma-separated surfaces or all>
reason: <short reason>
version_bump: patch
dry_run: false
```

Hotfix behavior:

1. Require `only_surfaces`; no detected-surface spillover is allowed.
2. Verify the input ref is reachable from `main`.
3. By default, bump the public product version with `version_bump=patch`.
4. Use `version_bump=none` only for SHA-based surfaces (`web`, `workers`,
   `litellm`, `e2b`). Artifact lanes (`desktop`, `runtime`, `server`) and mobile
   require a product version bump. Under the support-system release contract,
   only a matrix-complete no-version web deployment can attest a globally
   shipped component in v1; the other SHA-only hotfixes remain lane-scoped raw
   release-ledger operations.
5. Commit `VERSION` and any artifact version files back to `main`.
6. Create a `hotfix-YYYY-MM-DD-<run-number>` tag. When the product version is
   bumped, also create `proliferate-vX.Y.Z` and selected artifact tags.
7. Publish selected runtime/server artifacts and deploy selected production
   lanes. Desktop hotfixes publish the stable updater feed.
8. After all selected lanes succeed, create or update the raw GitHub Release.
   Product-version hotfixes publish at `proliferate-vX.Y.Z`; no-version
   hotfixes publish at the `hotfix-*` tag. Dry runs generate the same body in
   the Actions summary without publishing.

For production hotfixes, prefer `dry_run=true` first. Then dispatch the real
run from the exact SHA after confirming the plan selected only the intended
surfaces.

### Surface Selection

The workflow detects deploy surfaces from the diff against the previous
successful deploy. `force_surfaces` and `only_surfaces` are different tools:
`force_surfaces` adds lanes to detection, while `only_surfaces` replaces
detection with the exact listed lanes.

Use these values:

```text
force_surfaces=<blank>  # deploy only detected surfaces
force_surfaces=all      # deploy every lane that is enabled by env gates
force_surfaces=web      # deploy detected surfaces plus web
only_surfaces=web       # deploy only web
only_surfaces=all       # deploy every lane that is enabled by env gates
```

If the intent is "only web" but the diff also detects mobile, server, E2B, or
desktop, use `only_surfaces=web`.
Only mobile, desktop, workers, and LiteLLM currently have environment gates
(`MOBILE_DEPLOY_ENABLED`, `DESKTOP_DEPLOY_ENABLED`, `WORKERS_DEPLOY_ENABLED`,
`LITELLM_DEPLOY_ENABLED` — each defaults to `false` when unset). Setting
`EAS_SUBMIT_ENABLED=false` skips TestFlight submission only; the mobile build
can still run when `MOBILE_DEPLOY_ENABLED=true`. Server, web, and E2B do not
have skip gates, so use `only_surfaces` when those detected lanes must not run.

### Verification

Always verify the surfaces that actually ran:

```text
API production: curl -fsS https://app.proliferate.com/api/health
API staging: curl -fsS https://staging-app.proliferate.com/api/health

Web production: curl -I https://web.proliferate.com/
Web staging: curl -I https://staging.proliferate.com/

Desktop stable updater:
curl -fsS https://downloads.proliferate.com/desktop/stable/latest.json
curl -fsS https://downloads.proliferate.com/desktop/stable/installers.json
curl -fsSI <each DMG URL from installers.json>

Treat desktop as live only after the production `deploy-desktop / release`
`publish-updater` job succeeds and the stable updater manifests advertise the
new version. The macOS build jobs and draft GitHub Release are necessary
intermediate steps, but they do not update installed apps by themselves.

Desktop staging:
Confirm the staging `deploy-desktop` lane completed its build/dry-run jobs and
uploaded expected Actions artifacts. Staging does not publish the stable
updater feed.

Mobile/TestFlight:
Confirm EAS submit finished for the exact build id produced by the build step,
then confirm App Store Connect/TestFlight processing for the matching app,
version, and build number.

E2B:
Confirm the deploy job promoted the expected rolling tag (`staging` or
`production`) and the smoke step passed.
```

When reporting back, include the workflow run URL, commit SHA, surfaces that
ran, skipped lanes, verification results, release/docs/landing-page ownership,
and any remaining owner.

### Failure Rules

- Do not call a deploy successful while a selected lane is still running,
  waiting for approval, failed, or canceled.
- If web fails on `vercel pull` or `vercel deploy` with an invalid token,
  refresh the `VERCEL_TOKEN` environment secret from a valid local or
  organization token; never paste the token in chat or docs.
- GitHub environment `VERCEL_TOKEN` values must be durable scoped access
  tokens for the `getonyx` team, not short-lived Vercel CLI session tokens.
  A token that can pull settings but fails deploy with `Not authorized` is not
  sufficient for the hosted web lane.
- If mobile builds an IPA but EAS submit fails, the app did not reach
  TestFlight. Open the Expo submission detail and inspect the `jobRun.errors`
  detail before changing repo code.
- If mobile reports `EAS_UPLOAD_TO_ASC_VERSION_DUPLICATE`, confirm production
  is using EAS remote build numbers and that the workflow submitted the captured
  build id, not `--latest`.
- If desktop fails during Apple notarization after signing and compiling, retry
  once before changing code; repeated failures need the notary log.
- E2B cache save/restore warnings are not failures when the E2B job completes
  and smoke passes.
- E2B `cargo install cargo-zigbuild --locked` can fail on transient crates.io
  or GitHub runner network errors such as `curl failed` with `[16] Error in the
  HTTP2 framing layer`. Rerun the failed E2B job once before changing code.
- Desktop production can be the long pole. The
  `deploy-desktop / release / build-desktop` matrix builds the AnyHarness
  runtime, bundled agent seed, debug helper, worker, SDK, frontend, and Tauri
  app before uploading artifacts. Intel macOS often lags Apple Silicon by many
  minutes. If the job is still `in_progress`, inspect active step names with
  `gh run view <run> --json jobs`; GitHub may not expose live logs until the job
  completes.

## 1. File Tree

```text
.github/workflows/
  ci.yml                     # shared Rust, SDK, and desktop frontend validation
  deploy-staging.yml         # main -> staging deploy spine after CI succeeds
  promote-production.yml     # protected manual production promote from a tested SHA
  _deploy-e2b.yml            # reusable E2B template build/promote/smoke lane
  _deploy-server.yml         # reusable ECR/ECS/Alembic/server-health lane
  _deploy-workers.yml        # reusable hosted worker lane, gated until workers are enabled
  _deploy-web.yml            # reusable Vercel deploy/alias/smoke lane
  _deploy-litellm.yml        # reusable LiteLLM ECR/ECS lane, gated by LITELLM_DEPLOY_ENABLED
  _deploy-mobile.yml         # reusable EAS/TestFlight lane, gated until app identity is ready
  _deploy-desktop.yml        # reusable desktop release lane, gated until beta/stable channel split
  cloud-tests.yml            # real-provider cloud lifecycle + cloud-backed runtime suites
  cloud-live-webhook.yml     # manual/nightly live E2B webhook delivery smoke
  release-cloud-template.yml # public E2B cloud template build + publish + staging promote
  promote-cloud-template.yml # manual production promote for public E2B templates
  nightly-release-train.yml  # scheduled release train, staging deploy, artifact release coordinator
  hotfix-production.yml      # exact-surface production hotfix coordinator
  pr-metadata.yml            # PR title and release/area label validation
  release-desktop.yml        # desktop packaging, draft release, updater publish
  release-runtime.yml        # AnyHarness binary release + npm publish for @anyharness/sdk
  server-ci.yml              # server lint/test/build-and-push image pipeline
.github/
  release.yml                # generated GitHub release-note grouping
  pull_request_template.md   # PR title, label, and verification checklist
apps/desktop/
  infra/main.tf              # updater bucket, CloudFront, GitHub OIDC release role
  src-tauri/tauri.conf.json  # updater endpoint, public key, bundle config
  src/lib/access/tauri/updater.ts
  src/lib/access/downloads/desktop-release-manifest.ts
  src/hooks/access/tauri/use-updater.ts
  src/hooks/access/downloads/desktop-releases/use-desktop-release-manifest.ts
  src/hooks/updates/facade/use-release-notice.ts
  src/stores/updater/updater-store.ts
  src/components/feedback/UpdateToastPresenter.tsx
  src/components/feedback/UpdateRestartDialog.tsx
  src/components/workspace/shell/sidebar/SidebarUpdatePill.tsx
  src/components/workspace/shell/sidebar/ReleaseNoticeCard.tsx
server/
  infra/main.tf              # ECR, ECS, RDS, and server runtime infra
  deploy/                    # self-hosted production compose + update scripts
scripts/
  ci-cd/
    create-release-tags.mjs
    detect-deploy-surfaces.mjs
    prepare-artifact-release.mjs
    resolve-deploy-base.mjs
  build-agent-seed.mjs
  generate-desktop-installer-manifest.mjs
  generate-updater-manifest.mjs
vercel.json                  # web app deploy config (Vercel project proliferate-web)
.vercelignore                # excludes Rust target/, node_modules/, etc. from web upload
```

## 2. Non-Negotiable Rules

- Treat workflows, release scripts, infra, and updater config as one delivery
  surface. Do not update one without checking the others.
- `VERSION` and `proliferate-vX.Y.Z` are the public product version. Changelog
  pages, launch copy, and support notes cite this version first.
- Release trains use shared `release-YYYY-MM-DD` tags as date/ops aliases.
  Artifact tags remain lane-specific (`desktop-v*`, `runtime-v*`,
  `server-v*`) but use the same semver as the product version when emitted.
- `proliferate-v*` and `hotfix-*` GitHub Releases are the canonical raw
  release-note ledger. Changelog generation and feature launch pages are
  separate polished product surfaces.
- Cloud template releases are manually dispatched. They publish immutable
  `sha-*` tags, then move rolling `staging` and `production` tags separately.
- Desktop versioning must stay consistent across
  `apps/desktop/package.json`, `apps/desktop/src-tauri/tauri.conf.json`, and
  `apps/desktop/src-tauri/Cargo.toml`. The desktop release workflow enforces this on
  tagged and production-promoted releases.
- Do not change updater endpoints, publish paths, or signing behavior in only
  one place. Keep these aligned:
  - `.github/workflows/release-desktop.yml`
  - `scripts/generate-desktop-installer-manifest.mjs`
  - `scripts/generate-updater-manifest.mjs`
  - `apps/desktop/src-tauri/tauri.conf.json`
  - `apps/desktop/infra/main.tf`
- The desktop updater must continue to consume signed artifacts plus
  `latest.json`. Do not add parallel ad hoc install paths.
- Public human download links must consume installer artifacts from
  `installers.json`, not the Tauri updater `latest.json` feed.
- Only packaged desktop builds should auto-check for updates. Development builds
  should remain updater-free.
- `ci.yml` is the repo-wide merge gate for repo shape, Rust, SDK, frontend,
  mobile, shared-package, and workflow-config checks, plus the fail-closed
  candidate-build handoff proof and Tier-2 `Workflow definition lifecycle
  (tier-2)` job (see §4 Continuous Integration).
- `server-ci.yml` is the canonical server validation lane. Staging waits for a
  matching `Server CI` run when one exists for the same SHA, so server changes do
  not deploy before server lint/tests finish.
- `server-ci.yml` also remains the tag-gated self-hosted server image/release-asset
  workflow. Hosted ECS rollout belongs to the deploy spine, not this workflow.
- Staging deploys are driven by `deploy-staging.yml` after `CI` succeeds on
  `main`. Production deploys are driven by protected manual promotion through
  `promote-production.yml`.
- Self-hosted production should center on `server/deploy/**` and GHCR-published
  server images. Do not create a parallel self-hosted deploy path that drifts
  from those files.
- Preserve public artifact names, release channels, and updater URLs unless an
  explicit product change is requested.
- PRs must use the repository release metadata standard before they are marked
  ready for review. Draft PRs are exempt until ready.
- GitHub workflows opt into the Node 24 JavaScript action runtime with
  `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true`. Keep that env var on new workflows
  so the June 2026 GitHub Actions runtime migration stays explicit and tested.

## 3. PR Metadata and Release Notes

Generated GitHub release notes are driven by PR titles and labels. Keep PR
titles readable for humans and labels precise for automation.

PR titles must use:

```text
<type>(<scope>): <plain-English change>
```

Allowed types:

```text
feat, fix, perf, docs, refactor, chore, ci, test, build, release
```

Examples:

```text
feat(desktop): open new chat tabs optimistically
fix(anyharness): use materialized session IDs for runtime calls
perf(desktop): avoid header tab rerenders during stream updates
docs(cloud): clarify local and cloud workspace flows
ci(release): generate desktop release notes
```

Every non-draft PR must have exactly one release label:

```text
release:large-feature
release:minor-feature
release:performance
release:fix
release:docs
release:maintenance
release:skip
```

Every non-draft PR must have at least one area label:

```text
area:desktop
area:anyharness
area:sdk
area:server
area:cloud
area:docs
area:website
area:release
area:product
```

Use `release:maintenance` for non-user-facing work such as refactors, tests,
CI, release infra, dependency bumps, codegen, logging, dev tooling, and cleanup.
Use `release:skip` only when the PR should not appear in generated release
notes.

Artifact GitHub Releases may still use GitHub-generated notes for downloads,
checksums, and PR-level history. Product GitHub Releases are generated by the
nightly/hotfix workflows and act as the raw release ledger. Public feature
changelog pages remain separate from this release/deploy automation.

Consent-safe support attribution, the machine-readable product release
manifest, and deterministic landing changelog generation are defined in
[`../../codebase/features/support-system.md`](../../codebase/features/support-system.md).
`Publish landing changelog` is deliberately manual until the release finalizer
publishes manifests. It requires `LANDING_REPOSITORY` (repository variable) and
`LANDING_REPOSITORY_TOKEN` (secret with write access only to that repository),
downloads the exact `release-manifest.json` asset for the requested product
tag, verifies the landing build, and creates or updates the one draft
`changelog/v<version>` PR. It makes no landing change for omit-only manifests.

Before making `.github/workflows/pr-metadata.yml` required in branch
protection, create the full `release:*` and `area:*` label set in GitHub.
Example:

```bash
gh label create "release:large-feature" --color "5319e7" --description "Major user-visible product surface"
gh label create "release:minor-feature" --color "1d76db" --description "Small user-visible improvement"
gh label create "release:performance" --color "fbca04" --description "Speed, latency, memory, render, or request improvement"
gh label create "release:fix" --color "d73a4a" --description "Bug fix, crash fix, or correctness fix"
gh label create "release:docs" --color "0075ca" --description "Documentation, changelog, install guide, or troubleshooting"
gh label create "release:maintenance" --color "cfd3d7" --description "Refactor, test, CI, dependency, codegen, or tooling work"
gh label create "release:skip" --color "eeeeee" --description "Exclude from generated release notes"
gh label create "area:desktop" --color "bfd4f2" --description "Desktop app, Tauri shell, updater, or local app behavior"
gh label create "area:anyharness" --color "bfdadc" --description "AnyHarness runtime, sessions, workspaces, agents, or contract"
gh label create "area:sdk" --color "bfdadc" --description "AnyHarness SDK or SDK React package"
gh label create "area:server" --color "c2e0c6" --description "API server, auth, billing, orgs, or control plane"
gh label create "area:cloud" --color "c2e0c6" --description "Cloud workspaces, providers, or cloud runtime flows"
gh label create "area:docs" --color "d4c5f9" --description "Docs site or documentation content"
gh label create "area:website" --color "d4c5f9" --description "Marketing site or public changelog pages"
gh label create "area:release" --color "fef2c0" --description "Release workflows, packaging, updater manifests, or publishing"
gh label create "area:product" --color "fef2c0" --description "Cross-cutting product behavior spanning multiple areas"
```

## 4. Delivery Flows

### Continuous Integration

Source of truth:

- `.github/workflows/ci.yml`
- `.github/workflows/server-ci.yml`
- `.github/workflows/cloud-tests.yml`
- `.github/workflows/cloud-live-webhook.yml`

Flow:

1. `.github/workflows/ci.yml` runs on pushes to `main`, on pull requests, and
   by manual dispatch.
2. It validates:
   - repo shape checks, including max source file length, frontend layer
     boundaries, server layer boundaries, and AnyHarness layer boundaries
   - CI/CD helper script parsing, workflow YAML parsing, and deploy surface
     detector smoke coverage
   - the Rust workspace with `cargo check` and `cargo test`
   - `@anyharness/sdk` generation and build
   - the desktop frontend build
   - mobile typecheck
   - web typecheck/build
   - shared frontend package typecheck/build/tests, including the focused
     Tier-1 workflow-definition surface run
     (`product-surfaces` `src/workflows/WorkflowDefinitionsSurface.test.tsx`)
   - the fail-closed `Candidate build handoff` job, which builds a release-mode
     host AnyHarness, validates and materializes its exact build-map bytes,
     launches them in isolation, and requires matching aggregate evidence
     without loading provider credentials
   - the fail-closed Tier-2 job `Workflow definition lifecycle (tier-2)`,
     which boots the real intent stack and runs only
     `tests/intent/specs/workflow-definitions.spec.ts`; a red result fails
     the CI workflow and therefore blocks the `deploy-staging.yml`
     `workflow_run` spine. The check is eligible for a future repository
     required-status rule, but no branch protection/ruleset exists today.
     The broad tier-2 lanes (`intent-tests` + `intent-billing` in
     `.github/workflows/intent-tests.yml`) remain provisional/non-blocking.
3. `.github/workflows/server-ci.yml` validates the server slice separately with:
   - server catalog validation
   - Ruff
   - format checks
   - deterministic pytest suites against Postgres
   - versioned GHCR image publishing only on `server-v*` tags
4. Direct, non-provider E2B webhook handler coverage stays in
   `.github/workflows/server-ci.yml` because those tests run against the local
   ASGI app and do not need live provider credentials.
5. `.github/workflows/cloud-tests.yml` runs the real-provider cloud suites by
   manual dispatch only:
   - cloud lifecycle/provisioning coverage for E2B
   - the shared AnyHarness runtime scenarios against cloud-provisioned backends
6. `.github/workflows/cloud-live-webhook.yml` is separate because the live E2B
   webhook smoke depends on an externally reachable ngrok target and should not
   block the base cloud lane.
7. `.github/workflows/agent-runtime-compat.yml` runs by manual dispatch only.
   It consumes live agent credentials and should be enabled intentionally.

### Desktop Release

Source of truth:

- `.github/workflows/release-desktop.yml`
- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/infra/main.tf`
- `scripts/generate-desktop-installer-manifest.mjs`
- `scripts/generate-updater-manifest.mjs`

Flow:

1. Bump the desktop version in:
   - `apps/desktop/package.json`
   - `apps/desktop/src-tauri/tauri.conf.json`
   - `apps/desktop/src-tauri/Cargo.toml`
2. Commit and merge the version bump to `main`.
3. Preferred production path: run `promote-production.yml` for the merged SHA.
   When the desktop surface is enabled and `DESKTOP_DEPLOY_ENABLED=true` for
   the target environment, the promote workflow derives `desktop-v<VERSION>`
   from the promoted SHA and calls `release-desktop.yml` directly.
   Promote-sourced releases create the missing lightweight `desktop-v<VERSION>`
   git tag before creating the draft GitHub Release.
4. Low-level/manual path: from updated `main`, create and push a tag like
   `desktop-v0.1.0`. The tag-push workflow still triggers automatically and
   publishes updater/download assets after the build succeeds.
5. After the workflow succeeds, manually review the draft GitHub Release:
   - add a short highlights section at the top
   - clean up generated release notes if needed
   - publish the GitHub Release as the human-facing release page
6. If you must trigger the desktop workflow manually, use
   `--ref desktop-v<VERSION>` for non-dry-run releases. Reusable calls from
   production promote pass `git_sha` and `version` explicitly, so they do not
   depend on `GITHUB_REF_NAME`.
7. The workflow:
   - validates version consistency on tag pushes
   - builds the AnyHarness sidecar for each desktop target
   - builds exactly one bundled agent seed for that target from
     `apps/desktop/src-tauri/agent-seed.inputs.json`
   - verifies the bundled Node binary with `codesign` and `spctl` on macOS
   - regenerates and builds `@anyharness/sdk`
   - builds the frontend
   - builds and signs the Tauri desktop packages
   - on macOS, builds the DMG and updater-enabled app bundle separately
   - verifies updater artifacts before release creation
   - normalizes macOS DMG names to stable arch-specific filenames
   - normalizes macOS updater archive names to stable arch-specific filenames
   - creates a draft GitHub release with generated release notes
8. The updater publish job then:
   - generates `latest.json`, including the optional validated one-line
     `release_title` as standard Tauri `notes`
   - generates `installers.json`
   - uploads signed updater artifacts and public DMG installers to
     `s3://.../desktop/stable/`
   - atomically creates the immutable versioned `latest.json`, then uploads the
     same file to rolling `latest.json` and publishes `installers.json`
   - invalidates the CloudFront cache for both manifests

Note:

- The current desktop release matrix is macOS-only. Windows packaging and
  updater entries are temporarily disabled until the SDK generation step is
  Windows-safe.
- `latest.json` is reserved for Tauri updater clients and intentionally points
  at `.app.tar.gz` archives plus signatures. Public download pages should use
  `installers.json`, which points at the user-facing DMG installers.
- Named Desktop releases may provide `release_title` (plain text, one line,
  80 characters maximum). An omitted title remains a valid release and omits
  `notes`; direct tag-push releases have no title input and use that fallback.
- The publisher refuses an existing immutable
  `desktop/stable/<version>/latest.json` before changing updater assets. After
  asset upload it creates that key atomically with `If-None-Match: *`; only a
  successful create permits the same generated file to replace rolling
  `latest.json`. Any authorization, precondition, or write failure stops before
  the rolling feed changes. Release runs serialize on a normalized
  `desktop-v<version>` concurrency key without cancelling the active run, so a
  queued same-version run reaches the immutable preflight only after the first
  publisher finishes. A partial first publish that creates the immutable key
  but fails before rolling publication requires explicit operator inspection
  and removal of the immutable object before rerunning.
- The downloads CloudFront distribution attaches public CORS response headers
  for `GET`, `HEAD`, and preflight requests. Updater archive signatures remain
  the installation trust boundary; release-notice copy is rendered only as
  inert text.
- Agent seeds are target-specific Tauri resources under
  `apps/desktop/src-tauri/agent-seeds/`. The seed builder cleans previous generated
  seed files before writing the current target archive, and the workflow asserts
  that exactly one non-empty `agent-seed-*.tar.zst` plus matching `.sha256`
  exists before `pnpm tauri build`.
- Release workflow artifacts are staged into a flat
  `target/<target>/release/release-artifacts/` directory before upload. The
  downloadable GitHub Actions artifact should contain the user-facing DMG plus
  updater archive/signature at its top level; raw seed archives stay embedded in
  the app bundle and are not uploaded as separate release assets.
- The workflow also uploads a separate `proliferate-dmg-<target>` Actions
  artifact for manual PR-build testing. GitHub Actions artifacts still download
  as ZIP files, but this DMG-only artifact avoids downloading the updater
  archive/signature when a tester only needs the installer.
- Desktop releases currently bundle Claude Code, Codex, and a target-specific
  Node runtime. Other agents are still installed through normal background
  reconcile after seed hydration.
- Seed hydration runs in the AnyHarness background after the HTTP runtime starts.
  A local arm64 smoke with a 170 MB compressed seed reported `/health` in
  roughly 50 ms with `agentSeed.status=hydrating`, then completed hydration in
  roughly 98 seconds on the test machine. Treat this as a measurement point, not
  a release promise.
- Seed updates are tied to desktop releases. Because Tauri updater artifacts are
  full archives rather than binary deltas, bundling agents increases both first
  download size and every desktop update payload until a separate delta/updater
  strategy exists.
- A notarized macOS DMG install on a clean user account is a release gate for
  bundled seed changes. CI `codesign`/`spctl` checks catch the pinned Node
  tarball, but only a clean-account install catches Gatekeeper, quarantine, and
  hydrated-executable behavior end to end. This gate is manual until the
  release pipeline has a self-hosted clean macOS runner or VM lane.
- `dry_run: true` exercises the build matrix but skips `create-release` and
  `publish-updater`.
- Manual non-dry-run desktop releases must run from a `desktop-v*` tag ref.
  Production promote is the exception: it calls the reusable desktop workflow
  with an explicit promoted SHA and version, after `_deploy-desktop.yml`
  validates that the version matches package/Tauri/Cargo metadata.
- Manual runs default `publish_updater` to false. Use this to test draft
  GitHub release creation and generated notes without uploading updater assets
  to S3 or invalidating CloudFront.
- Real `desktop-v*` tag pushes still publish updater and download assets
  automatically after the draft GitHub release is created.
- `_deploy-desktop.yml` refuses to publish a desktop version if the derived
  `desktop-v<VERSION>` tag already exists at a different SHA. Bump the desktop
  version before publishing a new desktop build from a new commit.
- `_deploy-desktop.yml` also refuses to publish updater assets when the live
  stable updater feed already advertises the same or newer desktop version.
  Bump the desktop version before making another updater release visible.
- Publishing the GitHub Release does not make the updater live. The updater is
  made live only when `publish-updater` uploads manifests/assets and
  invalidates CloudFront: automatically on `desktop-v*` tag pushes, or during
  production promote when `_deploy-desktop.yml` calls `release-desktop.yml`
  with `publish_updater=true`. The GitHub Release is the public release-notes
  and artifact archive surface.
- The release workflow is intentionally fail-closed now: manifest generation
  happens before S3 upload so a broken manifest does not leave a partial updater
  publish behind.

Useful local wrappers:

```bash
# Safe build-only workflow dry run. Creates no GitHub release and publishes no updater assets.
make release-desktop-dry-run DESKTOP_RELEASE_REF=feat/my-branch

# Draft GitHub release preview from an already-pushed desktop tag.
# Creates a draft release, but does not publish updater assets.
make release-desktop-draft DESKTOP_RELEASE_TAG=desktop-v0.1.28
```

### Desktop In-App Update Flow

Source of truth:

- `specs/codebase/features/desktop-updates.md`
- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/src/lib/access/tauri/updater.ts`
- `apps/desktop/src/lib/access/downloads/desktop-release-manifest.ts`
- `apps/desktop/src/hooks/access/downloads/desktop-releases/use-desktop-release-manifest.ts`
- `apps/desktop/src/hooks/access/tauri/use-updater.ts`
- `apps/desktop/src/hooks/updates/facade/use-release-notice.ts`
- `apps/desktop/src/stores/updater/updater-store.ts`
- `apps/desktop/src/components/feedback/UpdateToastPresenter.tsx`
- `apps/desktop/src/components/feedback/UpdateRestartDialog.tsx`
- `apps/desktop/src/components/workspace/shell/sidebar/SidebarUpdatePill.tsx`
- `apps/desktop/src/components/workspace/shell/sidebar/ReleaseNoticeCard.tsx`

Flow:

1. Tauri reads the updater endpoint from `apps/desktop/src-tauri/tauri.conf.json`.
2. The packaged app checks `https://downloads.proliferate.com/desktop/stable/latest.json`.
3. `apps/desktop/src/lib/access/tauri/updater.ts` is the only frontend wrapper around
   `@tauri-apps/plugin-updater` and relaunch behavior. It preserves the target
   version and optional Tauri `body` (`notes`) returned by the update check.
4. `apps/desktop/src/hooks/access/tauri/use-updater.ts` owns the UI-facing updater flow:
   - initial delayed check
   - 30-minute polling
   - download progress
   - install and relaunch
   - telemetry/error capture
5. `apps/desktop/src/stores/updater/updater-store.ts` owns live updater UI state;
   the access hook persists the last-check timestamp through the preferences
   access boundary.
6. The installed app fetches its immutable versioned manifest from the same
   downloads CDN. The sidebar selects only that running version's unacknowledged
   title and uses an exact-version cached title only when the CDN lookup is
   pending or unavailable.
7. `UpdateToastPresenter` owns the pre-install announcement and its authored
   `UPDATE` title alongside Download, progress, restart, and recoverable-error
   states. Available targets have no separate sidebar dismissal state.
8. The sidebar release card appears only for an installed titled version. It
   owns the `NEW` title presentation, installed-version acknowledgment, and the
   fixed `https://proliferate.com/changelog` action.

### Runtime and SDK Release

Source of truth:

- `.github/workflows/release-runtime.yml`
- `anyharness/sdk/package.json`

Flow:

1. Push a tag like `runtime-v0.1.0` or run `Release Runtime` manually.
2. The workflow builds AnyHarness binaries for all supported targets.
3. The workflow packages the binaries into release archives.
4. The workflow generates and builds `@anyharness/sdk`.
5. On a real tag push, the workflow publishes `@anyharness/sdk` to npm.
6. The workflow creates a GitHub release with the runtime archives and
   `SHA256SUMS`.

Note:

- The current workflow publishes `@anyharness/sdk`.
- `@anyharness/sdk-react` is a workspace package, but this workflow does not
  currently publish it.

### Cloud Template Release

Source of truth:

- `.github/workflows/release-cloud-template.yml`
- `.github/workflows/promote-cloud-template.yml`
- `scripts/build-template.mjs`
- `scripts/smoke-cloud-template.mjs`
- `scripts/promote-cloud-template.mjs`

Flow:

1. Run `Release Cloud Template` manually.
2. The workflow:
   - builds the Linux `anyharness` binary
   - builds the shared E2B template family from the current repo state
   - assigns an immutable `sha-<gitsha>` tag to that build
   - publishes the template family if it is not public yet
   - smoke-tests the exact immutable public ref
   - promotes that tested immutable build to the rolling `staging` tag
3. `Promote Cloud Template` is a separate manual workflow that:
   - re-smoke-tests a chosen immutable `sha-*` tag
   - moves the rolling `production` tag to that build

Notes:

- Managed Proliferate and external/self-hosted users should both consume the
  public `TEAM_SLUG/proliferate-runtime-cloud:production` ref.
- Build IDs are for debugging and rollback, not normal operator config.
- Required GitHub config for the build workflow:
  - secret `E2B_API_KEY`
  - secret `E2B_ACCESS_TOKEN` while `scripts/build-template.mjs` shells out to
    the E2B CLI for template list/publish operations
  - variable `E2B_TEAM_ID`
  - variable `E2B_PUBLIC_TEMPLATE_FAMILY` with the full public family ref,
    for example `TEAM_SLUG/proliferate-runtime-cloud`

### Cloud API Delivery

Source of truth:

- `.github/workflows/deploy-staging.yml`
- `.github/workflows/promote-production.yml`
- `.github/workflows/_deploy-server.yml`
- `.github/workflows/server-ci.yml`
- `server/infra/main.tf`

Hosted flow:

1. A successful `CI` run on `main` triggers `Deploy Staging`.
2. `Deploy Staging` waits for any `Server CI` run for the same SHA to finish
   successfully before planning deploys. If no `Server CI` run exists for that
   SHA, it continues.
3. `Deploy Staging` resolves the last successful staging SHA, diffs it against
   the new SHA, and classifies touched deploy surfaces.
4. If `server` changed, `_deploy-server.yml`:
   - builds and pushes an ECR image tagged by short SHA
   - renders a new ECS task definition from the live service task definition
   - updates non-secret runtime environment such as `API_URL`, `API_BASE_URL`,
     release SHA, and E2B template ref
   - runs `alembic upgrade head` as a one-off Fargate task
   - rolls the ECS service
   - smokes `${API_URL}${API_HEALTH_PATH:-/api/health}`
5. `Promote Production` is a manual workflow. Its plan/dry-run path is not
   environment-protected, so production plans can be iterated quickly.
6. Non-dry-run production deploy jobs use the protected `production`
   environment. They require, by default, a successful staging deploy for the
   exact SHA being promoted, then repeat the same changed-surface deploy graph
   against production environment vars and secrets.

Self-hosted/tag flow:

1. Changes under `server/**` trigger `Server CI` on `main` and pull requests.
2. The workflow runs lint and tests.
3. On `server-v*` tags, the workflow publishes a versioned GHCR tag for
   self-hosted pinning.
4. On `server-v*` tags, the workflow also publishes the self-hosted AWS assets:
   - `anyharness-x86_64-unknown-linux-musl.tar.gz`
   - `proliferate-self-hosted-aws-template.yaml`
   - `self-hosted-assets.SHA256SUMS`
5. `server/infra/main.tf` defines the cloud resources around that image:
   - ECR
   - ECS
   - RDS
   - security groups
   - log group

Current boundary:

- This repo automates hosted ECR/ECS rollout through the deploy spine and
  versioned GHCR image publication through `server-v*` tags.
- This repo now also publishes the versioned AWS self-hosted stack template and
  Linux runtime tarball on `server-v*` tags so a CloudFormation launch can
  bootstrap the same `server/deploy/**` surface.

### Hosted Deploy Spine

Source of truth:

- `.github/workflows/deploy-staging.yml`
- `.github/workflows/promote-production.yml`
- `.github/workflows/_deploy-*.yml`
- `scripts/ci-cd/detect-deploy-surfaces.mjs`
- `scripts/ci-cd/resolve-deploy-base.mjs`

Trigger model:

1. Pull requests run checks only.
2. `main` runs `CI`.
3. Successful `CI` on `main` triggers `Deploy Staging`.
4. Production is promoted manually through `Promote Production` and should be
   protected by the GitHub `production` environment.
5. Tags are release artifacts or channel pointers, not the primary hosted deploy
   trigger. Desktop still produces `desktop-v*` release tags, but production
   promote owns deriving and invoking that desktop release from the promoted
   SHA.
6. `Nightly Release Train` and `Hotfix Production` sit above this hosted spine:
   they prepare the public product version, shared train/hotfix ids, matching
   artifact tags, and then call the same reusable deploy lanes.

Deploy graph:

1. Resolve base/head:
   - staging diffs against the last successful non-dry-run
     `deploy-staging.yml` run with a `deploy-summary-staging` artifact; the
     artifact `headSha` is the base when it differs from the GitHub run-level
     SHA
   - production diffs against the last successful non-dry-run
     `promote-production.yml` run with a `deploy-summary-production` artifact;
     the artifact `headSha` is the base when it differs from the GitHub
     run-level SHA
   - deploy-base lookup fails closed on GitHub API, artifact download, or scan
     limit errors when `GITHUB_TOKEN` is available; local/no-token runs fall
     back to the parent SHA for developer ergonomics
2. Detect changed surfaces:
   - `server`
   - `workers`
   - `e2b`
   - `web`
   - `mobile`
   - `desktop`
   - `runtime` for runtime-shaped artifact releases; hosted
     staging/production do not have a runtime deploy lane
3. Deploy changed surfaces:
   - E2B builds immutable `sha-*` tags for staging, then moves the rolling
     `staging` tag after smoke
   - production E2B promotes the already-built `sha-*` tag to `production`
     when staging success is required; if staging is explicitly bypassed, it
     builds and smokes the immutable `sha-*` tag before promotion
   - server deploys ECR/ECS, runs Alembic, and smokes health
   - web deploys through Vercel, aliases the environment URL, and smokes it
   - mobile uses EAS build/submit when `MOBILE_DEPLOY_ENABLED=true`
   - desktop calls the reusable desktop release workflow when
     `DESKTOP_DEPLOY_ENABLED=true`; the desktop version is derived from the
     promoted SHA, and no static `DESKTOP_RELEASE_REF` is used
   - workers are intentionally gated until the hosted worker ECS command/service
     is canonical
   - LiteLLM deploys ECR/ECS when `LITELLM_DEPLOY_ENABLED=true` for the target
     environment and skips otherwise
4. Upload a deploy summary artifact.

Important: `force_surfaces` is additive. It forces listed surfaces to deploy in
addition to any surfaces detected from the diff. Use `only_surfaces` when the
intent is exact, such as `only_surfaces=web` for a web-only hotfix. Only
mobile, desktop, workers, and LiteLLM currently have environment gates
(`MOBILE_DEPLOY_ENABLED`, `DESKTOP_DEPLOY_ENABLED`, `WORKERS_DEPLOY_ENABLED`,
`LITELLM_DEPLOY_ENABLED`). Setting `only_surfaces` is the supported way to
keep detected server/web/E2B lanes from running.

Required GitHub environment vars/secrets:

```text
# common
AWS_REGION
AWS_DEPLOY_ROLE_ARN
WEB_URL
API_URL
API_BASE_URL

# server
ECR_SERVER_REPOSITORY
ECS_CLUSTER
ECS_SERVER_SERVICE
ECS_SERVER_CONTAINER_NAME
API_HEALTH_PATH
E2B_TEMPLATE_REF
SUPPORT_REPORT_S3_BUCKET
SUPPORT_REPORT_S3_PREFIX
SUPPORT_REPORT_S3_REGION
SUPPORT_REPORT_INTERNAL_BASE_URL
SUPPORT_SLACK_WEBHOOK_URL_PARAMETER_NAME

# legacy support-tracker inputs; still rendered by deploys but not consumed by
# the current server
SUPPORT_TRACKER_ENABLED
SUPPORT_TRACKER_RECONCILER_INTERVAL_SECONDS
SUPPORT_TRACKER_RECONCILER_BATCH_SIZE
SUPPORT_TRACKER_MAX_ATTEMPTS
SUPPORT_TRACKER_RETRY_BASE_SECONDS
SUPPORT_GITHUB_APP_ID
SUPPORT_GITHUB_APP_INSTALLATION_ID
SUPPORT_GITHUB_OWNER
SUPPORT_GITHUB_REPO
SUPPORT_GITHUB_LABEL_SUPPORT
SUPPORT_GITHUB_LABEL_PRIVATE
SUPPORT_GITHUB_APP_PRIVATE_KEY_PARAMETER_NAME
SUPPORT_LINEAR_TEAM_ID
SUPPORT_LINEAR_PROJECT_ID
SUPPORT_LINEAR_LABEL_IDS
SUPPORT_LINEAR_PRIVATE_DETAILS_LABEL_ID
SUPPORT_LINEAR_API_KEY_PARAMETER_NAME

# server support secrets
SUPPORT_SLACK_WEBHOOK_URL
SUPPORT_GITHUB_APP_PRIVATE_KEY
SUPPORT_LINEAR_API_KEY # optional; omit to run GitHub-only support tracking

The server deploy workflow writes the support Slack webhook and legacy tracker
secrets to SSM SecureString parameters and injects them into ECS through
task-definition `secrets`, not plain container environment values. The current
server consumes only the Slack webhook; tracker inputs remain for migration
cleanup and do not enable a reconciler. If a secret already exists in SSM, the
GitHub secret can be omitted and the corresponding `*_PARAMETER_NAME` variable
will be used as the ECS `valueFrom`.

# E2B
E2B_PUBLIC_TEMPLATE_FAMILY
E2B_TEAM_ID
E2B_API_KEY
E2B_ACCESS_TOKEN

# Vercel
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_PROJECT_ID
VERCEL_ENVIRONMENT
VERCEL_TARGET
VERCEL_SCOPE

# mobile, when enabled
MOBILE_DEPLOY_ENABLED
APP_VARIANT
EXPO_TOKEN
EAS_BUILD_PROFILE
EAS_SUBMIT_PROFILE
EAS_SUBMIT_ENABLED

# desktop, when enabled
DESKTOP_DEPLOY_ENABLED
DESKTOP_DOWNLOADS_BASE_URL
AWS_DESKTOP_RELEASE_ROLE_ARN
DESKTOP_DOWNLOADS_S3_BUCKET
DESKTOP_CLOUDFRONT_DISTRIBUTION_ID
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
APPLE_CERTIFICATE
APPLE_CERTIFICATE_PASSWORD
APPLE_SIGNING_IDENTITY
APPLE_API_ISSUER
APPLE_API_KEY
APPLE_API_KEY_PATH
KEYCHAIN_PASSWORD

# litellm, when enabled
LITELLM_DEPLOY_ENABLED
ECR_LITELLM_REPOSITORY
ECS_LITELLM_SERVICE
ECS_LITELLM_CONTAINER_NAME
LITELLM_DATABASE_URL      # secret
LITELLM_MASTER_KEY        # secret
AGENT_GATEWAY_MANAGED_ANTHROPIC_API_KEY # secret
AGENT_GATEWAY_MANAGED_OPENAI_API_KEY    # secret
AGENT_GATEWAY_MANAGED_XAI_API_KEY       # secret
```

For staging, the canonical values are expected to point at staging resources
such as `proliferate-staging`, `staging.proliferate.com`,
`staging-app.proliferate.com`, and
`TEAM_SLUG/proliferate-runtime-cloud:staging`. Production must point at the
production equivalents.

`API_URL` is the public API origin used for deploy smoke checks, such as
`https://staging-app.proliferate.com`. `API_BASE_URL` is the server's canonical
API base URL and keeps the mounted `/api` prefix, such as
`https://staging-app.proliferate.com/api`.

Current hosted staging inventory:

```text
GitHub environment: staging
Web: https://staging.proliferate.com
API health: https://staging-app.proliferate.com/api/health
ECS cluster/service: proliferate-staging / proliferate-staging-server
RDS instance: proliferate-staging
E2B template: pablo-5391/proliferate-runtime-cloud:staging
Apple staging app: Proliferate Staging, ai.proliferate.mobile.staging, ASC 6774573981
```

Current staging environment vars:

```text
AWS_REGION=us-east-1
AWS_DEPLOY_ROLE_ARN=arn:aws:iam::157466816238:role/proliferate-staging-github-actions-deploy
ECS_CLUSTER=proliferate-staging
ECS_SERVER_SERVICE=proliferate-staging-server
ECS_SERVER_TASK_FAMILY=proliferate-staging-server
ECS_SERVER_CONTAINER_NAME=server
ECR_SERVER_REPOSITORY=proliferate-server
WEB_URL=https://staging.proliferate.com
API_URL=https://staging-app.proliferate.com
API_BASE_URL=https://staging-app.proliferate.com/api
API_HEALTH_PATH=/api/health
E2B_TEMPLATE_REF=pablo-5391/proliferate-runtime-cloud:staging
E2B_PUBLIC_TEMPLATE_FAMILY=pablo-5391/proliferate-runtime-cloud
E2B_TEAM_ID=18587c49-ea26-407a-8f22-def12957005f
SUPPORT_REPORT_S3_BUCKET=proliferate-support-reports-dev
SUPPORT_REPORT_S3_PREFIX=support/reports
SUPPORT_REPORT_S3_REGION=us-east-1
SUPPORT_REPORT_INTERNAL_BASE_URL=
SUPPORT_SLACK_WEBHOOK_URL_PARAMETER_NAME=/proliferate/staging/support/slack-webhook-url
SUPPORT_TRACKER_ENABLED=true
SUPPORT_TRACKER_RECONCILER_INTERVAL_SECONDS=30.0
SUPPORT_TRACKER_RECONCILER_BATCH_SIZE=10
SUPPORT_TRACKER_MAX_ATTEMPTS=8
SUPPORT_TRACKER_RETRY_BASE_SECONDS=60.0
SUPPORT_GITHUB_APP_ID=<support-github-app-id>
SUPPORT_GITHUB_APP_INSTALLATION_ID=<support-github-app-installation-id>
SUPPORT_GITHUB_OWNER=proliferate-ai
SUPPORT_GITHUB_REPO=proliferate
SUPPORT_GITHUB_LABEL_SUPPORT=support
SUPPORT_GITHUB_LABEL_PRIVATE=private-details
SUPPORT_GITHUB_APP_PRIVATE_KEY_PARAMETER_NAME=/proliferate/staging/support/github-app-private-key
SUPPORT_LINEAR_TEAM_ID=<support-linear-team-id>
SUPPORT_LINEAR_PROJECT_ID=<optional-support-linear-project-id>
SUPPORT_LINEAR_LABEL_IDS=<optional-comma-separated-linear-label-ids>
SUPPORT_LINEAR_PRIVATE_DETAILS_LABEL_ID=<optional-private-details-linear-label-id>
SUPPORT_LINEAR_API_KEY_PARAMETER_NAME=/proliferate/staging/support/linear-api-key
VERCEL_ENVIRONMENT=staging
VERCEL_TARGET=staging
VERCEL_ORG_ID=team_Ic8IL7bOkRza1fHw7ROqLHSI
VERCEL_PROJECT_ID=prj_IfWCLHwRUgqyCQPUDXmsgxMnECIm
VERCEL_SCOPE=getonyx
MOBILE_DEPLOY_ENABLED=true
APP_VARIANT=staging
EAS_BUILD_PROFILE=staging-testflight
EAS_SUBMIT_PROFILE=staging
EAS_SUBMIT_ENABLED=true
WORKERS_DEPLOY_ENABLED=false
DESKTOP_DEPLOY_ENABLED=<unset; defaults to false>
LITELLM_DEPLOY_ENABLED=true
```

Current hosted production inventory:

```text
GitHub environment: Production
Web: https://web.proliferate.com
API health: https://app.proliferate.com/api/health
ECS cluster/service: proliferate-prod / proliferate-prod-server
RDS instance: proliferate-prod
E2B template: pablo-5391/proliferate-runtime-cloud:production
Support reports bucket: proliferate-support-reports-prod
Desktop downloads: https://downloads.proliferate.com/desktop/stable/
```

Production should keep `WORKERS_DEPLOY_ENABLED=false` until the
hosted worker lane is canonical. `DESKTOP_DEPLOY_ENABLED=true` enables
production promote to publish the desktop updater for SHAs that include a
desktop version bump. Production mobile may be enabled with
`MOBILE_DEPLOY_ENABLED=true` and `EAS_SUBMIT_ENABLED=true`, but this makes
App Store Connect submission part of the production promote gate. For
non-mobile promotes while submission is unhealthy, temporarily set
`MOBILE_DEPLOY_ENABLED=false` or `EAS_SUBMIT_ENABLED=false` before dispatching.
Production support report uploads use the private
`proliferate-support-reports-prod` bucket with the `support/reports` prefix in
`us-east-1`; staging/dev support report uploads use
`proliferate-support-reports-dev` with the same prefix and region.
Production uses
`SUPPORT_SLACK_WEBHOOK_URL_PARAMETER_NAME=/proliferate/production/support/slack-webhook-url`;
staging uses the corresponding `/proliferate/staging/...` path. The deploy
workflow writes the protected environment secret to that SSM SecureString
before rendering the ECS task definition.
Keep `VERCEL_TOKEN` as an environment secret, and keep E2B API credentials as
repo or environment secrets; do not document secret values here.

Mobile/TestFlight operational notes:

- `MOBILE_DEPLOY_ENABLED=true` only means the mobile lane runs.
- The `Build iOS app` step uploads an IPA to EAS Build. That alone does not
  update TestFlight.
- The mobile workflow captures the build id from `Build iOS app` and submits
  that exact build id. Do not change this back to `eas submit --latest`; that
  can race with a newer staging or manual iOS build and submit the wrong IPA.
- The submit step must use the same app identity as the build step. For staging
  this means `APP_VARIANT=staging` so `app.config.ts` resolves
  `ai.proliferate.mobile.staging` during both build and submit.
- TestFlight is updated only after `Submit iOS build` succeeds. If EAS
  reports a finished IPA and then `Something went wrong when submitting your
  app to Apple App Store Connect`, the build did not reach TestFlight.
- Set `EAS_SUBMIT_ENABLED=false` for build-only mobile validation. Leave it
  `true` only when App Store Connect submission is expected to work and a
  failed submit should fail the production promote.

Known failure signatures and what they mean:

- `Submit iOS build` fails after EAS prints `Build finished`, an IPA URL,
  `Scheduled iOS submission`, and then `Something went wrong when submitting
  your app to Apple App Store Connect`: the app was built, but TestFlight was
  not updated. The failure is in EAS Submit/App Store Connect after the IPA
  exists, not in the repository build.
- `EAS_UPLOAD_TO_ASC_VERSION_DUPLICATE`: App Store Connect has already seen the
  app version/build number pair. Production and staging TestFlight profiles use
  EAS remote build numbers with `autoIncrement=true`; check that the submitted
  build is using the intended profile and that the workflow used the captured
  build id, not `--latest`.
- First response: open the Expo submission URL from the job log and check the
  detailed submission error. If the EAS UI does not show a specific app metadata
  or credential error, retry submit for the already-built IPA before changing
  repo code.
- Repo-side fixes are only indicated when the detailed submission error names a
  repository-controlled value, such as bundle identifier, build number/version,
  export method, or missing app metadata. A generic App Store Connect submit
  failure is not enough by itself to identify a code fix.
- E2B cache warnings such as GitHub cache `Failed to save` or `Failed to
  restore` are not deploy failures when the E2B job completes successfully.
- A transient CI failure in an unrelated Rust test should be rerun once before
  blocking a web-only production promote; do not bypass a repeatable failure.

## 5. Source of Truth

| Concern | Canonical files |
| --- | --- |
| Shared CI for Rust, SDK, and desktop frontend | `.github/workflows/ci.yml` |
| Hosted staging deploy | `.github/workflows/deploy-staging.yml`, `.github/workflows/_deploy-*.yml` |
| Hosted production promote | `.github/workflows/promote-production.yml`, `.github/workflows/_deploy-*.yml` |
| Deploy surface detection | `scripts/ci-cd/detect-deploy-surfaces.mjs`, `scripts/ci-cd/resolve-deploy-base.mjs` |
| PR title and release/area label validation | `.github/workflows/pr-metadata.yml` |
| Generated GitHub release-note grouping | `.github/release.yml` |
| PR metadata checklist | `.github/pull_request_template.md` |
| Landing manifest-to-MDX draft PR publisher | `.github/workflows/publish-landing-changelog.yml` |
| Real-provider cloud lifecycle and cloud-backed runtime CI | `.github/workflows/cloud-tests.yml` |
| Live ngrok-backed E2B webhook smoke | `.github/workflows/cloud-live-webhook.yml` |
| Public E2B cloud template build + publish + staging | `.github/workflows/release-cloud-template.yml` |
| Manual public E2B cloud template production promote | `.github/workflows/promote-cloud-template.yml` |
| Desktop packaging and release creation | `.github/workflows/release-desktop.yml` |
| Runtime binary release and npm publish | `.github/workflows/release-runtime.yml` |
| Server CI and tag-gated image publish | `.github/workflows/server-ci.yml` |
| Cloud template builder and publish surface | `scripts/build-template.mjs` |
| Cloud template smoke test | `scripts/smoke-cloud-template.mjs` |
| Cloud template rolling-tag promotion | `scripts/promote-cloud-template.mjs` |
| Updater manifest format | `scripts/generate-updater-manifest.mjs` |
| Updater endpoint and signing public key | `apps/desktop/src-tauri/tauri.conf.json` |
| Frontend updater platform wrapper | `apps/desktop/src/lib/access/tauri/updater.ts` |
| Frontend updater orchestration | `apps/desktop/src/hooks/access/tauri/use-updater.ts` |
| Frontend updater local state | `apps/desktop/src/stores/updater/updater-store.ts` |
| Frontend updater UI surfaces | `apps/desktop/src/components/feedback/UpdateToastPresenter.tsx`, `apps/desktop/src/components/feedback/UpdateRestartDialog.tsx`, `apps/desktop/src/components/workspace/shell/sidebar/SidebarUpdatePill.tsx`, `apps/desktop/src/components/workspace/shell/sidebar/ReleaseNoticeCard.tsx` |
| Desktop updater infra and publish permissions | `apps/desktop/infra/main.tf` |
| Cloud API infra | `server/infra/main.tf` |
| Self-hosted production deploy | `server/deploy/**` |
| Hosted web app | Vercel project `proliferate-web` (team `getonyx`), serving `https://web.proliferate.com/`. Build config: `vercel.json` + `.vercelignore` at repo root. PR previews auto-created via Vercel's GitHub integration. |
