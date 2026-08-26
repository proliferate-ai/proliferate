# Environments

Status: target. Grade C. The body asserts the destination — one sandbox
primitive with two lifecycle classes — and the current implementation
(personal sandboxes under `server/cloud/`, dissolving under
[delivery-spec-delete-dark-cloud.md](../../../delivery/cull-sweep/delivery-spec-delete-dark-cloud.md))
is recorded as archaeology in [Known gaps](#known-gaps). Supersedes
[SANDBOX/lifecycle.md](README.md).

Read before touching: `server/proliferate/integrations/sandbox/**` and
`scripts/build-template.mjs` (both live). The rest of the code map below is
archaeology: cull part 2 deleted `db/models/cloud/sandboxes.py`,
`db/store/cloud_sandboxes.py`, `server/cloud/cloud_sandboxes/**`,
`server/cloud/materialization/**`, and `server/cloud/runtime/**` — their
paths render as plain code spans, and the engine's invariants (with the
pre-deletion SHA for one-command restore) are recorded in
[notes-materialization-engine.md](../../../delivery/cull-sweep/notes-materialization-engine.md).
`server/cloud/gateway/**` survives, held for the future `runtime_gateway`
(spec amendment).

## 1. Purpose

An environment is the container a run executes in: a provider VM (E2B
today) carrying the execution bundle — supervisor, worker, AnyHarness —
provisioned from one immutable template. This system owns the container and
nothing inside it: provisioning, lifecycle states and their single causes,
the template pipeline, usage-segment fencing, health, and reaping.

The generalization the rebuild delivers is **one primitive, two classes**:

| | Personal | Task |
| --- | --- | --- |
| Cardinality | singleton per (user, org) | one per run (or run group) |
| Lifecycle owner | the user | the run |
| Wake | traffic (provider auto-resume) | never — provisioned live |
| Death | explicit delete only | complete → checkpoint → pause → reap after retention |
| Provision trigger | GitHub authority-chain completion | placement of a run; org installation only, no user-auth leg |

Same template, same provisioning engine, same supervisor topology, same
fencing. The existing "one per (user, org)" law becomes a law *about the
personal class*. Compute is a lazily-bound resource of a run, never the
other way around.

## 2. Owned state

The sandbox row
(`sandboxes.py`),
written only through
`db/store/cloud_sandboxes.py`:

```text
cloud_sandbox
├── owner_user_id                    personal class: the person
├── sandbox_type                     provider kind (e2b)
├── provider_sandbox_id              current provider binding (nullable, detachable, unique)
├── status                           creating | ready | paused | error | destroyed
├── materialization_attempt          attempt epoch — the fence every completion compares
├── provider_observed_at             provider freshness floor
├── last_error                       sanitized receipt of the last failed attempt
├── anyharness_base_url · runtime_token_ciphertext · anyharness_data_key_ciphertext
│                                    stamped runtime access (custody: secrets)
├── ready_at · last_health_at · destroyed_at
└── desired_anyharness_version · desired_worker_version   per-target pins (seam admin route)
```

Target additions (※ new): `class` (`personal | task`), a polymorphic owner
(`owner_user_id` for personal, `run_id` for task), `organization_id` NOT
NULL, per-class uniqueness (`(owner_user_id, organization_id)` for personal;
`run_id` for task), a per-class causes table, a reap policy, and the
org/class **concurrency policy row + placement queue**.

Also owned: the template artifacts and their promotion state (immutable
sha tags, `:staging` / `:production` rolling tags — produced by
[build-template.mjs](../../../scripts/build-template.mjs),
[promote-cloud-template.mjs](../../../scripts/promote-cloud-template.mjs),
[smoke-cloud-template.mjs](../../../scripts/smoke-cloud-template.mjs) and the
two workflows
[release-cloud-template.yml](../../../.github/workflows/release-cloud-template.yml),
[promote-cloud-template.yml](../../../.github/workflows/promote-cloud-template.yml));
and the fenced open/close operations on compute usage segments (billing owns
what a segment costs).

