# Worker enrollment failure

Status: authoritative for first-response triage of Proliferate Worker
enrollment, heartbeat, and version convergence failures.

Use this runbook after an E2B sandbox and AnyHarness are reachable but the
optional Worker sidecar does not enroll, heartbeat, or converge
Worker/AnyHarness versions. Worker ownership is documented in
[`specs/areas/anyharness.md`](../../specs/areas/anyharness.md);
on a supervisor-owned target the swap itself belongs to
[`specs/areas/anyharness.md`](../../specs/areas/anyharness.md).
The agent catalog is not a separate convergence axis: it ships inside the
runtime binary ([agent-distribution.md](../../specs/systems/harnesses/distribution.md)),
so a catalog complaint is a binary-version complaint. (The legacy heartbeat
catalog sync still runs until its deletion lands; its evidence path is kept
below, marked legacy.)
Use the (deleted) cloud provisioning runbook when the
provider sandbox or AnyHarness is not independently healthy.

## Required access

- Read-only access to the affected Proliferate database.
- Server logs and Sentry for the affected environment.
- E2B dashboard or approved sandbox log access.
- GitHub Actions access when the failure follows a Worker, AnyHarness, or
  template release.
- Approved read access to Worker config, local SQLite, and logs when available.

Do not paste enrollment or Worker bearer tokens, token hashes, gateway
credentials, runtime tokens, provider keys, local SQLite files, or sandbox
environment values into chat, issues, PRs, or logs. Share only sandbox,
enrollment, Worker, request, release, and sanitized evidence identifiers.

## Mental model

The Worker enrolls once through `/v1/cloud/worker/enroll`, stores its durable
identity locally, and heartbeats through `/v1/cloud/worker/heartbeat`. Heartbeat
returns desired Worker and AnyHarness versions (plus, until the binary-only
catalog deletion lands, a legacy catalog version). Liveness is derived
at read time from `status = 'online'` and `last_seen_at` within 90 seconds; the
application does not eagerly write `offline`.

One convergence topology exists. On a **supervisor-owned target**
(`supervisor_update_request_dir` set), the Worker only *writes* a durable
update request into `.proliferate/supervisor/updates`; Proliferate
Supervisor consumes it (verify → download → re-verify → stage → atomic
activate → dependency-ordered restart → health-gate → rollback) and writes a
result file beside it. A Worker config with no mailbox dir (desktop)
converges nothing — the legacy Worker-owned in-place swaps were deleted by
the cull sweep's delete-worker-legacy track.

Fresh enrollment also writes the integration-gateway credential file. Restart
from durable identity does not recreate a missing gateway file, and an invalid
or revoked durable token does not automatically re-enroll. Worker absence does
not by itself prove AnyHarness is unhealthy.

## Read-only diagnosis

Replace the sandbox placeholder locally. These queries intentionally omit
token hashes and credential values.

```sql
BEGIN READ ONLY;

-- 1. Confirm the owning sandbox without reading runtime-access ciphertext.
select
  id,
  owner_user_id,
  provider_sandbox_id,
  status,
  (anyharness_base_url is not null) as has_anyharness_url,
  (runtime_token_ciphertext is not null) as has_runtime_token,
  last_health_at,
  updated_at
from cloud_sandbox
where id = '<cloud-sandbox-id>';

-- 2. Inspect one-time enrollment attempts.
select
  id,
  runtime_kind,
  status,
  expires_at,
  consumed_at,
  created_at,
  updated_at
from cloud_runtime_worker_enrollment
where cloud_sandbox_id = '<cloud-sandbox-id>'
order by created_at desc;

-- 3. Inspect Worker identity, reported versions, and derived liveness.
select
  id,
  status,
  worker_version,
  anyharness_version,
  hostname,
  enrolled_at,
  last_seen_at,
  revoked_at,
  (status = 'online'
    and last_seen_at is not null
    and last_seen_at >= now() - interval '90 seconds') as is_live,
  created_at,
  updated_at
from cloud_runtime_worker
where cloud_sandbox_id = '<cloud-sandbox-id>'
order by created_at desc;

-- 4. Inspect gateway-token state without reading its hash.
select
  t.id,
  t.runtime_worker_id,
  t.status,
  t.last_used_at,
  t.revoked_at,
  t.created_at,
  t.updated_at
from cloud_integration_gateway_token t
join cloud_runtime_worker w on w.id = t.runtime_worker_id
where w.cloud_sandbox_id = '<cloud-sandbox-id>'
order by t.created_at desc;

ROLLBACK;
```

Check AnyHarness health independently through the authenticated cloud-sandbox
gateway. If it is healthy, inspect Worker process logs, config paths, and local
SQLite only through approved sandbox access. Correlate sandbox, enrollment,
Worker, request, release, and template identifiers with server logs, Sentry,
E2B state, and the relevant release workflow.

The cloud sidecar uses these paths under the sandbox user's home:

```text
$HOME/.proliferate/worker/config.toml
$HOME/.proliferate/worker/worker.sqlite3
$HOME/proliferate-worker.log
$HOME/.proliferate/anyharness/integration-gateway.json
```

