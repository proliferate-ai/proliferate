# Delivery System

Delivery owns the repository's artifact identities and the topology that
builds, deploys, promotes, and publishes them. It describes what the checked-in
automation does. Operator steps live in
[Developing: Deploying](../../../../developing/deploying/README.md).

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
| `release-YYYY-MM-DD` / `hotfix-*` | Release-train checkpoint or no-version hotfix ledger identity, not an artifact version. |

The self-host CloudFormation template is one of the assets attached to a
`server-v*` release; it is not a separate release coordinate. A public product
version does not identify an exact artifact build unless the corresponding
artifact tag and source SHA are also known.

## Topology

### Hosted spine

A successful CI run on `main` starts staging. The staging coordinator resolves
the exact CI SHA, detects or explicitly selects surfaces, waits for matching
Server CI when such a run exists, invokes reusable staging lanes, and writes a
summary artifact. The Desktop staging lane validates and builds only; it does
not publish the updater.

Production promotion is manual. Its normal path requires a successful,
non-dry-run staging summary for the exact SHA, verifies that the ref belongs to
`main`, invokes selected production lanes, and writes its own summary artifact.
The workflow has an explicit staging-bypass input; using it changes the gate,
not the identity being deployed. Surface selection and dry-run behavior are
workflow inputs, so operators inspect the generated plan and exact SHA instead
of relying on a remembered surface list.

The live E2B webhook workflow is manual-only and is not part of ordinary CI,
staging, the nightly train, or production promotion. The Worker reusable lane
is a configured no-op while `WORKERS_DEPLOY_ENABLED` is false and deliberately
fails if enabled before a canonical worker service and command exist.

See the [Hosted procedure](../../../../developing/deploying/hosted.md).

### Background plane topology

`_deploy-server.yml` builds one exact-SHA server image that the API, the Celery
worker, and the Celery Beat scheduler all run. Its rollout order is migrations →
broker/scheduler-store verify → worker + Beat → worker/Beat health (which also
asserts the running task definitions carry the candidate image) → candidate-plane
execution proof → API roll. This ordering guarantees a newly rolled API never
enqueues a task name that no running worker can import.

Resource health is not sufficient on its own — a `runningCount` of 1 does not
prove the plane can execute work (broker credentials, task routing, worker
task-registry import, RedBeat state, or relay publish/consume could all be
broken while the container is up). Before the API rolls, the workflow enqueues
one committed health no-op — keyed to this exact run and run-attempt, so a rerun
enqueues a fresh row rather than replaying a prior attempt's already-published
one — via a one-off task on the candidate worker task definition, then observes
BOTH a fresh relay-heartbeat advance (Beat dispatched `background.relay` and a
worker ran it, so the scheduler store and broker are reachable) AND an
**exact-id** execution receipt for that specific enqueued row. The receipt is a
structured log line the health task emits on success carrying its own task id
(which the relay sets equal to the enqueued outbox id); the gate matches on that
id, so an aggregate success count advanced by a concurrent deploy, an operator
smoke, or a retry does **not** satisfy it — only execution of the row this
attempt enqueued does. It **fails closed** on timeout. The heartbeat rides the
plane's own CloudWatch metric namespace (`Proliferate/Background/<env>`) and the
receipt is read from the server log group (derived from the environment name), so
the proof references no broker/store resource ID and the identical gate covers
both the managed-AWS-IDs path and the external-endpoint rebind path.

The worker/Beat rollout is **conditional and fails closed as a set**. It runs
only when both the worker and Beat service names are configured on the
environment; a partial configuration (one set, the other empty) aborts the whole
deploy rather than silently skipping the background plane and rolling the API
alone. When neither is configured, the workflow deploys the API exactly as
before. The re-image step also asserts that exactly one container matches each
configured name and that the registered task definition carries the candidate
image, so a mistyped container name fails closed instead of rolling the old
image.

`server/infra/background.tf` (Amazon MQ RabbitMQ broker, ElastiCache Serverless
Valkey scheduler store, and the worker/Beat ECS services, task definitions,
metric filters, and alarms) is a set of **checked-in definitions only**. Both
Terraform stages gate on `count` flags that default to disabled, and the deploy
workflow's background steps are inert until the service names are set. These
definitions are **not a description of current live operating infrastructure**:
no hosted background broker, scheduler store, or worker/Beat service is asserted
to exist from their presence in the tree. Enabling the Terraform stages
(provisioning the plane or rebinding to existing managed endpoints), setting the
deploy environment's worker/Beat variables, and running the staging outbox smoke
are **separate, individually gated actions** outside the merge of these
definitions. `background_services_enabled = true` fails at Terraform plan time
(a variable validation proven by `server/infra/tests/background_plane.tftest.hcl`
under a mocked provider) unless either the managed broker/store stage is enabled
or both external endpoint secret ARNs are supplied, so the services can never be
created without a reachable broker/store.

