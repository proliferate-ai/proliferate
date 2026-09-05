# Delivery System

## Foundation qualification branch

On `codex/foundation-signing`, `release-desktop.yml` temporarily packages the fixed
foundation candidate `068b8c37660baf66cce956f40ed7d9a6177c9335`. Dispatch verifies
its private source archive checksum, builds before loading signing credentials,
signs bundled Node before recording its final hash, signs and notarizes the app,
and retains the signed ZIP plus verification receipt as a private workflow artifact.
The frontend includes the verified desktop Sentry DSN. Its build must have matching
injected debug ids and source maps for every JavaScript asset before upload; maps
are then removed and checked absent before Tauri embeds that same frontend.
The existing Apple credentials stay in this repository. This branch does not create
a public release or publish an updater, and its dispatch lane sunsets September 11,
2026. It is an isolated qualification adapter; the main-branch delivery topology
below is unchanged. Installed OAuth and subsequent-version replacement are separate
qualification steps and are not asserted by the signing receipt.

Expands: [README.md#5--the-cd-line](README.md#5--the-cd-line)

Delivery owns the repository's artifact identities and the topology that builds, deploys, promotes, and publishes them. It describes what the checked-in automation does **today**; the ruled direction it converges toward (continuous staging, one artifact base, deliberate prod promote) is [pipelines.md](pipelines.md). Operator steps live in [Developing: Deploying](../../../guides/deploying/README.md).

## Identities

These coordinates are related, but none substitutes for another:

| Coordinate | Meaning |
| --- | --- |
| Exact Git SHA | Source identity used to plan and execute hosted deploys. Staging and production summary artifacts record it. |
| `VERSION` / `proliferate-v<version>` | Public product version and raw product GitHub Release coordinate. |
| `desktop-v<version>` | Desktop package and updater release coordinate. |
| `runtime-v<version>` | AnyHarness runtime archive and `@anyharness/sdk` release coordinate. |
| `server-v<version>` | Server/self-host release coordinate. Its GHCR images use the version and rolling `stable` tags. |
| E2B `sha-<12>` | Immutable cloud-template identity. Rolling `staging` and `production` tags select an immutable build from the same template family. |
| `release-YYYY-MM-DD` | Release checkpoint marker, not an artifact version. No checked-in workflow mints a `hotfix-*` ledger identity any more; `publish-product-release.mjs` keeps an uncalled `hotfix` mode. |

The self-host CloudFormation template is one of the assets attached to a `server-v*` release; it is not a separate release coordinate. A public product version does not identify an exact artifact build unless the corresponding artifact tag and source SHA are also known.

The Proliferate LiteLLM wrapper has a separate upstream input coordinate. Both `server/litellm/Dockerfile` and local development Compose bind `ghcr.io/berriai/litellm:v1.93.0@sha256:a1745e629abfb17d434426ff48b115f54f4f4c4a0f5af241de569e93c63c411e`. The digest identifies the official multi-architecture OCI index and the tag makes its reviewed release legible; neither may be replaced by a floating or tag-only reference. This pin preserves Proliferate's checked-in model config, LiteLLM management API contract, and existing `$5` team/key enrollment cap. The selected upstream source contains the bounded per-request budget reservation behavior, so a request without `max_tokens` does not reserve all remaining budget headroom while it is in flight.

## Topology

### Hosted spine

Delivery has three states. Main is a commit that passed CI. Staging is the continuously-deployed environment the nightly battery qualifies. Production is what customers run. The transitions are thin workflow files; the deploy logic itself lives in the reusable `_deploy-*.yml` lanes.

**Green main auto-deploys staging** (#2269, per the 2026-08-26 CD ruling — [pipelines.md](pipelines.md); supersedes #2140's manual-only doctrine): `deploy-staging.yml` fires on CI success at `main`, trusting only pushes to this repository's `main` (#2279), with manual dispatch retained for re-deploys. Its internals are unchanged: it resolves the exact SHA, detects or explicitly selects surfaces, waits for matching Server CI when such a run exists, invokes the reusable staging lanes, and writes a summary artifact. The Desktop staging lane validates and builds only; it does not publish the updater.

`release.yml` is the single transition from `main` to production, and production deploys from its prepare job rather than from a staging result. A manual dispatch takes four inputs: `surfaces` (default `all`), `skip_build`, `ref` (default `main`), and `dry_run`. A hotfix is an exact `ref` plus an exact `surfaces` set. A promotion of an already-built ref is `skip_build`. Neither is a separate workflow file. An explicit `ref` must be an ancestor of `main`, so production only ever ships commits that reached `main`. A scheduled run supplies no inputs, so every default applies and `dry_run` is false.

Nothing in the pipeline asks for approval. Dispatching a run is the authorization, and the 09:00 UTC cron needs none.

The live E2B webhook workflow is manual-only and is not part of ordinary CI, staging, or the release pipeline. The E2B, mobile, and standalone Worker reusable lanes were deleted with the coordinators that were their only callers; the Celery worker and Beat services still deploy inside `_deploy-server.yml`, which is a different thing from the retired `_deploy-workers.yml` no-op.

Hosted Playwright and Cargo Tauri dependency steps normalize the known Ubuntu runner mirror indirection to the canonical archive immediately before apt-managed installs; the required dependency sets are unchanged.

See the [Hosted procedure](../../../guides/deploying/hosted.md).

### Background plane topology

`_deploy-server.yml` builds one exact-SHA server image that the API, the Celery worker, and the Celery Beat scheduler all run. Its rollout order is migrations → broker/scheduler-store verify → worker + Beat → worker/Beat health (which also asserts the running task definitions carry the candidate image) → candidate-plane execution proof → API roll. This ordering guarantees a newly rolled API never enqueues a task name that no running worker can import.

Resource health is not sufficient on its own — a `runningCount` of 1 does not prove the plane can execute work (broker credentials, task routing, worker task-registry import, RedBeat state, or relay publish/consume could all be broken while the container is up). Before the API rolls, the workflow enqueues one committed health no-op — keyed to this exact run and run-attempt, so a rerun enqueues a fresh row rather than replaying a prior attempt's already-published one — via a one-off task on the candidate worker task definition, then observes BOTH a fresh relay-heartbeat advance (Beat dispatched `background.relay` and a worker ran it, so the scheduler store and broker are reachable) AND an **exact-id** execution receipt for that specific enqueued row. The receipt is a structured log line the health task emits on success carrying its own task id (which the relay sets equal to the enqueued outbox id); the gate matches on that id, so an aggregate success count advanced by a concurrent deploy, an operator smoke, or a retry does **not** satisfy it — only execution of the row this attempt enqueued does. It **fails closed** on timeout. The heartbeat rides the plane's own CloudWatch metric namespace (`Proliferate/Background/<env>`) and the receipt is read from the server log group (derived from the environment name), so the proof references no broker/store resource ID and the identical gate covers both the managed-AWS-IDs path and the external-endpoint rebind path.

The worker/Beat rollout is **conditional and fails closed as a set**. It runs only when both the worker and Beat service names are configured on the environment; a partial configuration (one set, the other empty) aborts the whole deploy rather than silently skipping the background plane and rolling the API alone. When neither is configured, the workflow deploys the API exactly as before. The re-image step also asserts that exactly one container matches each configured name and that the registered task definition carries the candidate image, so a mistyped container name fails closed instead of rolling the old image. Before either worker or Beat task definition is registered, the same checked-in hosted contract must match its execution role and its one direct `REDBEAT_REDIS_URL` reference by source service, account, region, and environment-owned name; duplicate, plaintext, field-projected, or sibling-environment references fail closed. The re-image also authors and then asserts the Cloud provider pair needed by periodic maintenance: exactly one `E2B_API_KEY` field projection from the verified environment-owned server-app secret and exactly one reviewed `E2B_TEMPLATE_NAME`, with no inherited plaintext, duplicate, or sibling-environment key reference. The registered revision is re-read and checked against the same complete contract before the service is rolled.

`server/infra/background.tf` (Amazon MQ RabbitMQ broker, ElastiCache Serverless Valkey scheduler store, the worker/Beat ECS services and task definitions, and the relay-heartbeat deploy-gate metric filter) is a set of **checked-in definitions only**. Both Terraform stages gate on `count` flags that default to disabled, and the deploy workflow's background steps are inert until the service names are set. These definitions are **not a description of current live operating infrastructure**: no hosted background broker, scheduler store, or worker/Beat service is asserted to exist from their presence in the tree. Enabling the Terraform stages (provisioning the plane or rebinding to existing managed endpoints), setting the deploy environment's worker/Beat variables, and running the staging outbox smoke are **separate, individually gated actions** outside the merge of these definitions. `background_services_enabled = true` fails at Terraform plan time (a variable validation proven by `server/infra/tests/background_plane.tftest.hcl` under a mocked provider) unless either the managed broker/store stage is enabled or both external endpoint secret ARNs are supplied, so the services can never be created without a reachable broker/store. The optional Terraform Cloud-provider inputs accept only an absent pair or a base Secrets Manager ARN plus a nonempty template; partial and pre-projected key inputs fail at plan time. When present, the execution role can read only the supplied base secret and ECS performs the exact `E2B_API_KEY` field projection at task start.

The hosted API also uses Redis for cross-process Cloud materialization and GitHub-refresh leases, independently of whether worker and Beat services are enabled. `server/infra/hosted-redis/` is the isolated durable owner for the environment-specific deploy-role and ECS-execution-role child grants. Its one-time non-destructive adoption imported the two pre-existing deploy policies and created the two dedicated execution policies only after an exact saved-plan shape check; it never removes the roles' other pre-existing secret grants. `server/deploy/hosted-redis-contract.json` is the single machine-readable map consumed by both that Terraform root and the workflow; it binds the current hosted account, region, workflow environment aliases, stable server-app secret names, optional background Redis reference identities, and existing role names without claiming ownership of the live ECS services or background secrets. The server deploy resolves the generated secret ARN only after assuming the exact environment role, preflights a valid DNS-resolved non-loopback `REDBEAT_REDIS_URL`, authors that exact field projection on the API task, removes inherited plaintext or stale references, and fails before task registration when any identity or dependency check fails. It also proves the live task definition uses the contract's account/environment execution role before cloning that same definition. The resolved base secret ARN is kept out of the job-wide environment and is produced only after every third-party action's main phase. Because those actions can register post-job hooks, the first-party render and background re-image transactions keep all identifier-bearing task JSON in private temporary directories and remove it on every exit before those hooks run. The loopback default remains a local-development convenience, not hosted configuration.

The plane's telemetry stays in its structured log lines (`background_relay`, `background_queue_age`, and the task-outcome events emitted by `background/task_metrics.py`), which distinguish two age/latency signals: the oldest-due pre-publish wait in Postgres (a truthful current-oldest gauge) versus the per-task broker-residence latency observed only on consume (a **lagging** signal that goes silent exactly when consumption stalls). Exactly one signal is materialized as a CloudWatch custom metric: `RelayHeartbeat`, retained solely as this workflow's deploy-gate sensor. No CloudWatch alarms exist — Grafana is the sole alert-evaluation engine ([observability](../observability/README.md)), and monitors for the background plane (worker/Beat running, broker reachability via `AWS/AmazonMQ`, queue depth) are added as Grafana rules through the alerting spec if and when the plane is enabled.

### Release coordinator

`release.yml` is the only release coordinator. It runs unattended on a 09:00 UTC cron and on manual dispatch. Its prepare job resolves the release checkpoint and the public product and artifact versions, may commit version bumps to `main`, and creates the selected checkpoint, product, and artifact tags. The run then releases the selected Runtime/SDK, Server/self-host, and Desktop artifacts and deploys the selected hosted surfaces to production.

The nightly run covers every surface: Server, Web, and LiteLLM deploys plus a Desktop release that publishes the updater manifest. `surfaces` defaults to `all`, which makes every surface eligible and leaves the choice to change detection against the previous checkpoint, so an unchanged surface is neither re-released nor redeployed and a night with no changes at all does nothing. An explicit `surfaces` list skips detection and is exact.

`dry_run` is the standing way to prove a change to this pipeline before it can ship anything. A dry run walks the whole graph and suppresses every externally visible effect: prepare computes the version plan but commits nothing to `main` and creates no tags, the artifact release builds are skipped, each deploy lane is still called but with `enabled: false` so the inner job that reaches AWS or Vercel never starts, and the product release body is rendered without creating or updating a GitHub Release. Both step summaries say the run was a dry run. It composes with the other inputs: `surfaces` narrows what the plan covers, and `skip_build` walks the deploy-only shape, which still requires an explicit `surfaces` list because that guard is part of what a wiring proof needs to exercise.

The build lanes are skipped rather than called with their own `dry_run`, because their dry-run input still compiles everything; the deploy lanes have a real no-op switch, so calling them costs seconds and proves the call wiring. That asymmetry is deliberate.

A `skip_build` run is deploy-only. It creates no version bump, no tags, no artifact releases, and no product release page, so it deploys the exact ref without minting new artifact identities. It does not reuse the artifacts a previous run produced: each hosted lane still rebuilds its image from that same source SHA, so a promotion is a deterministic rebuild of the promoted commit rather than a retag of existing bytes. Artifact handoff would make it a true retag and is not built.

Production jobs are unattended workflow jobs, and the pipeline has no approval step of its own. The `Production` GitHub Environment's required-reviewer rule is a repository setting rather than anything these files express, and while it is set it does more than delay a run.

A cron run under that rule pushes its version-bump commit to `main` and creates the release tags in prepare, which is not bound to any environment, and then parks `deploy-server-prod` in Waiting. The parked run holds the `nightly-release-train` concurrency group with `cancel-in-progress: false`, and no separate hotfix workflow exists to route around it, so every later dispatch queues behind the parked run instead of preempting it and a third dispatch cancels the queued one rather than the stuck one. Every manual production deploy is blocked for as long as the run sits there. The operator escape hatch is `gh run cancel <run-id>` on the parked run, which releases the group. The rule must be removed for this pipeline to operate as described.

Server and LiteLLM deploy in parallel, and Web waits for the Server deploy because a rolled web surface can call API endpoints that only the new server revision serves. Web still deploys when Server is not a selected surface, and does not deploy when a selected Server deploy failed.

Desktop updater publication is a reusable release call made directly from the prepare result. It has no deploy dependency and is not bound to a GitHub Environment. Raw product-release publication gates on the artifact release jobs alone, so it can publish before the production deploys finish or when they later fail.

Every `_deploy-*.yml` lane builds its own exact-SHA image, so the artifact release jobs hand nothing to the deploy jobs. A run that releases and deploys the same surface therefore builds that source twice.

See the [Release procedure](../../../guides/deploying/releases.md).

### Artifact lanes

Desktop, Runtime/SDK, Server/self-host, and E2B template outputs have distinct coordinates. The two standalone cloud-template workflows operate on the same immutable `sha-<12>` plus rolling `staging`/`production` family; `release-cloud-template.yml` builds an immutable tag and moves `staging`, and `promote-cloud-template.yml` smokes an immutable tag and moves `production`. They are separate entrypoints, not separate artifact identities.

Server releases publish server and LiteLLM GHCR images with version and rolling `stable` tags, never commit-SHA image tags. A `server-v<version>` GitHub Release also holds the two Linux runtime bundles, CloudFormation template, installer, AWS launch helper, deploy bundle, and checksum manifest enumerated in the [Release procedure](../../../guides/deploying/releases.md).

Those published LiteLLM images are Proliferate-owned wrappers. Their rolling or versioned outer tags do not loosen the wrapper's upstream input: every build still starts from the exact release-and-index-digest coordinate above.

## Workflow Inventory

Each checked-in workflow appears exactly once below. Trigger posture describes how the file can run; it does not imply that the workflow is a merge or release gate.

### Reusable build and deploy lanes

| Workflow | Trigger and posture | Role |
| --- | --- | --- |
| `_build-server.yml` | Reusable only | Build and publish the server and LiteLLM GHCR images and the self-hosted release assets for one already-gated commit, and mint its `server-v` tag. Carries no lint or test job: tests gate the PR to `main` transition, and this lane only ever runs on a commit that already reached `main`. |
| `_deploy-desktop.yml` | Reusable only | Validate/build Desktop for staging or call the Desktop publisher for production. |
| `_deploy-litellm.yml` | Reusable only | Build and roll the LiteLLM ECS service when its environment switch is enabled. |
| `_deploy-server.yml` | Reusable only | Build the exact-SHA server image, migrate, conditionally roll the Celery worker and Beat before the API, roll the API, and verify health. API, worker, and Beat are all pinned to the one candidate image by its **immutable `repo@sha256:` digest** (resolved from the build/push output), never a mutable tag, so all three planes run the byte-identical image and a later tag move cannot change what a rolled service runs. The rendered task enables strict release identity, strips inherited stale runtime-identity variables, preserves the support-feed secret, and explicitly authors the API's checked-in environment-bound Redis and E2B-key field references after account, region, secret-identity, DNS-safe Redis, and nonempty-key preflights. The conditional background re-image authors the same exact key projection plus the reviewed template, and asserts the full contract before and after registration. |
| `_deploy-web.yml` | Reusable only | Deploy and verify the selected Vercel web surface. |

### CI, security, compatibility, probes, and qualification

| Workflow | Trigger and posture | Role |
| --- | --- | --- |
| `anyharness-attached.yml` | Manual (credential-dark) | Exercise live local AnyHarness compatibility with configured agent credentials — dark until the agent secrets are provisioned or the lane is ruled out (census row carries the sunset). |
| `catalog-probe.yml` | Scheduled daily or manual | Probe agent/catalog pins through the protected `Catalog Probe` environment, pass sanitized outputs to a separate write-capable PR job, and create or update an owned GitHub issue on scheduled failure. |
| `ci-heavy-lanes.yml` | Manual | Run the four lanes demoted off the per-PR path in the 2026-08 engineering cull (candidate-build-handoff, login-budget, scroll-physics, workflow-definition-lifecycle), verbatim moves out of `ci.yml`. Re-gating is a step-3 CI/CD-spec decision. |
| `ci.yml` | Push to `main`, pull request, or manual | Run repository shape, configuration, Rust, SDK, client, and workflow checks. Required-check policy is external to this file. |
| `codeql.yml` | Push or pull request on `main`, plus weekly schedule | Run CodeQL security analysis. |
| `intent-tests.yml` | Manual | Run the broad intent and billing suites; provisional/non-blocking, and off the PR path since the 2026-08 cull. |
| `pr-metadata.yml` | Pull-request metadata events | Enforce ready-PR title and label metadata mechanically. Human policy belongs to the PR procedure. |
| `release-e2e-selfhost.yml` | Manual | Run self-host artifact-chain and optional provisioning qualification. The nightly cron and never-called `workflow_call` interface were removed in the 2026-08 cull. Tier 4 and self-host provisioning use separate non-cancelling job groups. |
| `release-e2e.yml` | Manual | Run live Tier 3 release qualification; it is not a per-PR merge gate. The daily cron was removed in the 2026-08 cull (the schedule-only local lane is currently unreachable, pending the step-3 cadence ruling). Local, staging, Tier 2, managed-cloud, and self-host use independent non-cancelling job groups, so unrelated worlds may overlap while same-world runs do not. These groups do not promise FIFO ordering. |
| `self-host-smoke.yml` | Push to `main` or manual | Smoke the production Compose path when relevant paths change. Off the PR path since the 2026-08 cull; the push run also seeds the buildx layer cache. |
| `server-ci.yml` | Relevant push/PR, manual, or reusable | Validate the server. It is a gate, not a publisher: the release image and asset build lives in `_build-server.yml`. |

Server CI's shrink-only mypy census compares a pull request with its base SHA and a push with the event's pre-push SHA. Manual and reusable invocations must supply an explicit comparison SHA.

### Hosted deployment and release coordinators

| Workflow | Trigger and posture | Role |
| --- | --- | --- |
| `deploy-staging.yml` | Manual | Plan, deploy selected staging surfaces, and retain the exact-SHA summary. Nothing triggers it automatically. |
| `release.yml` | Scheduled daily at 09:00 UTC, or manual | Release selected artifacts and deploy selected hosted surfaces straight to production. `skip_build` makes the run a deploy-only promotion; `ref` plus `surfaces` expresses a hotfix; `dry_run` walks the graph with every externally visible effect suppressed. |

### Artifact and template releases

| Workflow | Trigger and posture | Role |
| --- | --- | --- |
| `promote-cloud-template.yml` | Manual | Smoke an immutable E2B tag and move the rolling production tag. |
| `release-cloud-template.yml` | Manual | Build/smoke an immutable E2B template and move the rolling staging tag. |
| `release-desktop.yml` | `desktop-v*` tag, manual, or reusable | Build Desktop, create its draft GitHub Release, and optionally publish updater/download assets. |
| `release-runtime.yml` | `runtime-v*` tag, manual, or reusable | Build runtime archives, publish `@anyharness/sdk`, and create the runtime release. |

## Ownership Boundaries

- [Developing: Deploying](../../../guides/deploying/README.md) owns
  operator procedures; this system document owns durable topology.
- [Pull Requests](../../../guides/process/pull-requests.md) owns human PR
  preparation and readiness policy.
- [Environment Sources](../../../guides/local/dev-profiles.md#environment-sources)
  and its variable catalog own configuration locations and precedence.
- [Testing](../testing/README.md) owns release qualification,
  test tiers, scenarios, and evidence requirements.
- [Desktop Updates](desktop-updates.md) owns installed-product updater and
  release-notice behavior.
- [Observability](../observability/README.md) consumes component artifact
  identity as Sentry `release` and structured-log `release_id`; event
  production does not redefine Delivery identity.

The current release scripts publish a raw GitHub Release ledger from merged PR metadata. No checked-in landing-changelog or release-manifest publisher exists (the issue-lifecycle system that owned that target was retired in the 2026-08 engineering cull).

## Current Gaps

- No automated end-to-end proof gates the Staging state, and no transition consumes one. Staging is deployed, not proven.
- The release builds and the production deploys share no artifact. Each deploy lane rebuilds its own exact-SHA image from source.
- `_deploy-*.yml` lanes still take an `environment` string plus an `enabled` boolean rather than a single environment parameter, so each caller repeats the surface-selection wiring.
- The operator procedures in [Deploying](../../../guides/deploying/README.md) still describe the retired nightly, hotfix, and promotion workflows.
- Self-host release E2E exposes a reusable trigger but is not called by the
  release coordinator, even though Testing's target requires an every-release
  gate.
- E2B has no automated production path. `release.yml` has no E2B job, and the rolling `production` template tag moves only through the manual `Promote Cloud Template` workflow, even though change detection still classifies an `e2b` surface.
- Mobile has no deploy path in any workflow. Its EAS lane was deleted with the coordinators that called it.
- Hosted Worker deployment has no enabled canonical service or command, and no standalone Worker workflow exists any more. The Celery worker and Beat rollout inside `_deploy-server.yml` is unaffected.
- The AWS Graviton self-host template downloads the aarch64 runtime bundle,
  while provider-sandbox runtime discovery currently expects x86 Linux
  binaries. The default AWS cloud-workspace path is therefore not proven.
- Runtime archives contain AnyHarness, Worker, and Supervisor. The target
  Supervisor design owns process lifecycle, but current cloud bootstrap starts
  AnyHarness and a separate Worker sidecar directly; staged Supervisor launch
  helpers have no active call site.
- Landing publication is not automated.

## Merge Gate

Branch protection on `main` cannot distinguish "no red X" from "actually verified". A required status check is satisfied when it reports `success`, and also when it reports `skipped`, and also when the name stops resolving because the job behind it was renamed, deleted, or gated off. A required-checks list made of per-lane names therefore degrades silently to green at exactly the moment the lanes stop running.

Two rollup jobs invert that. `ci-ok` in `.github/workflows/ci.yml` and `server-ci-ok` in `.github/workflows/server-ci.yml` each depend on every lane in their own workflow, run under `if: always()`, and fail unless every dependency concluded `success` -- `failure`, `skipped`, and `cancelled` are all fatal, and the failing lanes are named in the output. Each carries a drift guard that parses its own workflow file and fails if a job exists there but not in the rollup's `needs:` list, so a lane cannot leave the gate unnoticed. `needs:` cannot cross workflows, which is why there is one rollup per workflow rather than one overall.

The required status checks for `main` are:

| Check | Workflow |
| --- | --- |
| `ci-ok` | CI |
| `server-ci-ok` | Server CI |
| `Analyze (javascript-typescript)` | CodeQL |
| `Analyze (python)` | CodeQL |
| `Analyze (rust)` | CodeQL |
| `Validate PR title and labels` | PR Metadata |

2026-08 engineering cull: the two Self-Host Smoke checks (`Detect smoke-relevant changes`, `Production compose smoke`) left this list when `self-host-smoke.yml` came off the PR path; removing them from branch protection is a founder settings action recorded in the cull PR description.

Names are check-run display names, as `gh pr checks` prints them. No individual lane name from `ci.yml` or `server-ci.yml` belongs on the list: the rollups are strictly stronger, and a per-lane name is a name that can rot. Because a `needs:` entry on a matrix job covers all of its shards, sharding or renaming a lane never requires a branch-protection edit.

Excluded on purpose: `intent-tests (provisional)` and `intent-billing (provisional)` are `continue-on-error` while the harness earns trust and no longer run on PRs at all (dispatch-only since the 2026-08 cull); the CI Heavy Lanes jobs are dispatch-only demotions from `ci.yml` (same cull); the Vercel checks are third-party. `docker` and `self-hosted-release-assets` used to be excluded as release-only jobs inside Server CI; they now live in `_build-server.yml` and are outside the rollup's file entirely. Server CI's drift guard still derives a release-only exemption from a job's `server-v` tag gate rather than by name, so a future release-gated job cannot silently join or leave the rollup, but the exempt set is empty today and every job in the file is covered.

Server CI carries no `on.pull_request.paths` filter, because a path-skipped workflow never reports a conclusion at all and a required check pointing into it would strand every unrelated pull request on a pending check. It runs on every pull request instead, and a `changes` job publishes one relevance flag that each lane's steps consume. A lane with nothing to verify reports a real `success` rather than `skipped`, and an unset flag -- what a failed `changes` job produces -- runs the real suite.

Any change to the set of required checks belongs here and in the comment block above `ci-ok` in `.github/workflows/ci.yml`, in the same commit.