On an approved read-only sandbox shell, inspect config key names without
printing their secret values, query only non-secret SQLite columns, and read
the bounded log tail:

```bash
sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)[[:space:]]*=.*/\1/p' \
  "$HOME/.proliferate/worker/config.toml"
sqlite3 -readonly "$HOME/.proliferate/worker/worker.sqlite3" \
  'select worker_id, updated_at from identity where id = 1;'
sqlite3 -readonly "$HOME/.proliferate/worker/worker.sqlite3" \
  'select converged_version, updated_at from anyharness_update where id = 1;'
# (converged_version is the last Supervisor activation the Worker reconciled;
#  the pending work itself lives in the mailbox:)
ls -la "$HOME/.proliferate/supervisor/updates" 2>/dev/null
tail -n 200 "$HOME/proliferate-worker.log"
test -e "$HOME/.proliferate/anyharness/integration-gateway.json" && \
  stat -c '%U %G %a %n' \
    "$HOME/.proliferate/anyharness/integration-gateway.json"
```

Do not run `select *` against `identity`: that table contains the Worker bearer
token. Do not print the integration-gateway file; its contents include a bearer
credential. Fresh enrollment writes it with mode `0600`, while the Cloud token
row is separate persisted state and can remain active when the local file is
missing.

`cloud_integration_gateway_token.last_used_at` is deliberately not updated on
the request path, so a null or old value is not evidence that the token is
unused.

Catalog convergence is not a separate mechanism to debug: the catalog rides
inside the runtime binary, so binary convergence IS catalog convergence. The
only catalog question is "which catalog is this sandbox running", answered
read-only by `GET /v1/catalogs/agents/version` on AnyHarness (via approved
authenticated access). A version that looks stale is a binary-convergence
question — check the desired AnyHarness version and the Supervisor activation
evidence, not a document push.

## First response

| Evidence | First response |
| --- | --- |
| No enrollment row after a fresh AnyHarness launch | Inspect Cloud sidecar-launch logs and the generated Worker config path; sidecar launch is best-effort. |
| AnyHarness was reused healthy but its Worker is missing | Escalate. The current connect path does not restart the sidecar when it reuses an already-healthy AnyHarness. |
| Pending enrollment expired or a consumed token was reused | Escalate rather than minting or patching credentials manually; no operator-safe re-enrollment flow is documented. |
| Worker exists but heartbeat is stale | Inspect Worker logs, Cloud URL/network reachability, and durable identity loading. Do not infer liveness from the stored `online` value alone. |
| Worker token is revoked or invalid | Escalate. The Worker does not automatically re-enroll, and deleting local SQLite is destructive. |
| Gateway credential file is missing after a restart | Check only the local file's existence, owner, and mode. A durable-identity restart does not recreate it, even when the Cloud gateway-token row remains active. Escalate credential repair. |
| Catalog version does not converge (legacy path) | Compare advertised and active catalog versions, then inspect the AnyHarness version GET, Cloud catalog fetch, authenticated AnyHarness PUT, and catalog-sync logs. Binary update gates and artifact downloads do not govern catalog sync. On a target where the deletion has landed, treat this as a binary-version complaint instead. |
| Binary version does not converge (supervisor-owned target) | Inspect the mailbox: a missing request file means the Worker never observed divergence (heartbeat/logs); a pending request with no result means the Supervisor did not drain it (Supervisor logs, one drain per supervise cycle); a result file records the verify/download/stage/activate/health outcome, including rollback to `.prev`. A recorded failed pin is not retried until a newer pin arrives. |
| Binary version does not converge (legacy target) | Compare the heartbeat response, configured update gates, artifact download availability, and update logs. |
| Worker update fails (legacy target) | Inspect checksum/preflight/swap evidence; legacy Worker self-update has no post-exec `.prev` health rollback. |
| AnyHarness update fails (legacy target) | Inspect stop/swap/relaunch/health evidence; the legacy updater can restore the `.prev` binary. |

Do not manually mutate database rows, rotate tokens, delete Worker-local
SQLite, delete or hand-write mailbox request/result files, destroy the
provider sandbox, or replace a sandbox as routine recovery. There is no
command lease, control long-poll, or event tail to inspect; the Supervisor
update mailbox (`.proliferate/supervisor/updates`) is the one durable
update-coordination surface, and it is read-only for operators.

## Verification

Recovery is complete when AnyHarness remains healthy independently, the active
Worker is live by the 90-second rule, heartbeats persist the observed Worker
and AnyHarness versions, and the running versions match the desired versions
(on a supervisor-owned target: the mailbox is drained with a success result
and `/health` reports the desired version; the catalog follows the binary).
While the legacy catalog sync still exists, also confirm the active catalog
version matches the advertised one. Verify the integration gateway separately
when it was part of the symptom.

## Final report

Report the environment; sandbox, enrollment, and Worker ids; observed and
desired Worker, AnyHarness, and catalog versions; first-failing
release/template evidence; root cause; recovery; independent AnyHarness
result; and verification. State explicitly that no tokens, hashes,
credentials, local SQLite contents, or sandbox environment values were shared.
