# CI/CD

Read this doc before touching release workflows, deployment infra, updater
publishing, or the desktop in-app update flow.

## Agent Deployment Runbook

Use this section when another agent is asked to deploy a merged change to
staging or production. The detailed reference sections below explain how the
workflows are built; this section is the operator path.

Safe prompt to give an agent:

```text
Read docs/dev/ci-cd.md, then deploy <surface or all> to <staging or production>
from latest main. Watch the GitHub Actions run end to end, approve required
environment gates, fix or report any failing lane with the exact failing job
and logs, and verify the deployed URLs/artifacts before finishing.
```

Before deploying:

1. Confirm the target commit is on `main`.
2. Confirm CI passed for that commit.
3. Decide whether this is a normal detected-surface deploy, a forced full
   deploy, or a deliberately gated partial deploy.
4. Inspect the target environment gates before dispatching:
   - `MOBILE_DEPLOY_ENABLED`
   - `EAS_SUBMIT_ENABLED`
   - `DESKTOP_DEPLOY_ENABLED`
   - `WORKERS_DEPLOY_ENABLED`
5. Do not print or document secret values. If a secret is invalid, update the
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
dry_run: false
```

For a staging plan only, use `dry_run=true` and do not treat it as a deploy.

### Production

Production is promoted manually from a staging-tested commit:

```text
Workflow: Promote Production
ref: <main SHA>
force_surfaces: <blank, comma-separated surfaces, or all>
require_staging_success: true
dry_run: false
```

Normal production flow:

1. Confirm a successful `Deploy Staging` run exists for the exact `main` SHA.
2. Dispatch `Promote Production` with `require_staging_success=true`.
3. Approve the GitHub `Production` environment gates as they appear.
4. Watch every selected lane until completion.
5. Verify the production surfaces that ran.

Bypass `require_staging_success` only when explicitly directed. If bypassing
staging, the agent must state that staging was bypassed and should watch the
E2B lane closely because production will build and smoke the immutable template
before moving the rolling production tag.

### Surface Selection

The workflow detects deploy surfaces from the diff against the previous
successful deploy. `force_surfaces` is additive: it adds surfaces to whatever
the diff already detected. It is not an "only these surfaces" filter.

Use these values:

```text
force_surfaces=<blank>  # deploy only detected surfaces
force_surfaces=all      # deploy every lane that is enabled by env gates
force_surfaces=web      # deploy detected surfaces plus web
```

If the intent is "only web" but the diff also detects mobile, server, E2B, or
desktop, do not assume `force_surfaces=web` will suppress the other lanes.
Temporarily use the relevant environment gate only when the operator explicitly
wants a lane suppressed.

### Verification

Always verify the surfaces that actually ran:

```text
API production: curl -fsS https://app.proliferate.com/api/health
API staging: curl -fsS https://staging-app.proliferate.com/api/health

Web production: curl -I https://web.proliferate.com/
Web staging: curl -I https://staging.proliferate.com/

Desktop stable updater:
curl -fsS https://downloads.proliferate.com/desktop/stable/latest.json

Mobile/TestFlight:
Confirm EAS submit finished for the exact build id produced by the build step,
then confirm App Store Connect/TestFlight processing for the matching app,
version, and build number.

E2B:
Confirm the deploy job promoted the expected rolling tag (`staging` or
`production`) and the smoke step passed.
```

When reporting back, include the workflow run URL, commit SHA, surfaces that
ran, skipped lanes, verification results, and any follow-up needed.

### Failure Rules

- Do not call a deploy successful while a selected lane is still running,
  waiting for approval, failed, or canceled.
- If web fails on `vercel pull` or `vercel deploy` with an invalid token,
  refresh the `VERCEL_TOKEN` environment secret from a valid local or
  organization token; never paste the token in chat or docs.
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
  _deploy-mobile.yml         # reusable EAS/TestFlight lane, gated until app identity is ready
  _deploy-desktop.yml        # reusable desktop release lane, gated until beta/stable channel split
  cloud-tests.yml            # real-provider cloud lifecycle + cloud-backed runtime suites
  cloud-live-webhook.yml     # manual/nightly live E2B webhook delivery smoke
  release-cloud-template.yml # public E2B cloud template build + publish + staging promote
  promote-cloud-template.yml # manual production promote for public E2B templates
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
  src/hooks/access/tauri/use-updater.ts
  src/stores/updater/updater-store.ts
  src/components/settings/UpdateSettings.tsx
  src/components/feedback/UpdateBanner.tsx
server/
  infra/main.tf              # ECR, ECS, RDS, and server runtime infra
  deploy/                    # self-hosted production compose + update scripts
scripts/
  ci-cd/
    detect-deploy-surfaces.mjs
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
- Desktop releases create/use the `desktop-v*` tag line. Runtime releases ship
  off the `runtime-v*` tag line.
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
  mobile, shared-package, and workflow-config checks.
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
   - shared frontend package typecheck/build/tests
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
   - cloud lifecycle/provisioning coverage for E2B and Daytona
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
   - generates `latest.json`
   - generates `installers.json`
   - uploads signed updater artifacts and public DMG installers to
     `s3://.../desktop/stable/`
   - uploads `latest.json` and `installers.json`
   - invalidates the CloudFront cache for both manifests