The plane's telemetry distinguishes two age/latency signals:
`OutboxOldestDuePendingAgeSeconds` measures a row's pre-publish wait in Postgres
(the SLO signal, a truthful current-oldest gauge), while
`TaskBrokerResidenceLatencySeconds` measures how long a task waited in RabbitMQ
between relay publish and worker consume. The latter is a **lagging** per-task
latency observed only on consume: it goes silent exactly when consumption stalls,
so it is **not** a truthful "current oldest queued-task age". Amazon MQ exposes no
native oldest-message-age metric, so current-oldest-queued-age is not available
from this substrate; broker backlog is instead covered by the `AWS/AmazonMQ`
`MessageCount` depth alarm, which does not go silent when workers stop consuming.
Desired-vs-running worker/Beat
alarms query `RunningTaskCount` in `ECS/ContainerInsights` (Container Insights is
enabled on the cluster), and the task-outcome metric filters carry `task_name`
(and, for retries/failures, safe `error_code`) dimensions.

### Release coordinators

The scheduled or manually dispatched nightly train detects changes since the
previous train, prepares product and artifact versions, may commit version
bumps to `main`, creates the applicable tags, releases selected artifacts,
deploys selected hosted surfaces to staging, and then runs corresponding
production jobs after staging succeeds. Those production jobs are unattended
workflow jobs; they can remain zero-touch only while the `Production` GitHub
Environment has no required-reviewer gate.

Desktop updater publication is a separate reusable release call made directly
from the train's prepare result. It has no staging dependency and is not bound
to a GitHub Environment. Nightly raw product-release publication depends on
selected artifact-release and staging jobs, not on nightly production jobs, so
it can publish before production finishes or when production later fails.

The manual hotfix coordinator starts from an exact ref on `main`, prepares the
selected versions and tags, runs selected artifact and production jobs, and
publishes its raw product release only after every selected artifact-release
and production job succeeds. A Runtime-only hotfix therefore waits for the
Runtime release even though it has no production deploy job. Neither
coordinator includes a LiteLLM job. Exact LiteLLM deployment uses the manual
production-promotion path.

See the [Release procedure](../../../../developing/deploying/releases.md).

### Artifact lanes

Desktop, Runtime/SDK, Server/self-host, and E2B template outputs have distinct
coordinates. The reusable E2B deploy lane and the two standalone cloud-template
workflows all operate on the same immutable `sha-<12>` plus rolling
`staging`/`production` family; they are separate entrypoints, not separate
artifact identities.

Server releases publish server and LiteLLM GHCR images with version and rolling
`stable` tags, never commit-SHA image tags. A `server-v<version>` GitHub Release
also holds the two Linux runtime bundles, CloudFormation template, installer,
AWS launch helper, deploy bundle, and checksum manifest enumerated in the
[Release procedure](../../../../developing/deploying/releases.md).

## Workflow Inventory

Each checked-in workflow appears exactly once below. Trigger posture describes
how the file can run; it does not imply that the workflow is a merge or release
gate.

### Reusable deploy lanes

| Workflow | Trigger and posture | Role |
| --- | --- | --- |
| `_deploy-desktop.yml` | Reusable only | Validate/build Desktop for staging or call the Desktop publisher for production. |
| `_deploy-e2b.yml` | Reusable only | Build and/or promote one immutable E2B template into a rolling environment tag; the smoke proves the three runtime binaries report the canonical version and carry the stamped source SHA before the rolling tag moves. |
| `_deploy-litellm.yml` | Reusable only | Build and roll the LiteLLM ECS service when its environment switch is enabled. |
| `_deploy-mobile.yml` | Reusable only | Run the selected EAS build and optional submit lane when enabled. |
| `_deploy-server.yml` | Reusable only | Build the exact-SHA server image, migrate, conditionally roll the Celery worker and Beat before the API, roll the API, and verify health. API, worker, and Beat are all pinned to the one candidate image by its **immutable `repo@sha256:` digest** (resolved from the build/push output), never a mutable tag, so all three planes run the byte-identical image and a later tag move cannot change what a rolled service runs. The rendered task enables strict release identity, strips inherited stale runtime-identity variables, and preserves the support-feed secret, all asserted before registration. |
| `_deploy-web.yml` | Reusable only | Deploy and verify the selected Vercel web surface. |
| `_deploy-workers.yml` | Reusable only | Report the disabled Worker lane, or fail if enabled before a canonical deploy exists. |

### CI, security, compatibility, probes, and qualification