> [!decision] PABLO DECIDES: class as a column or as two tables.
> Options: (a) one `cloud_sandbox` table with a `class` column and
> check-constrained owner polymorphism (the Cull Plan's ruling); (b) a
> `task_environment` table sharing the engine through a protocol.
> Recommendation: (a) — the engine, fencing, webhooks, and reaper are
> identical and keyed by row id; two tables would fork every fence.

## 3. Public surface

Today, under `/v1/cloud`
(`cloud_sandboxes/api.py`):

| Route | Purpose |
| --- | --- |
| `GET /cloud-sandbox` | the caller's personal row (status, timestamps, last-error receipt) |
| `POST /cloud-sandbox/ensure` | create or return the row, billing-gated; never touches the provider |
| `DELETE /cloud-sandbox` | revoke workers and gateway token, mark destroyed, kill the provider VM after commit |

Internal surface consumed by other systems:
`materialization/service.py`
(`schedule_materialize_sandbox`, `schedule_repair_materialize_sandbox`,
`schedule_materialize_repo_environment`, `schedule_materialize_secret_set`,
`schedule_materialize_agent_auth`) and the engine entry
`connect_ready_sandbox` in
`sandbox_io/connect.py`,
always invoked through
`operation.py`.

Target surface (※ new): **placement** — `place(run) → environment` for the
task class, called by the runs system and answered from the concurrency
queue; **reap** after the run's terminal checkpoint; the personal
ensure/destroy verbs unchanged; no user-facing ensure for the task class
(runs own it).

## 4. Consumes

- **Provider adapter** —
  [integrations/sandbox/](../../../server/proliferate/integrations/sandbox/base.py)
  (`SandboxProvider` protocol: create, connect, resume, pause, destroy,
  state reads, command and file I/O) with the E2B implementation in
  [e2b.py](../../../server/proliferate/integrations/sandbox/e2b.py) and
  [constants/sandbox/e2b.py](../../../server/proliferate/constants/sandbox/e2b.py)
  (2700 s idle timeout, runtime port 8457). Multi-provider stays behind
  this adapter; it is a dial, not a build item.
- **Billing** — the ensure gate and the resume gate
  ([billing_subjects](../../../server/proliferate/db/store/billing_subjects.py));
  segment cost and holds are billing's
  ([BILLING.md](../billing/deep-dive.md)).
- **Seam** — `create_cloud_sandbox_enrollment` at runtime launch
  (`runtime_launch.py`)
  and worker liveness for `workerDegraded` ([seam.md](seam.md)).
- **GitHub** — the authority chain (membership ∧ installation ∧ user-auth)
  that triggers personal-class provisioning; installation-only for the task
  class ([SANDBOX/github-auth.md](../github/sandbox-github-auth.md)).
- **Secrets / agent auth** — what is materialized into the VM
  (`materialize/secret_set.py`,
  `materialize/agent_auth.py`);
  custody laws are theirs.
- **Managed runtime** — the supervisor-owned launch topology inside the VM
  (`runtime/bootstrap.py`
  builds env, launcher, and supervisor config;
  [MANAGED_RUNTIME.md](../harnesses/managed-runtime.md)).
- **Runs** (※ new) — the placement request and the terminal checkpoint
  signal that permits reaping.

## 5. Laws

Lifecycle:

**Only explicit delete destroys a personal sandbox; a task sandbox is reaped
by its run.** No timeout, error, webhook, or reaper pass sets `destroyed` on
an attributed personal row — idle sandboxes pause. A task row's death is a
lifecycle event of the run: terminal → checkpoint acknowledged → pause →
reap after retention.

**`error` is per-attempt, not terminal.** It records the last failed
materialization with a sanitized receipt; the next attempt retries the same
row (`failures.py`).

**Ensure never provisions.** Row bookkeeping is free and unconditionally
safe to call; provider work happens only inside a materialization operation.

**A sandbox provisions when it first becomes able to do work — not before,
not lazier.** Personal: authority-chain completion for the (user, org) pair
schedules one background bootstrap that ends *paused*. Task: placement of a
run provisions live, with the org installation as the only GitHub authority
(Law 6: headless runs never hold human credentials).

**The gateway gates on policy, the provider wakes on traffic,
materialization repairs.** No wake verb exists (grep-gate E6 holds). A row
with no stamped runtime access answers `409 cloud_sandbox_runtime_not_ready`
and schedules exactly one repair, claim-deduplicated across processes
(`locks.py`).

**One engine, serialized per sandbox.** `connect_ready_sandbox` under the
per-sandbox lock: refuse destroyed, re-check the billing gate, bump the
attempt epoch, resume-or-create, accept the resume conservatively
(`resume_acceptance.py`),
health-probe the existing runtime
(`liveness_health.py`),
initialize if needed, mark ready with a CAS write. Lock timeout is a typed
busy error, never a second engine run.

Fencing (the billing primitives this system owns):

**Three fence inputs, all on the row.** `materialization_attempt` (epoch),
`provider_sandbox_id` (identity), `provider_observed_at` (freshness floor).
Every usage open and close names the exact binding it fences; any delayed
observation at or before the floor is inert.

**Supersession is transactional and committed first.** Only authoritative
provider-target-not-found detaches a binding: CAS the binding to absent and
close that exact provider's segment in one transaction before creating a
replacement. Transient failures never supersede.

**Create records identity and usage together.** A provider create persists
the exact new provider id and its provision usage in one transaction; an
ambiguous commit adopts the known candidate rather than losing custody of a
spending VM.

**Terminal events close exactly one segment.** Kill, delete, and reap each
close the exact bound provider's segment and nothing else.

Capacity (※ new):

**Placement is admission-controlled per (org, class).** A concurrency policy
row bounds live task environments per org; placement beyond it queues, never
fails, and the queue is the one genuinely new backend piece.

**The org is the only billing subject.** No stored payer on the row; the
subject derives from `organization_id`.

> [!decision] PABLO DECIDES: reap retention for task environments.
> Options: reap immediately after the checkpoint ack; keep paused for a
> fixed window (e.g. 24 h) so "open" still works for a just-finished run;
> per-definition policy. Recommendation: fixed 24 h paused window, then
> reap — paused compute is nearly free and it keeps the triage view's
> "open" verb honest for a day.

> [!decision] PABLO DECIDES: personal-class eager bootstrap.
> The current law provisions on authority-chain completion and ends paused
> (~bootstrap minutes of spend per user). Options: keep; or make personal
> sandboxes provision on first workspace use like the task class.
> Recommendation: keep — the desktop-first product means personal cloud
> sandboxes are rare, and warm-on-first-open is the whole point of the
> class.

## 6. Emits

- Sandbox status transitions, projected onto workspace runtime status
  (`GET /workspaces/{id}/runtime-status` with `workerDegraded`; shape owned
  by [SANDBOX/access.md](README.md)).
- Usage segment open/close with exact provider identity, consumed by
  billing.
- Provisioning telemetry
  (`provisioning_observability.py`).
- Target: `environment_bound` / `environment_lost` on the session registry
  row (drives open / wake / fork), placement queued/admitted for triage, and
  the task-class `killed → run failed` mapping.

## 7. Fences

- **Seam** owns worker identity, enrollment, heartbeat
  ([seam.md](seam.md)); environments only mint the ticket at launch.
- **Managed runtime** owns what runs inside the VM after launch
  ([MANAGED_RUNTIME.md](../harnesses/managed-runtime.md)).
- **Runtime gateway** owns the wire from clients to a sandbox's runtime and
  the bearer swap ([SANDBOX/gateway.md](README.md)).
- **Workspaces** own repository clones, worktrees, and the two workspace
  records ([SANDBOX/content.md](README.md),
  [cloud-workspace.md](../workspace-surface/cloud-workspace.md)).
- **GitHub** owns the authority chain and PR identity.
- **Billing** owns cost, credits, holds
  ([BILLING.md](../billing/deep-dive.md)).
- **Secrets / agent auth** own custody of what is materialized.
- **Runs** (※ new) own the run row, its result, and when a task environment
  may be reaped.

## 8. Code map

Current (`main`; every path under `server/cloud/` relocates to
`server/environments/` when the cloud shell dissolves — a pure move):

```text
scripts/
├── build-template.mjs                              template build, binaries baked in
├── promote-cloud-template.mjs                      rolling tag → verified immutable tag
└── smoke-cloud-template.mjs                        throwaway-sandbox smoke
.github/workflows/
├── release-cloud-template.yml                      immutable sha-tag build lane, moves :staging
└── promote-cloud-template.yml                      smoke an immutable tag, move :production
server/proliferate/
├── constants/sandbox/e2b.py                        timeout, runtime port, binary path
├── integrations/sandbox/
│   ├── base.py                                     SandboxProvider protocol
│   ├── e2b.py                                      the adapter
│   ├── e2b_webhooks.py                             webhook shapes (lane re-added for task class)
│   └── factory.py
├── db/models/cloud/sandboxes.py                    the row + HarnessLaunchOptionState (agent auth's)
├── db/store/cloud_sandboxes.py                     fenced transitions: ensure, retry, observe, destroy
├── server/cloud/provisioning_observability.py      provisioning telemetry
└── server/cloud/
    ├── cloud_sandboxes/
    │   ├── api.py · models.py                      ensure/destroy routes
    │   ├── service.py                              ensure_personal_cloud_sandbox_exists, destroy
    │   └── transactions.py
    ├── materialization/
    │   ├── service.py                              schedule_* entry points
    │   ├── operation.py                            per-sandbox lock around every engine run
    │   ├── locks.py                                Redis claim + distributed lock
    │   ├── failures.py                             receipts, classification
    │   ├── manifests.py · paths.py · runner.py
    │   ├── sandbox_io/
    │   │   ├── connect.py                          the provisioning engine
    │   │   ├── resume_acceptance.py                post-resume pause reconciliation
    │   │   ├── runtime_launch.py                   supervisor-owned launch; mints the worker ticket
    │   │   ├── commands.py · files.py · safety.py · target.py
    │   └── materialize/
    │       ├── sandbox.py                          bootstrap composition
    │       ├── repo_environment.py · github_credentials.py · git_identity.py   (workspaces / github)
    │       ├── secret_set.py · agent_auth.py       (secrets / agent auth content)
    └── runtime/
        ├── bootstrap.py                            env, launcher, supervisor config
        ├── liveness_health.py                      health + auth-enforcement probes
        ├── bundle.py · data_key.py · sandbox_exec.py · domain/
```

Target additions (※ new): `server/environments/placement/` (concurrency
policy, queue, `place(run)`), `server/environments/reaper/` (task-class
reap after checkpoint; orphan backstop), `server/environments/webhooks/`
(provider lifecycle events, HMAC — salvaged in
[notes-webhook-hmac.md](../../../delivery/cull-sweep/notes-webhook-hmac.md)),
and a browser in the template for QA / computer-use.

## 9. Proof

Current laws are pinned by
`test_cloud_sandbox_ensure_billing_gate.py`
(ensure never provisions, billing gate),
`test_cloud_sandbox_cold_access_repair.py`
(409 + single scheduled repair),
`test_cloud_sandbox_recovery.py`,
`test_cloud_sandbox_reconnect_self_heal.py`,
`test_cloud_sandbox_billing_recovery.py`
(fenced segments),
`test_cloud_sandbox_desired_versions.py`,
`test_cloud_materialization_concurrency.py`
(one engine run per sandbox),
`test_cloud_materialization_failures.py`
(receipts),
`test_cloud_sandbox_destroy_provider.py`
(delete kills after commit), and the managed-cloud release world under
`tests/release/src/worlds/managed-cloud/`.

Target laws (placement, reap, task class) have no tests yet; each lands with
its build item.

## Known gaps

- [ ] The task class does not exist: no `class` column, no run owner, no
      placement, no reaper, no concurrency policy. Build order item 2.
- [ ] Account model is one sandbox per user globally
      (`ux_cloud_sandbox_personal_active` on `owner_user_id`; the store
      hardcodes `organization_id=None`). Ruled shape: `organization_id` NOT
      NULL, uniqueness `(owner_user_id, organization_id)`, no stored payer.
- [ ] Provisioning does not fire on full authority-chain completion — the
      user-auth callback alone schedules it; the installation callback and
      org-join trigger nothing.
- [ ] The eager bootstrap does not force-pause on completion (~45 idle
      minutes per provision).
- [ ] Worker death surfaces as `workerDegraded` but routes to no alert.
- [ ] The E2B webhook lane and the orphan reaper were deleted in
      delete-dark-cloud part 1 (zero live consumers while cloud is dark);
      the task class re-adds both under `server/environments/`, with
      `killed → run failed` instead of row error-retry.
- [ ] `runtime_generation` is a hardcoded store constant after its column
      was dropped; deletion is owned end to end by
      [SANDBOX/gateway.md](README.md).
- [ ] Every current path lives under `server/cloud/`, which
      delete-dark-cloud part 2 is dissolving. Any file above that part 2
      deletes must come off this map in the same PR; the survivors move to
      `server/environments/` in sweep Wave 2.
- [ ] `HarnessLaunchOptionState` shares
      `sandboxes.py`
      with the sandbox row but is agent auth's state; split the model file
      when the folder moves.
- [ ] > [!decision] PABLO DECIDES: what survives of `materialization/`.
      The Cull Plan says the engine and fencing are reused verbatim with a
      class-aware entry; part 2 of delete-dark-cloud deletes
      `materialization/` wholesale. These contradict. Options: keep
      `sandbox_io/connect.py`, `operation.py`, `locks.py`,
      `resume_acceptance.py`, `runtime_launch.py`, `failures.py` and delete
      the rest; or delete all and rebuild the engine from this spec.
      Recommendation: keep the engine files — they are the race-tested money
      code the fencing laws above describe, and rewriting them is the one
      part of the rebuild that can lose custody of a spending VM.
