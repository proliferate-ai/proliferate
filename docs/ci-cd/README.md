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
  release-desktop.yml        # desktop packaging, draft release, updater publish
  release-runtime.yml        # AnyHarness binary release + npm publish for @anyharness/sdk
  server-ci.yml              # server lint/test/build-and-push image pipeline
desktop/
  infra/main.tf              # updater bucket, CloudFront, GitHub OIDC release role
  src-tauri/tauri.conf.json  # updater endpoint, public key, bundle config
  src/platform/tauri/updater.ts
  src/hooks/updater/use-updater.ts
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

## 3. Delivery Flows

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
2. Push a tag like `desktop-v0.1.0`. The workflow triggers automatically.
   If you must trigger manually, use `--ref desktop-v<VERSION>` — **never
   trigger on `main`**, because the updater manifest version is derived from
   `GITHUB_REF_NAME` and will resolve to `"main"` instead of valid semver.
3. The workflow:
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
   - creates a draft GitHub release
4. The updater publish job then:
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
- The release workflow is intentionally fail-closed now: manifest generation
  happens before S3 upload so a broken manifest does not leave a partial updater
  publish behind.

### Desktop In-App Update Flow

Source of truth:

- `desktop/src-tauri/tauri.conf.json`
- `desktop/src/platform/tauri/updater.ts`
- `desktop/src/hooks/updater/use-updater.ts`
- `desktop/src/stores/updater/updater-store.ts`
- `desktop/src/components/settings/UpdateSettings.tsx`
- `desktop/src/components/feedback/UpdateBanner.tsx`

Flow:

1. Tauri reads the updater endpoint from `desktop/src-tauri/tauri.conf.json`.
2. The packaged app checks `https://downloads.proliferate.com/desktop/stable/latest.json`.
3. `desktop/src/platform/tauri/updater.ts` is the only frontend wrapper around
   `@tauri-apps/plugin-updater` and relaunch behavior.
4. `desktop/src/hooks/updater/use-updater.ts` owns the UI-facing updater flow:
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

## 4. Source of Truth

| Concern | Canonical files |
| --- | --- |
| Shared CI for Rust, SDK, and desktop frontend | `.github/workflows/ci.yml` |
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
| Frontend updater platform wrapper | `desktop/src/platform/tauri/updater.ts` |
| Frontend updater orchestration | `desktop/src/hooks/updater/use-updater.ts` |
| Frontend updater local state | `desktop/src/stores/updater/updater-store.ts` |
| Frontend updater UI surfaces | `desktop/src/components/settings/UpdateSettings.tsx`, `desktop/src/components/feedback/UpdateBanner.tsx` |
| Desktop updater infra and publish permissions | `desktop/infra/main.tf` |
| Cloud API infra | `server/infra/main.tf` |
| Self-hosted production deploy | `server/deploy/**` |
