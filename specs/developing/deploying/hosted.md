# Hosted Deployments

This procedure covers hosted staging and production. For release trains and
hotfix coordinators, use [Releases](releases.md). The durable topology is in the
[Delivery system](../../codebase/systems/engineering/delivery/README.md).

## Before Dispatch

You need access to the repository's GitHub Actions runs and any selected
surface provider needed for verification or failure recovery. Production may
also require permission to pass the production GitHub Environment gate.
Configuration locations and precedence are owned by
[Environment Sources](../reference/environment-sources.md); do not copy secret
values into a prompt, log, issue, or document.

Before any real deploy:

1. Resolve the exact commit and confirm it is on `main`.
2. Confirm CI succeeded for that commit.
3. Choose detected surfaces, additive `force_surfaces`, or exact
   `only_surfaces`. Use the workflow input descriptions and generated plan;
   do not reuse a stale surface list.
4. Decide whether the run is a plan (`dry_run=true`) or a deploy.
5. Record the selected SHA and surfaces before approving a protected job.

`force_surfaces` adds lanes to those detected from the diff.
`only_surfaces` replaces detection with the exact requested set. A dry run
writes a plan artifact but is not staging or production evidence.

## Automatic Staging

A successful `CI` run on `main` starts `Deploy Staging` automatically. The
coordinator uses the CI commit, waits for matching Server CI when one exists,
detects affected surfaces, invokes the reusable lanes, and writes
`deploy-summary-staging`.

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
`deploy-plan-staging`; only a real successful run creates the staging summary
that production accepts.

## Manual Production Promotion

Use `Promote Production` with:

- `ref` set to the exact staging-tested SHA on `main`;
- the intended surface inputs;
- `require_staging_success=true` for the normal path;
- `dry_run=false` after reviewing a dry-run plan when one was requested.

The normal gate requires a successful, non-dry-run staging summary whose
`headSha` matches the promoted SHA. The coordinator verifies reachability from
`main`, then the selected jobs use the production GitHub Environment and
write `deploy-summary-production`.

Set `require_staging_success=false` only under explicit direction and record
that staging was bypassed. For E2B, normal production promotes the immutable
template already built in staging; the bypass path instead builds and smokes
the immutable template before moving the production tag.

The scheduled nightly train has separate zero-touch production jobs after its
staging jobs. Those jobs stay unattended only if the `Production` environment
has no required-reviewer gate. They are not the manual promotion procedure;
see [Releases](releases.md).

## Surface Notes

- Worker deployment is a no-op while `WORKERS_DEPLOY_ENABLED=false`. Enabling
  it before a canonical service and command exist deliberately fails.
- The nightly and hotfix coordinators have no LiteLLM job. Deploy an exact
  LiteLLM ref through `Promote Production` with that exact surface selected.
- `Cloud Live Webhook` is manual-only and is not part of CI, staging, the
  nightly train, or production promotion.
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
[Testing](../testing/README.md).

## Failure Recovery

- Preserve the failed run, exact SHA, selected surfaces, failing job, and
  relevant non-secret logs.
- Repair the owning workflow, provider resource, or configuration source; do
  not mask a missing hosted value with a local override.
- Rerun from the same exact SHA when the artifact or configuration is still the
  intended candidate. If source changes, stage and promote the new SHA as a new
  candidate.
- If `main` advances during a deploy, the completed deployment still represents
  its original SHA. Promote the newer commit separately before claiming that
  production matches current `main`.
- A partial Desktop updater publish requires inspection of the immutable
  versioned manifest before retrying; do not overwrite or delete it blindly.