| Workflow | Trigger and posture | Role |
| --- | --- | --- |
| `agent-runtime-compat.yml` | Manual | Exercise live local AnyHarness compatibility with configured agent credentials. |
| `catalog-probe.yml` | Scheduled daily or manual | Probe agent/catalog pins and open an update PR when the generated catalog changes. |
| `ci.yml` | Push to `main`, pull request, or manual | Run repository shape, configuration, candidate-handoff, Rust, SDK, client, and workflow checks. Required-check policy is external to this file. |
| `cloud-live-webhook.yml` | Manual | Exercise a live E2B webhook through an externally reachable target. |
| `cloud-tests.yml` | Manual | Run credentialed cloud lifecycle and runtime suites. |
| `codeql.yml` | Push or pull request on `main`, plus weekly schedule | Run CodeQL security analysis. |
| `intent-tests.yml` | Pull request or manual | Run the broad intent and billing suites; these lanes are currently provisional/non-blocking. |
| `pr-metadata.yml` | Pull-request metadata events | Enforce ready-PR title and label metadata mechanically. Human policy belongs to the PR procedure. |
| `release-e2e-selfhost.yml` | Scheduled, manual, or reusable | Run self-host artifact-chain and optional provisioning qualification. No current release coordinator calls it. |
| `release-e2e.yml` | Scheduled or manual | Run live Tier 3 release qualification; it is not a per-PR merge gate. |
| `self-host-smoke.yml` | Pull request, push to `main`, or manual | Smoke the production Compose path when relevant paths change. Branch-protection status is not encoded here. |
| `server-ci.yml` | Relevant push/PR, `server-v*` tag, manual, or reusable | Validate/package the server and publish self-host images/assets when invoked as a release. |

### Hosted deployment and promotion coordinators

| Workflow | Trigger and posture | Role |
| --- | --- | --- |
| `deploy-staging.yml` | Successful CI workflow run on `main`, or manual | Plan, deploy selected staging surfaces, and retain the exact-SHA summary. |
| `hotfix-production.yml` | Manual | Prepare and run an exact-surface production hotfix from `main`. |
| `nightly-release-train.yml` | Scheduled daily or manual | Coordinate product/artifact releases and staged-then-automatic hosted deployment. |
| `promote-production.yml` | Manual | Promote an exact staged SHA, or use its explicit staging bypass, into selected production lanes. |

### Artifact and template releases

| Workflow | Trigger and posture | Role |
| --- | --- | --- |
| `promote-cloud-template.yml` | Manual | Smoke an immutable E2B tag and move the rolling production tag. |
| `release-cloud-template.yml` | Manual | Build/smoke an immutable E2B template and move the rolling staging tag. |
| `release-desktop.yml` | `desktop-v*` tag, manual, or reusable | Build Desktop, create its draft GitHub Release, and optionally publish updater/download assets. |
| `release-runtime.yml` | `runtime-v*` tag, manual, or reusable | Build runtime archives, publish `@anyharness/sdk`, and create the runtime release. |

## Ownership Boundaries

- [Developing: Deploying](../../../../developing/deploying/README.md) owns
  operator procedures; this system document owns durable topology.
- [Pull Requests](../../../../developing/process/pull-requests.md) owns human PR
  preparation and readiness policy.
- [Environment Sources](../../../../developing/reference/environment-sources.md)
  and its variable catalog own configuration locations and precedence.
- [Testing](../../../../developing/testing/README.md) owns release qualification,
  test tiers, scenarios, and evidence requirements.
- [Desktop Updates](desktop-updates.md) owns installed-product updater and
  release-notice behavior.
- [Issue Lifecycle](../issue-lifecycle/support-loop.md) owns the consent-safe
  release manifest, Support projection, finalizer validation, and future
  landing publication.
- [Observability](../observability/README.md) consumes component artifact
  identity as Sentry `release` and structured-log `release_id`; event
  production does not redefine Delivery identity.

The current release scripts publish a raw GitHub Release ledger from merged PR
metadata. They do not publish the Issue Lifecycle manifest, run its finalizer,
or update the landing changelog. No checked-in landing-changelog or release-
manifest publisher exists.

## Current Gaps

- Nightly and hotfix coordinators do not include LiteLLM; use manual production
  promotion for that surface.
- Self-host release E2E exposes a reusable trigger but is not called by a
  release coordinator, even though Testing's target requires an every-release
  gate.
- Hosted Worker deployment has no enabled canonical service or command.
- The AWS Graviton self-host template downloads the aarch64 runtime bundle,
  while provider-sandbox runtime discovery currently expects x86 Linux
  binaries. The default AWS cloud-workspace path is therefore not proven.
- Runtime archives contain AnyHarness, Worker, and Supervisor. The target
  Supervisor design owns process lifecycle, but current cloud bootstrap starts
  AnyHarness and a separate Worker sidecar directly; staged Supervisor launch
  helpers have no active call site.
- Raw product release publication and the Issue Lifecycle manifest/finalizer
  remain separate, and landing publication is not automated.
