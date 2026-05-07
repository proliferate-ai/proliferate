# CI/CD

Read this doc before touching release workflows, deployment infra, updater
publishing, or the desktop in-app update flow.

## 1. File Tree

```text
.github/workflows/
  ci.yml                     # shared Rust, SDK, and desktop frontend validation
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
desktop/
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
  build-agent-seed.mjs
  generate-desktop-installer-manifest.mjs
  generate-updater-manifest.mjs
```

## 2. Non-Negotiable Rules

- Treat workflows, release scripts, infra, and updater config as one delivery
  surface. Do not update one without checking the others.
- Desktop releases ship off the `desktop-v*` tag line. Runtime releases ship off
  the `runtime-v*` tag line.
- Cloud template releases are manually dispatched. They publish immutable
  `sha-*` tags, then move rolling `staging` and `production` tags separately.
- Desktop versioning must stay consistent across
  `desktop/package.json`, `desktop/src-tauri/tauri.conf.json`, and
  `desktop/src-tauri/Cargo.toml`. The desktop release workflow enforces this on
  tagged releases.
- Do not change updater endpoints, publish paths, or signing behavior in only
  one place. Keep these aligned:
  - `.github/workflows/release-desktop.yml`
  - `scripts/generate-desktop-installer-manifest.mjs`
  - `scripts/generate-updater-manifest.mjs`
  - `desktop/src-tauri/tauri.conf.json`
  - `desktop/infra/main.tf`
- The desktop updater must continue to consume signed artifacts plus
  `latest.json`. Do not add parallel ad hoc install paths.
- Public human download links must consume installer artifacts from
  `installers.json`, not the Tauri updater `latest.json` feed.
- Only packaged desktop builds should auto-check for updates. Development builds
  should remain updater-free.
- `server-ci.yml` validates the server on normal pushes and pull requests.
  Publishing remains tag-gated; this repo does not yet contain the final ECS
  rollout workflow. Do not document a fully automated API deploy path unless it
  actually exists.
- Self-hosted production should center on `server/deploy/**` and GHCR-published
  server images. Do not create a parallel self-hosted deploy path that drifts
  from those files.
- Preserve public artifact names, release channels, and updater URLs unless an
  explicit product change is requested.
- PRs must use the repository release metadata standard before they are marked
  ready for review. Draft PRs are exempt until ready.

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
   - the Rust workspace with `cargo check` and `cargo test`
   - `@anyharness/sdk` generation and build
   - the desktop frontend build
3. `.github/workflows/server-ci.yml` validates the server slice separately with:
   - Ruff
   - pytest against Postgres
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
- `desktop/src-tauri/tauri.conf.json`
- `desktop/infra/main.tf`
- `scripts/generate-desktop-installer-manifest.mjs`
- `scripts/generate-updater-manifest.mjs`

Flow:

1. Bump the desktop version in:
   - `desktop/package.json`
   - `desktop/src-tauri/tauri.conf.json`
   - `desktop/src-tauri/Cargo.toml`
2. Commit and merge the version bump to `main`.
3. From updated `main`, create and push a tag like `desktop-v0.1.0`. The
   workflow triggers automatically.
4. Treat pushing the `desktop-v*` tag as the shipping action. The tag-push
   workflow publishes updater/download assets after the build succeeds, even
   though the GitHub Release remains a draft.
5. After the workflow succeeds, manually review the draft GitHub Release:
   - add a short highlights section at the top
   - clean up generated release notes if needed
   - publish the GitHub Release as the human-facing release page
6. If you must trigger manually, use `--ref desktop-v<VERSION>` — **never
   trigger on `main`**, because the updater manifest version is derived from
   `GITHUB_REF_NAME` and will resolve to `"main"` instead of valid semver.
7. The workflow:
   - validates version consistency on tag pushes
   - builds the AnyHarness sidecar for each desktop target
   - builds exactly one bundled agent seed for that target from
     `desktop/src-tauri/agent-seed.inputs.json`
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
  `desktop/src-tauri/agent-seeds/`. The seed builder cleans previous generated
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
- Manual runs default `publish_updater` to false. Use this to test draft
  GitHub release creation and generated notes without uploading updater assets
  to S3 or invalidating CloudFront.
- Real `desktop-v*` tag pushes still publish updater and download assets
  automatically after the draft GitHub release is created.
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

- `desktop/src-tauri/tauri.conf.json`
- `desktop/src/lib/access/tauri/updater.ts`
- `desktop/src/hooks/access/tauri/use-updater.ts`
- `desktop/src/stores/updater/updater-store.ts`
- `desktop/src/components/settings/UpdateSettings.tsx`
- `desktop/src/components/feedback/UpdateBanner.tsx`

Flow:

1. Tauri reads the updater endpoint from `desktop/src-tauri/tauri.conf.json`.
2. The packaged app checks `https://downloads.proliferate.com/desktop/stable/latest.json`.
3. `desktop/src/lib/access/tauri/updater.ts` is the only frontend wrapper around
   `@tauri-apps/plugin-updater` and relaunch behavior.
4. `desktop/src/hooks/access/tauri/use-updater.ts` owns the UI-facing updater flow:
   - initial delayed check
   - six-hour polling
   - download progress
   - install and relaunch
   - telemetry/error capture
5. `desktop/src/stores/updater/updater-store.ts` owns local updater UI state and
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

- `.github/workflows/server-ci.yml`
- `server/infra/main.tf`

Flow today:

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

- This repo currently automates versioned GHCR image publication on
  `server-v*` tags.
- This repo now also publishes the versioned AWS self-hosted stack template and
  Linux runtime tarball on `server-v*` tags so a CloudFormation launch can
  bootstrap the same `server/deploy/**` surface.
- This repo does not currently contain the final ECS deployment rollout step.
- If you add that rollout later, update this doc, `server/infra/**`, and the
  GitHub workflow together.

## 5. Source of Truth

| Concern | Canonical files |
| --- | --- |
| Shared CI for Rust, SDK, and desktop frontend | `.github/workflows/ci.yml` |
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
| Updater endpoint and signing public key | `desktop/src-tauri/tauri.conf.json` |
| Frontend updater platform wrapper | `desktop/src/lib/access/tauri/updater.ts` |
| Frontend updater orchestration | `desktop/src/hooks/access/tauri/use-updater.ts` |
| Frontend updater local state | `desktop/src/stores/updater/updater-store.ts` |
| Frontend updater UI surfaces | `desktop/src/components/settings/UpdateSettings.tsx`, `desktop/src/components/feedback/UpdateBanner.tsx` |
| Desktop updater infra and publish permissions | `desktop/infra/main.tf` |
| Cloud API infra | `server/infra/main.tf` |
| Self-hosted production deploy | `server/deploy/**` |
