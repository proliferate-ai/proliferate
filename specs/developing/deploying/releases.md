# Releases

This procedure covers release coordinators and artifact publication. Hosted
staging and manual production promotion are covered by
[Hosted Deployments](hosted.md). Release qualification belongs to
[Testing](../testing/README.md).

## Before Running A Release

1. Resolve the exact `main` SHA and confirm required CI and qualification.
2. Inspect the workflow plan, selected surfaces, versions, and tags. A public
   product version, artifact tag, and exact source SHA are distinct identities.
3. Use [Environment Sources](../reference/environment-sources.md) to locate
   required settings. Never copy secrets into release notes, prompts, or logs.
4. Use a dry run when changing selection or version inputs, and do not treat it
   as a published release or deploy.
5. After the run, verify each selected artifact, deploy summary, and raw product
   GitHub Release independently.

## Nightly Release Train

`Nightly Release Train` runs on a daily schedule or manually. It detects
changes since the preceding `release-*` checkpoint unless `only_surfaces`
selects an exact set. Its prepare job resolves the train, public product, and
artifact versions; may commit version bumps to `main`; and creates the selected
train/product/artifact tags.

The train then:

1. releases selected Runtime/SDK, Server/self-host, and Desktop artifacts;
2. deploys selected E2B, Server, Worker, Web, and Mobile surfaces to staging;
3. runs the corresponding production jobs after each staging dependency
   succeeds; and
4. publishes the raw product GitHub Release when its selected artifact-release
   and staging dependencies succeed.

The raw product release does **not** depend on nightly production jobs. It can
appear while production is still running or when production later fails.
Desktop updater publication is a separate release call directly from prepare:
it has no staging dependency and no GitHub Environment binding.

Nightly production is zero-touch only while the `Production` GitHub Environment
does not require a reviewer. The train has no LiteLLM job; use manual
[production promotion](hosted.md#manual-production-promotion) for an exact
LiteLLM ref.

## Production Hotfix

`Hotfix Production` is a manual exact-surface path from `main`. Provide the
exact ref, exact `only_surfaces`, operator-facing reason, version-bump choice,
and dry-run choice. It prepares the corresponding tags and versions, runs the
selected artifact and production jobs, and publishes a raw product release
only when every selected artifact-release and production job succeeds. A
Runtime-only hotfix waits for its Runtime release even though it has no
production deploy job.

This dependency graph intentionally differs from nightly. It also has no
LiteLLM job, so use manual production promotion when LiteLLM is the requested
surface.

## Desktop

Desktop releases use `desktop-v<version>` and validate version agreement across
the Desktop package, Tauri configuration, and Cargo package. A manual dry run
can build from the selected ref without publishing. A manual non-dry run must
be dispatched from an existing `desktop-v*` tag ref; a branch ref fails release
validation. Tag pushes and publishing release-coordinator calls can build the
current macOS matrix and create a draft GitHub Release. Updater/download
publication is separate:

- a `desktop-v*` tag push publishes it automatically;
- a reusable production or train call can request it explicitly;
- a manual run defaults to not publishing it.

Publishing the GitHub Release alone does not make the updater live. The updater
job publishes signed versioned artifacts plus immutable and rolling
`latest.json` and public `installers.json` manifests. Verify both the GitHub
Release and the live manifests. Product-side update behavior remains owned by
[Desktop Updates](../../codebase/systems/engineering/delivery/desktop-updates.md).

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

Server/self-host releases use `server-v<version>`. They publish server and
LiteLLM GHCR images under the version and rolling `stable` tags; commit-SHA
GHCR tags are not produced. Manual dispatch is validation-only; GHCR and
release-asset publication require either a `server-v*` tag push or a publishing
reusable-workflow call.

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

Three entrypoints operate on one template coordinate family:

- the reusable deploy lane builds and/or promotes during hosted staging and
  production;
- `Release Cloud Template` manually builds and smokes immutable
  `sha-<12>`, then moves rolling `staging`;
- `Promote Cloud Template` manually re-smokes a selected immutable tag, then
  moves rolling `production`.

These are not three artifact identities. Verify the immutable tag first, then
verify which rolling tag points to it.

## Qualification Workflows

`Release E2E` and `Release E2E — Self-hosting` run on schedules and manually.
The self-host workflow also exposes a reusable trigger, but no current release
coordinator calls it. Its artifact-chain job is therefore not a release gate
today, even though Testing's target requires an every-release gate. Do not
infer coordinator wiring from the presence of `workflow_call`.

## Raw Product Release And Landing Boundary

The train and hotfix scripts produce a raw GitHub Release ledger from merged PR
metadata. Verify its tag (`proliferate-v<version>` or the applicable no-version
`hotfix-*` tag), source SHA, generated notes, and referenced artifact releases.

That raw release is not the consent-safe Issue Lifecycle release manifest.
There is no checked-in release-manifest publisher/finalizer or landing-
changelog publisher. [Issue Lifecycle](../../codebase/systems/engineering/issue-lifecycle/support-loop.md)
owns the target manifest, Support projection, finalizer validation, and future
landing publication. Do not invent a manual publisher command or claim that
the current raw release script performs those steps.
