# Workflow Identity Cutover

Status: required maintenance procedure for revision `e5f1a2b3c4d7`.

This cutover is not a rolling migration. The acknowledgement environment variable
is evidence only; it is not a writer fence. The migration takes exclusive locks on
`workflow_run`, `cloud_workflow_run_gateway_token`, and `workflow_step_action`, then
installs no-default writer-version columns plus parked-row constraints on all three.
Operators must still close admission and scale every old writer to zero before
running it.

## Required access

- deployment control for every API, scheduler/poller, Worker, desktop relay, and
  AnyHarness runtime in the target environment
- database migration and read access
- process/sandbox termination access
- the release artifact containing the WF-ID schema foundation

Never place credentials, token values, process environment dumps, or database row
payloads in chat, tickets, logs, or the release record.

## Hosted sequence

1. Apply a config-only release to the currently deployed, old-schema-compatible
   version with `WORKFLOWS_ENABLED=false`. Restart API and scheduler processes and
   verify workflow HTTP admission is 404 and schedule/poll ticks create no rows.
2. Stop all scheduler/poller and API replicas. Stop cloud Workers. Disable desktop
   relay admission. Drain or explicitly terminate every workflow actor and its
   shell/SCM process group. Revoke legacy server-side run tokens.
3. From the maintenance connection, verify zero nonterminal workflow rows being
   advanced, zero workflow actors, zero workflow process groups, zero workflow
   Workers, and zero application writer replicas. Record counts only.
4. Set `PROLIFERATE_WF_ID_LEGACY_DRAIN_ACK` to
   `actors-and-process-groups-verified-zero` on the one migration job. Run the
   migration with all application replicas still at zero. Any blocked lock or new
   writer is a failed cutover: abort and repeat the inventory.
5. Verify legacy tokens are expired, actions exhausted, all legacy runs parked,
   private envelopes are purged, every open legacy logical-plan blob is replaced
   by the credential-free `{}` tombstone, and all three writer-fence constraints
   and no-default identity columns exist. Probe that an old-shape run, token, and
   action insert each fails inside a rolled-back maintenance transaction.
6. Deploy the WF-ID application and runtime artifacts while replicas remain at
   zero, clear the acknowledgement from normal services, then restore API/Worker
   replicas. Keep `WORKFLOWS_ENABLED=false` until the later activation packets are
   accepted.

## Self-hosted sequence

1. Back up the database and runtime homes. Stop the desktop app, server, automation
   worker, cloud Worker, and AnyHarness services.
2. Restart only the old server long enough to apply `WORKFLOWS_ENABLED=false`,
   verify the workflow surface is 404, then stop it again. Terminate remaining
   workflow actors and their descendant process groups.
3. Verify the same zero-writer/zero-actor/zero-process inventory as hosted. Run one
   migration process with the exact acknowledgement value above; no other service
   may hold or open a writer connection.
4. Perform the post-migration token/action/run/envelope/constraint checks, install
   the matching WF-ID binaries, clear the acknowledgement, and start services with
   workflows still disabled.

The AnyHarness `0060_workflow_secret_scrub` migration removes credential-bearing
fields from the live SQLite database and parks resumable legacy rows. It cannot
erase bytes already copied into SQLite WAL files, filesystem snapshots, or backups.
With runtimes stopped, checkpoint and replace the WAL according to the deployment's
SQLite procedure, then expire or re-encrypt old backups under the retention policy.
Server-side run-token revocation is separate and remains mandatory.

## Activation boundaries

- A materialization credential has one exact wire form:
  `wfm1.<canonical-uuid-v4>.<43 URL-safe base64url characters>`. It is accepted
  only before its offer expiry and authorizes only the immutable binding CAS.
- A Worker that loses the acceptance response recovers through the authenticated
  `GET .../runs/{run_id}/execution-binding` route. Recovery is scoped to the exact
  enrolled executor id and generation recorded by the consumed offer. It returns
  only the redacted committed binding and acceptance state; it does not return,
  refresh, or mint a credential and does not depend on the old credential TTL.
- Local `workspace_checkpoint` materialization remains deliberately unavailable
  in WF-ID: offer issuance fails with
  `workflow_checkpoint_attestation_unavailable` before any credential is minted
  or persisted and before Desktop is asked to materialize. A caller's
  `checkpointId` and `checkpointContentHash` are claims, not proof of checkout
  content. WS9c (desktop binding integration), jointly with the AnyHarness
  checkpoint-manifest owner, must define a canonical manifest attestation bound
  to run id, plan hash, workspace generation, executor generation, base object
  id, and offer fence; the server binding boundary must verify that attestation
  before this source kind can become executable. Do not replace this fence with
  grammar checks or trust in an arbitrary request body.

## Failure handling

- Missing acknowledgement or a populated-data guard failure: do not bypass it;
  return to the drain inventory.
- Exclusive lock waits: an old writer is still alive. Cancel the migration, find
  and stop it, then restart the procedure.
- Migration failure after destructive statements: keep all services stopped and
  restore from backup or complete forward recovery; downgrade is unsupported.
- Any old binary attempting an insert after cutover fails the no-default identity
  columns; any attempt to revive a parked row fails the parked-row constraint.
  Treat either as proof that the scale-to-zero inventory was incomplete.
