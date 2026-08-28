# Hosted Deployments

This procedure covers hosted staging and production. For `release.yml` and
artifact publication, use [Releases](releases.md). Production authority and
qualification come from [the CD line](../../specs/engineering/ci-cd/README.md#5--the-cd-line)
and [the prod pipeline](../../specs/engineering/ci-cd/pipelines.md#pipeline--prod);
current workflow topology is in the
[Delivery system](../../specs/engineering/ci-cd/release-delivery.md).

## Before Dispatch

You need access to the repository's GitHub Actions runs and any selected
surface provider needed for verification or failure recovery. Production may
also require permission to pass the production GitHub Environment gate.
Configuration locations and precedence are owned by
[Environment Sources](../local/dev-profiles.md#environment-sources); do not copy secret
values into a prompt, log, issue, or document.

Before any real deploy:

1. Resolve the exact commit and confirm it is on `main`.
2. Confirm CI succeeded for that commit.
3. Choose surfaces using the selected workflow's inputs: staging accepts
   `force_surfaces` / `only_surfaces`; Release accepts `surfaces`. Inspect the
   generated plan and the jobs actually present, not a stale surface list.
4. Decide whether the run is a plan (`dry_run=true`) or a deploy.
5. Record the selected SHA and surfaces before approving a protected job.

For staging, `force_surfaces` adds lanes to those detected from the diff and
`only_surfaces` replaces detection with an exact set. For Release, an explicit
`surfaces` list replaces detection; `all` leaves selection to change detection.
A dry run produces a plan, not staging or production evidence.

## Automatic Staging

Green push-to-`main` CI starts `Deploy Staging` automatically. Verify that the
source run belongs to this repository's `main` push, not a pull request or a
fork. Inspect the coordinator's CI-readiness result for the exact source SHA,
selected surfaces, reusable deploy jobs, and `deploy-summary-staging`. Manual
dispatch remains available for redeploys and dry runs; staging is not
manual-only.

Watch the run through completion. The GitHub run-level SHA for a
`workflow_run` event can differ from the commit checked out by the deploy jobs;
the summary artifact's `headSha` is the deployed commit of record. Staging's
Desktop lane is build-only and never publishes the updater.

## Manual Staging

Use the `Deploy Staging` workflow when an automatic run did not start, when a
plan is needed, or when an exact surface selection was requested.

Set:

- `ref` to the exact `main` SHA or ref;
- either `force_surfaces` or `only_surfaces` when detection is insufficient;
- `dry_run=true` for a plan, otherwise `false`.

Inspect the plan's resolved head SHA, selection mode, selected surfaces, and
environment before allowing deployment jobs to proceed. A dry run creates
`deploy-plan-staging`; only a real successful run creates
`deploy-summary-staging` as deployment evidence.

## Manual Production Promotion

Use **Release** (`release.yml`), not the removed `promote-production.yml`.
Confirm the production instruction and qualification required by
[the CD line](../../specs/engineering/ci-cd/README.md#5--the-cd-line), then plan
an exact hosted redeploy, replacing the placeholder with the approved SHA:

```bash
gh workflow run release.yml --ref main \
  -f ref="<approved-main-sha>" -f surfaces=server,litellm,web \
  -f skip_build=true -f dry_run=true
```

Verify the exact commit reached `main`, the intended staging evidence, and the
selected surfaces. Repeat with `dry_run=false` only for that authorized
production action. Use `skip_build=false` when new artifact versions and
publication are required; see [Releases](releases.md#release-coordinator).

`skip_build=true` omits artifact releases, version bumps, tags, and a product
release page. Hosted lanes still rebuild from the exact source SHA: this is a
redeploy, not a byte-for-byte promotion of staging artifacts. The current
coordinator does not require a successful staging summary or accept
`require_staging_success`; do not infer that qualification happened from a
green Release run.

The daily 09:00 UTC production cron still uses this same coordinator during
the transition described by the CD line. Inspect the workflow's prepare and
final result summaries, then verify each selected production surface. A
production Environment approval can hold deploy jobs after prepare has already
pushed version changes and tags; it is not a dry run and does not hold Desktop
updater publication. Do not change approval settings to clear a waiting run.

## Surface Notes

- The server lane derives the stable staging/production server-app secret name
  from `server/deploy/hosted-redis-contract.json`; it does not accept a Redis
  secret ARN from a GitHub Environment variable. The workflow and the isolated
  `server/infra/hosted-redis/` Terraform root consume that same file. Terraform
  owns the four dedicated exact-secret child policies. Its one-time
  configuration-driven adoption imported the two pre-existing deploy policies
  and created the two missing ECS execution policies only after the saved plan
  proved two imports, two creates, and no other managed change. It does not
  remove pre-existing bundled secret grants. The workflow
  binds the expected account, region, deploy role, live task execution role, and
  secret identity; suppresses provider errors; rejects literal or DNS-resolved
  loopback/unspecified Redis endpoints; and authors the exact field projection
  on every API task revision. If the optional background plane is configured,
  worker and Beat registration also fails closed unless each task carries the
  contract execution role and exactly one environment-owned direct Secrets
  Manager or Parameter Store Redis reference, with no plaintext or
  field-projected duplicate. Each also carries exactly one `E2B_API_KEY` field
  projection from the verified server-app secret and the reviewed
  `E2B_TEMPLATE_NAME`; plaintext, duplicate, partial, stale, or
  sibling-environment provider configuration fails before registration and is
  checked again on the registered revision. The resolved base ARN remains
  step-scoped and is
  obtained after every third-party action's main phase. The first-party render
  and background re-image steps remove their private identifier-bearing scratch
  files on every exit before those actions' post-job hooks execute.
- Standalone Worker, Mobile, and E2B deploy lanes are not called by these
  coordinators. Celery worker and Beat rollout is part of the server lane when
  both services are configured; it is not the retired standalone Worker lane.
- LiteLLM is a selected surface in both staging and `release.yml`, through
  `_deploy-litellm.yml`. Verify `LITELLM_DEPLOY_ENABLED=true` in the intended
  environment; otherwise the lane reports a skip and does not deploy. When
  enabled, it builds the selected ref, registers a new task-definition revision
  for the existing LiteLLM service, and rolls that service. Check the registered
  image identity, task-definition revision, and ECS rollout result; a green
  switch-only job is not a deployed gateway.
- Desktop staging builds only. A selected production Desktop lane can publish
  updater/download assets after validating the version and live feed.

## Verification

For every selected lane:

1. Confirm the job conclusion and inspect its summary.
2. Confirm the summary records the intended exact SHA and environment.
3. Verify the surface through its owning health URL, provider output, updater
   manifest, or release artifact as applicable.
4. Treat a skipped lane as intentional only when the plan or environment switch
   explains it.
5. Do not call the deploy complete while a selected lane, approval, or
   verification remains pending.

Release qualification and evidence requirements belong to
[Testing](../../specs/engineering/testing/README.md).

## Failure Recovery

- Preserve the failed run, exact SHA, selected surfaces, failing job, and
  relevant non-secret logs.
- Repair the owning workflow, provider resource, or configuration source; do
  not mask a missing hosted value with a local override.
- Rerun from the same exact SHA when the artifact or configuration is still the
  intended candidate. If source changes, stage and promote the new SHA as a new
  candidate.
- If `main` advances during a deploy, the completed deployment still represents
  its recorded head SHA. Obtain the required production instruction for a
  separate release or redeploy before claiming production matches newer `main`.
- A partial Desktop updater publish requires inspection of the immutable
  versioned manifest before retrying; do not overwrite or delete it blindly.
