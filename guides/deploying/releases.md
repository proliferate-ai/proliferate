# Releases

This procedure operates `release.yml` and the artifact publishers. Hosted
staging and production redeploys are covered by [Hosted Deployments](hosted.md).
Before a production run, follow the authority and qualification requirements in
[the CD line](../../specs/engineering/ci-cd/README.md#5--the-cd-line) and
[the prod pipeline](../../specs/engineering/ci-cd/pipelines.md#pipeline--prod).
Artifact identities and current wiring belong to the
[Delivery system](../../specs/engineering/ci-cd/release-delivery.md).

## Before Running A Release

1. Resolve the exact `main` SHA and confirm required CI and qualification.
2. Inspect the workflow plan, selected surfaces, versions, and tags. A public
   product version, artifact tag, and exact source SHA are distinct identities.
3. Use [Environment Sources](../local/dev-profiles.md#environment-sources) to locate
   required settings. Never copy secrets into release notes, prompts, or logs.
4. Use a dry run when changing selection or version inputs, and do not treat it
   as a published release or deploy.
5. After the run, verify each selected artifact, deploy summary, and raw product
   GitHub Release independently.

## Release Coordinator

Use **Release** (`.github/workflows/release.yml`). It runs on manual dispatch
and the transitional daily 09:00 UTC cron described in
[the CD line](../../specs/engineering/ci-cd/README.md#5--the-cd-line).
Hotfix and deploy-only runs use inputs on this same workflow; the old
`nightly-release-train.yml`, `hotfix-production.yml`, and
`promote-production.yml` entrypoints no longer exist.

Start with a plan when validating inputs or wiring:

```bash
gh workflow run release.yml --ref main -f dry_run=true
```

Inspect the prepare job's selected surfaces, resolved head, versions, and tags.
After obtaining the production authorization required by the CD line, the
standard release command is:

```bash
gh workflow run release.yml --ref main
```

The four dispatch inputs are:

| Input | How to use it |
| --- | --- |
| `surfaces` | Default `all` enables change detection since the previous `release-*` checkpoint; it does not force every surface to run. A comma-separated list is an exact override. |
| `ref` | Default `main`. Use an exact approved commit for a hotfix or redeploy; it must have reached `main`. |
| `skip_build` | Default `false`. Set `true` for a hosted redeploy without artifact releases, version bumps, tags, or a product release page. Use an explicit surface list; an empty detected selection is rejected. |
| `dry_run` | Default `false`. Set `true` to compute the plan without committing, tagging, publishing, or deploying. Artifact builds are skipped and deploy lanes receive `enabled: false`; this is wiring proof, not build or runtime proof. |

This coordinator has jobs for `runtime`, `server`, `desktop`, `litellm`, and
`web`: Runtime/SDK, Server/self-host, and Desktop artifact releases, plus
Server, LiteLLM, and Web production deploys. The detector also accepts `e2b`,
`mobile`, and `workers`, but selecting those does not create a release job.
Use the standalone [E2B template entrypoints](#e2b-template-family) for E2B.

On a build run, prepare may commit version bumps to `main` and create the
checkpoint, product, and artifact tags. Its version-bump push requires the
repository's `RELEASE_PUSH_TOKEN`; a missing token fails before that commit is
pushed. Inspect the plan's final head SHA, which can include this version bump,
rather than assuming the dispatch SHA is the artifact SHA.

Server and LiteLLM production deploys run from prepare in parallel. Web waits
for a selected Server deploy to succeed. The raw product GitHub Release waits
for selected artifact releases, **not** for production deploys. Desktop updater
publication also starts from prepare and has no staging dependency or GitHub
Environment binding. Verify those outputs independently; a published release
page does not prove a successful production rollout.

## Production Hotfix

Use an exact approved `ref` and an exact `surfaces` list on `release.yml`.
Replace the placeholder below with the intended commit that reached `main`:

```bash
gh workflow run release.yml --ref main \
  -f ref="<approved-main-sha>" -f surfaces=server,litellm -f dry_run=true
```

Inspect the plan, then repeat with `dry_run=false` only for the authorized
production action. A hotfix with `skip_build=false` uses the same version,
artifact, and product-release path as an ordinary release; it is not a separate
coordinator or a `hotfix-*` ledger.

For a hosted redeploy without new artifact identities, use
[Manual Production Promotion](hosted.md#manual-production-promotion).
`skip_build` still rebuilds hosted images from the chosen source SHA; it does
not promote the bytes previously tested in staging. Desktop and Runtime
publication require the artifact build path, not a deploy-only run.

## Desktop

Desktop releases use `desktop-v<version>` and validate version agreement across
the Desktop package, Tauri configuration, and Cargo package. A manual dry run
can build from the selected ref without publishing. A manual non-dry run must
be dispatched from an existing `desktop-v*` tag ref; a branch ref fails release
validation. Tag pushes and publishing release-coordinator calls can build the
current macOS and Windows matrix and create a draft GitHub Release.
Updater/download publication is separate:

- a `desktop-v*` tag push publishes it automatically;
- a publishing reusable call, including `release.yml`, can request it explicitly;
- a manual run defaults to not publishing it.

Publishing the GitHub Release alone does not make the updater live. The updater
job publishes signed versioned artifacts plus immutable and rolling
`latest.json` and public `installers.json` manifests. Verify both the GitHub
Release and the live manifests. Product-side update behavior remains owned by
[Desktop Updates](../../specs/engineering/ci-cd/desktop-updates.md).

For each macOS target, the Desktop release lane builds the diagnostics
collector package first and stages that exact executable into the app. Verify
the app's `Contents/MacOS` inventory contains executable, signed AnyHarness,
Worker, `proliferate-debug`, and `proliferate-diagnostics-collector` binaries;
the collector must not contain the debug placeholder marker.

### Windows Beta

Windows (`x86_64-pc-windows-msvc`) returned to the matrix on 2026-08-20, having been removed on 2026-04-13 while the SDK generation step was POSIX-shell only. It is a beta leg, it is deliberately not release-blocking, and it is opt-in only:

- the Windows matrix entry is skipped unless the caller explicitly sets `enable_windows_beta: true`. Both automatic callers (`deploy-staging.yml` through `_deploy-desktop.yml`, and `release.yml` directly) leave it at `false`, and a plain `desktop-v*` tag push carries no inputs at all, so it also defaults to `false`. Only an explicit `workflow_dispatch` run with `enable_windows_beta: true` builds Windows;
- the Windows matrix entry also runs `continue-on-error`, so on the runs where it is enabled, a failed Windows build leaves the macOS release and the updater publish intact;
- `windows-x86_64` is an `optional` platform in both `scripts/generate-updater-manifest.mjs` and `scripts/generate-desktop-installer-manifest.mjs`, so a release with no Windows artifact publishes without a Windows entry rather than failing;
- the Windows installer is not Authenticode signed, so first launch shows a SmartScreen warning that the user clicks through. The Tauri updater's minisign signature is a separate mechanism and is applied, so in-app updates still verify;
- `proliferate-diagnostics-collector` does not compile for Windows, so the Windows build ships a placeholder sidecar and has no in-app diagnostics capture or support snapshot;
- there is no bundled agent seed on Windows. `agent-seed.inputs.json` pins Node only for the two Apple targets and `scripts/build-agent-seed.mjs` is native-macOS-only, so a Windows build sets `ANYHARNESS_AGENT_SEED_EXPECTED` with no seed present and agent installs depend on a Node runtime already present on the machine. The managed agent launcher is Windows-capable since PR #2152 (a `.cmd` launcher replaces the POSIX `#!/bin/sh` script on Windows), and agent install, spawn, launcher execution, and ACP initialize were proven on a real Windows build in PR #2165, so agent sessions do start on Windows builds when Node is available.

The build logs a warning annotation for each of those gaps.

To make Windows release-blocking, delete the `continue-on-error` line from `build-desktop` and drop `optional` from the `windows-x86_64` entries. To make it build automatically on one of the existing pipelines, pass `enable_windows_beta: true` from that caller.

## Runtime And SDK

Runtime releases use `runtime-v<version>`. The workflow builds AnyHarness
binaries for supported macOS, Linux, and Windows targets, publishes archives
and `SHA256SUMS` to the GitHub Release, generates and publishes
`@anyharness/sdk`, and publishes CDN coordinates when configured.
`@anyharness/sdk-react` exists in the workspace but is not published by this
lane. Manual dispatch is a validation/build path and has no `publish` input;
npm, GitHub Release, and CDN publication require either a `runtime-v*` tag push
or a publishing reusable-workflow call.

## Server And Self-Host

Server/self-host releases use `server-v<version>`. The `release-server` job in
`release.yml` calls `_build-server.yml` with `publish: true` to publish server
and LiteLLM GHCR images under the version and rolling `stable` tags, plus the
self-host assets. Commit-SHA GHCR tags are not produced. `server-ci.yml` is
validation-only; manually pushing a `server-v*` tag no longer starts a release.
Use the release coordinator's `server` surface for publication.

The LiteLLM wrapper and the direct local-development service both consume the
exact upstream coordinate recorded in the Delivery system contract. Treat an
upstream change as one reviewed tag-and-digest update: verify an official
non-prerelease tag, confirm its GHCR OCI-index digest and Linux amd64/arm64
manifests, confirm the image's source-revision label matches the release commit,
and check the configured models and management API against that source. Never
substitute `main-stable`, another floating tag, or a version tag without its
digest. Run `node --test scripts/ci-cd/litellm-image-pin.test.mjs` after an
update; the test binds both build surfaces to the reviewed coordinate.

The `server-v<version>` GitHub Release contains exactly these seven self-host
assets:

```text
anyharness-x86_64-unknown-linux-musl.tar.gz
anyharness-aarch64-unknown-linux-musl.tar.gz
proliferate-self-hosted-aws-template.yaml
proliferate-selfhost-install.sh
proliferate-selfhost-aws-launch.sh
proliferate-deploy.tar.gz
self-hosted-assets.SHA256SUMS
```

Verify the checksum manifest and every expected asset before announcing or
using the release. Installation and update steps live in
[Self-hosted Deployment](self-hosted-deploy.md) and
[Self-hosted AWS](self-hosted-aws.md).

## E2B Template Family

Use the two standalone workflows for the template coordinate family:

- `Release Cloud Template` (`release-cloud-template.yml`) manually builds and
  smokes immutable `sha-<12>`, then moves rolling `staging`;
- `Promote Cloud Template` (`promote-cloud-template.yml`) manually re-smokes a
  selected immutable tag, then moves rolling `production`.

Neither ordinary staging nor `release.yml` invokes a template deploy lane.
Verify the immutable tag first, then verify which rolling tag points to it.
Moving a production tag requires the same explicit production authority.

## Qualification Workflows

Use `release-e2e.yml` and `release-e2e-selfhost.yml` for their respective
qualification surfaces, following the evidence requirements in
[Testing](../../specs/engineering/testing/release.md) and
[Manual release QA](manual-release-qa.md). Inspect their triggers and caller
dependencies at the candidate SHA; the existence of a qualification workflow
does not prove the release coordinator invoked it. Record the actual run and
verdict before reporting a candidate as qualified.

## Raw Product Release And Landing Boundary

The release coordinator produces a raw GitHub Release ledger from merged PR
metadata on build runs. Verify its `proliferate-v<version>` tag, final source
SHA, generated notes, and referenced artifact releases. The `release-*` tag is
only a checkpoint. Deploy-only runs produce no new product release page, and
no current coordinator mints a `hotfix-*` ledger.

That raw release is the only release ledger. There is no checked-in
release-manifest publisher/finalizer or landing-changelog publisher (the
issue-lifecycle system that owned that target was retired in the 2026-08
engineering cull). Do not invent a manual publisher command or claim that
the current raw release script performs those steps.