Note:

- The current desktop release matrix is macOS-only. Windows packaging and
  updater entries are temporarily disabled until the SDK generation step is
  Windows-safe.
- `latest.json` is reserved for Tauri updater clients and intentionally points
  at `.app.tar.gz` archives plus signatures. Public download pages should use
  `installers.json`, which points at the user-facing DMG installers.
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
- Publishing the GitHub Release does not make the updater live. The updater is
  made live by the tag-push workflow's S3/CloudFront publish step. The GitHub
  Release is the public release-notes and artifact archive surface.
- The release workflow is intentionally fail-closed now: manifest generation
  happens before S3 upload so a broken manifest does not leave a partial updater
  publish behind.

Useful local wrappers:

```bash
# Safe build-only workflow dry run. Creates no GitHub release and publishes no updater assets.
make release-desktop-dry-run DESKTOP_RELEASE_REF=feat/my-branch

# Draft GitHub release preview from an already-pushed desktop tag.
# Creates a draft release with generated notes, but does not publish updater assets.
make release-desktop-draft DESKTOP_RELEASE_TAG=desktop-v0.1.28
```

### Desktop In-App Update Flow

Source of truth:

- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/src/lib/access/tauri/updater.ts`
- `apps/desktop/src/hooks/access/tauri/use-updater.ts`
- `apps/desktop/src/stores/updater/updater-store.ts`
- `apps/desktop/src/components/settings/UpdateSettings.tsx`
- `apps/desktop/src/components/feedback/UpdateBanner.tsx`

Flow:

1. Tauri reads the updater endpoint from `apps/desktop/src-tauri/tauri.conf.json`.
2. The packaged app checks `https://downloads.proliferate.com/desktop/stable/latest.json`.
3. `apps/desktop/src/lib/access/tauri/updater.ts` is the only frontend wrapper around
   `@tauri-apps/plugin-updater` and relaunch behavior.
4. `apps/desktop/src/hooks/access/tauri/use-updater.ts` owns the UI-facing updater flow:
   - initial delayed check
   - six-hour polling
   - download progress
   - install and relaunch
   - telemetry/error capture
5. `apps/desktop/src/stores/updater/updater-store.ts` owns local updater UI state and
   the persisted `lastCheckedAt` timestamp.
6. `UpdateSettings.tsx` and `UpdateBanner.tsx` are the user-facing entrypoints.

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

Deploy graph:

1. Resolve base/head:
   - staging diffs against the last successful `deploy-staging.yml` run
   - production diffs against the last successful `promote-production.yml` run
2. Detect changed surfaces:
   - `server`
   - `workers`
   - `e2b`
   - `web`
   - `mobile`
   - `desktop`
   - `runtime`
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
4. Upload a deploy summary artifact.

Important: `force_surfaces` is additive. It forces listed surfaces to deploy in
addition to any surfaces detected from the diff; it is not an "only these
surfaces" filter. Do not use `force_surfaces=web` when the diff also detects
mobile/E2B/server and the intent is web-only. Until an explicit
`only_surfaces`/`skip_surfaces` input exists, use the per-lane environment
gates to suppress unwanted lanes before dispatch.

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
DESKTOP_CHANNEL=beta
```

The production GitHub environment currently exists as `Production`; the
workflow input still uses `production`, which GitHub resolves to that existing
environment. Production should keep `WORKERS_DEPLOY_ENABLED=false` until the
hosted worker lane is canonical. `DESKTOP_DEPLOY_ENABLED=true` enables
production promote to publish the desktop updater for SHAs that include a
desktop version bump. Production mobile may be enabled with
`MOBILE_DEPLOY_ENABLED=true` and `EAS_SUBMIT_ENABLED=true`, but this makes
App Store Connect submission part of the production promote gate. For
non-mobile promotes while submission is unhealthy, temporarily set
`MOBILE_DEPLOY_ENABLED=false` or `EAS_SUBMIT_ENABLED=false` before dispatching.
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
| Frontend updater UI surfaces | `apps/desktop/src/components/settings/UpdateSettings.tsx`, `apps/desktop/src/components/feedback/UpdateBanner.tsx` |
| Desktop updater infra and publish permissions | `apps/desktop/infra/main.tf` |
| Cloud API infra | `server/infra/main.tf` |
| Self-hosted production deploy | `server/deploy/**` |
| Hosted web app | Vercel project `proliferate-web` (team `getonyx`), serving `https://web.proliferate.com/`. Build config: `vercel.json` + `.vercelignore` at repo root. PR previews auto-created via Vercel's GitHub integration. |
