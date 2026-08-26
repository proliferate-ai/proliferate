# Seam

Status: target for the courier and event-shipping halves; the worker half (enrollment, identity, heartbeat) describes `main`. Grade B / C — see [Known gaps](#known-gaps).

Read before touching: `server/proliferate/server/seam/**`, `server/proliferate/db/models/runtime_workers.py`, `server/proliferate/db/store/runtime_workers.py`, `anyharness/crates/proliferate-worker/**` (except `supervisor_bridge/`, which belongs to the managed runtime).

## 1. Purpose

The seam is the one contract between the control plane and a runtime. It answers three questions and nothing else: *who is this runtime* (identity and enrollment), *is it alive and what should it be running* (heartbeat), and — the target half — *how do prompts get down and events get up durably* (courier and shipping). Everything the control plane knows about a live execution environment arrives through this contract; everything a runtime is told by the control plane leaves through it. The worker process is the only speaker on a target: the runtime never talks to the control plane, and the supervisor never does either.

The seam is symmetric by design: prompts travel down keyed by `(session, delivery_seq)` with a runtime ack cursor; events travel up keyed by `(session, seq)` with a control-plane ack cursor. One cursor discipline, two directions. Freezing this contract first is what lets every other system be built against it.

## 2. Owned state

Server tables ([runtime_workers.py](../../../server/proliferate/db/models/runtime_workers.py)):

```text
cloud_runtime_worker_enrollment   single-use ticket: (owner, org?, runtime_kind,
                                  cloud_sandbox_id | desktop_install_id), token hash,
                                  status pending|consumed|expired|revoked, TTL
cloud_runtime_worker              the enrolled identity: runtime_kind cloud_sandbox|desktop,
                                  status online|offline|revoked, self-reported versions,
                                  last_seen_at; at most one non-revoked row per sandbox
                                  and per (owner, desktop install)
cloud_integration_gateway_token   hash-only derivative of a worker; at most one active
                                  per worker; revoked with it
```

Worker-side state (SQLite at `worker_db_path`, [store/](../../../anyharness/crates/proliferate-worker/src/store/mod.rs)): the durable identity `worker_id + worker_token` ([store/identity.rs](../../../anyharness/crates/proliferate-worker/src/store/identity.rs)) and the last-observed running AnyHarness version ([store/anyharness_update.rs](../../../anyharness/crates/proliferate-worker/src/store/anyharness_update.rs)). The worker persists nothing else about its target: sandbox, user, kind, revocation, and liveness are control-plane associations.

Worker-written files: the integration-gateway dotfile the runtime reads to reach the gateway ([integration_gateway.rs](../../../anyharness/crates/proliferate-worker/src/integration_gateway.rs)).

Target state (※ new, see Known gaps): per-session prompt-outbox delivery attempts and the two ack cursors (runtime ack of `delivery_seq`, control-plane ack of event `seq`).

> [!decision] PABLO DECIDES: which spec owns the outbox and cursor rows.
> The session registry row (sessions spec) carries *queued prompts* as
> content; the seam owns *delivery bookkeeping* (attempt counts, both cursors,
> the `delivery_stalled` verdict). Options: (a) one `session_prompt_outbox`
> table owned by the seam, with the registry row holding only a pointer;
> (b) columns on the registry row owned by sessions, with the seam allowed to
> write only the cursor columns. Recommendation: (a) — the outbox is a
> transport object with its own retry laws, and a table with one writer is
> the Organization Standard's definition of owned state.

## 3. Public surface

All routes mount under `/v1/cloud` via `cloud/api.py` (the mount point moves when that shell dissolves; the paths do not change).

Worker-authenticated (bearer `worker_token`, [auth.py](../../../server/proliferate/server/seam/workers/auth.py)):

| Route | Purpose |
| --- | --- |
| `POST /worker/enroll` | Consume a single-use enrollment token; returns `worker_id`, `worker_token`, `heartbeat_interval_seconds`, integration-gateway coordinates |
| `POST /worker/heartbeat` | Liveness + self-reported versions in; `desired_versions` and the `launch_options_upload_allowed` verdict out |
| `GET /worker/download/{target}/{asset}` · `GET /runtime/download/{target}/{asset}` | Unauthenticated 302 to the pinned binary on the downloads CDN |
| `GET /worker/download/{target}/{version}/{asset}` · `GET /runtime/download/{target}/{version}/{asset}` | Exact-version 302; fails closed (404) on an unpublished version, never falls back to a rolling label |

User-authenticated:

| Route | Purpose |
| --- | --- |
| `POST /workers/desktop/enrollment` | Mint a 900 s enrollment token for the caller's desktop install, optionally org-scoped (membership-validated) |
| `POST /workers/desktop/revoke` | Revoke the caller's active desktop worker and its gateway token; idempotent |
| `PUT /workers/admin/sandboxes/{cloud_sandbox_id}/desired-versions` | Instance-admin per-target version override (`null` clears) |

Python surface (the only importable modules, per [MANIFEST.toml](../../../server/proliferate/server/seam/MANIFEST.toml)): [workers/api.py](../../../server/proliferate/server/seam/workers/api.py), [workers/service.py](../../../server/proliferate/server/seam/workers/service.py) — `create_cloud_sandbox_enrollment` is how environments mint a sandbox worker's ticket at runtime launch — and [workers/models.py](../../../server/proliferate/server/seam/workers/models.py). `authenticate_worker` in [workers/auth.py](../../../server/proliferate/server/seam/workers/auth.py) is the dependency any worker-facing route on another system uses to establish a `WorkerAuthContext`.

Worker binary surface: `proliferate-worker` configured by [config.rs](../../../anyharness/crates/proliferate-worker/src/config.rs) (`cloud_base_url`, `enrollment_token`, `worker_db_path`, `heartbeat_interval_seconds`, `runtime_base_url`, `supervisor_update_request_dir`); `--once` performs one heartbeat as a dry run.

Target surface (※ new): the courier delivery call into the runtime, the runtime's ack of `delivery_seq`, the event-ingest POST keyed by `(session, seq)`, and the checkpoint upload — all cursor-shaped and idempotent. Whether these ride the heartbeat or dedicated routes is a decision below.

## 4. Consumes

- [db/store/runtime_workers.py](../../../server/proliferate/db/store/runtime_workers.py)
  — its own store, and the only writer of the three tables above.
- `db/store/cloud_sandboxes.py`
  — read-only: per-sandbox desired-version overrides and `destroyed_at` for
  the upload verdict (environments).
- [db/store/organizations.py](../../../server/proliferate/db/store/organizations.py)
  and
  [db/store/instance_organizations.py](../../../server/proliferate/db/store/instance_organizations.py)
  — membership validation for org-scoped desktop enrollment; instance-admin
  check for the desired-versions route (organizations / accounts).
- [server/version.py](../../../server/proliferate/server/version.py) — the
  fleet pins `RUNTIME_VERSION` / `WORKER_VERSION` stamped at build time.
- [integrations/desktop_downloads.py](../../../server/proliferate/integrations/desktop_downloads.py)
  — CDN URL resolution behind the 302 routes.
- [constants/cloud.py](../../../server/proliferate/constants/cloud.py) — the
  seam's numbers: heartbeat interval 30 s, offline threshold 90 s, enrollment
  TTLs 3600 s (sandbox) / 900 s (desktop), HMAC token domains.

Worker side: the runtime's local HTTP surface (read-only version poll `GET /v1/catalogs/agents/version`, launch-option state reads) and the supervisor mailbox directory (write-only, managed runtime).

## 5. Laws

**One active worker per identity.** Enrollment retires every prior non-revoked worker for the same sandbox, or for the same desktop install regardless of owner (a user switch on one machine must not leave the previous user's worker "online" with a live gateway token). Enforced by the partial unique indexes on `cloud_runtime_worker` and by `enroll_worker` in [service.py](../../../server/proliferate/server/seam/workers/service.py).

**Enrollment tokens are single-use, bounded, and hash-only.** The raw token is returned once and never stored; consumption is a compare-and-swap on the pending row (`consume_pending_enrollment_by_hash`); a desktop install's newer ticket revokes older pending ones so a stranded predecessor cannot enroll after its replacement (`revoke_pending_desktop_enrollments_for_install`).

**A durable identity always wins over a config enrollment token, and a revoked identity never re-enrolls itself.** The worker uses a stored `worker_id + worker_token` if present and only enrolls when none exists ([identity/mod.rs](../../../anyharness/crates/proliferate-worker/src/identity/mod.rs)). Re-enrollment is a control-plane act (a new ticket), never a worker reflex.

**Heartbeat is liveness and desired state, nothing more.** The request carries status and self-reported versions; the ack carries the fleet or per-target pins and one verdict. A missed heartbeat never fails the worker loop — the current binary keeps serving and the next tick retries ([runtime.rs](../../../anyharness/crates/proliferate-worker/src/runtime.rs)). Liveness on the control plane is `status = online` with `last_seen_at` inside the 90 s threshold.

**Authentication is a separate boundary from the verdict.** A missing, unknown, or revoked worker receives `401 cloud_worker_unauthorized` with no body — never a 200 whose `launch_options_upload_allowed` happens to be `false`. The heartbeat service re-loads the row (REL-10) so a revocation racing the auth dependency still produces the 401.

**The upload verdict is required on every 200 and fails closed.** The server computes it from the same rule the ingest route enforces (cloud-sandbox worker, sandbox exists, not destroyed); a worker that receives no field treats it as `false` ([lifecycle/heartbeat.rs](../../../anyharness/crates/proliferate-worker/src/lifecycle/heartbeat.rs)). It is never cached across ticks and never influences convergence.

**Exact versions or nothing.** The versioned download routes resolve the requested version or 404; rolling labels (`stable`, `latest`, …) are refused on that path so a pinned target is never handed a differently-labelled artifact (`_reject_rolling_or_unsafe_version`).

**The gateway token is a derivative, not a peer.** It is minted at enrollment, written to the runtime's dotfile by the worker, revoked with the worker, and re-asserted after every successful heartbeat so a delayed predecessor write cannot leave stale authority on disk (`integration_gateway::ensure_current`). What the token *authorizes* is the integration gateway's law, not the seam's.

**The worker is the only control-plane speaker on a target.** The runtime and the supervisor have no control-plane credentials; the worker relays. This is what makes the seam one contract rather than three.

Target laws (※ new — asserted here so the build has a fixed target):

**Session before compute is durable by construction.** A prompt enqueues into the outbox `(session, delivery_seq)` in the same transaction that creates the session or invocation; the courier pushes when the environment is ready.

**Ack means persisted, not answered.** The runtime dedups on `(session, delivery_seq)`, persists into its own log before acting, and only then acks; the response is observed on the event pipe. Delivery is strictly ordered per session with head-of-line blocking; undeliverable past N attempts marks the session `delivery_stalled` — surfaced, never silently dropped.

**Shipping is idempotent and at-least-once on `(session, seq)`.** The control plane dedups; a control-plane outage never affects the runtime — the worker retries from its ack cursor, and every heartbeat carries both cursors as the ≤30 s drain backstop.

**Ship policy is structural.** Ship-now = turn-level and lifecycle events (assistant message completed, status transitions, run result, explicit milestones); checkpoint = intra-turn durable events at terminal states and pauses; never-persist = token deltas and typing. The runtime never knows who is watching; fan-out is the control plane's job by binding. The live mirror is this same endpoint called more often — a frequency dial, never a migration.

## 6. Emits

- Worker liveness, consumed by the workspace runtime-status projection as
  `workerDegraded` (environments / runtime gateway) and by the
  fleet-convergence dashboard (`worker_version`, `anyharness_version`,
  `catalog_version` are telemetry only — never desired state).
- `desired_versions` on the heartbeat ack, consumed by the worker's
  convergence path and, on supervisor-owned targets, turned into a mailbox
  request (managed runtime).
- Worker-side structured events in
  [observability.rs](../../../anyharness/crates/proliferate-worker/src/observability.rs)
  (heartbeat ack, enrollment) with secret scrubbing in
  [logging/scrub.rs](../../../anyharness/crates/proliferate-worker/src/logging/scrub.rs).
- Target: ship-now session events → control-plane ingest → binding fan-out
  (Slack thread, push, registry); `delivery_stalled` on the session registry
  row.

## 7. Fences

- **Managed runtime** owns the supervisor, the file mailbox, binary swaps,
  and the launch topology — everything under
  [supervisor_bridge/](../../../anyharness/crates/proliferate-worker/src/supervisor_bridge/mod.rs)
  and the L1–L8 laws in
  [MANAGED_RUNTIME.md](../harnesses/managed-runtime.md). The seam hands it
  a `desired_versions` verdict and stops.
- **Integration gateway** owns what the gateway token may do
  ([integration_gateway/](../../../server/proliferate/server/integration_gateway/MANIFEST.toml)).
- **Agent auth / models** own the launch-option and model-snapshot content
  the worker copies up
  ([launch_options_sync.rs](../../../anyharness/crates/proliferate-worker/src/launch_options_sync.rs)
  is seam transport; the payload is opaque to it —
  [MODELS.md](../agent_auth/models.md)).
- **Environments** own the sandbox row, provisioning, and the moment a cloud
  worker's ticket is minted
  ([environments.md](../environments/README.md)).
- **Desktop host** owns when and how the desktop app requests a ticket
  ([use-desktop-worker-enrollment.ts](../../../apps/packages/product-client/src/hooks/cloud/lifecycle/use-desktop-worker-enrollment.ts),
  [DESKTOP_HOST.md](../desktop-host/deep-dive.md)).
- **Sessions** own the registry row's content and the runtime's event log;
  the seam moves envelopes and cursors, never interprets them
  ([sessions.md](../sessions/README.md)).

## 8. Code map

```text
server/proliferate/
├── constants/cloud.py                              intervals, TTLs, HMAC token domains
├── db/models/runtime_workers.py                    the three tables + uniqueness fences
├── db/store/runtime_workers.py                     hashing, CAS consumption, revocation cascades
└── server/seam/
    ├── MANIFEST.toml
    ├── __init__.py
    └── workers/
        ├── models.py                               wire shapes (camelCase), version-identifier admission
        ├── auth.py                                 bearer → WorkerAuthContext
        ├── service.py                              enrollment, heartbeat, artifact redirects, admin pins
        └── api.py                                  the routes above

anyharness/crates/proliferate-worker/src/
├── main.rs                                         entry; config load; run loop
├── config.rs                                       WorkerConfig
├── runtime.rs                                      ensure_enrolled → heartbeat_and_converge loop
├── identity/
│   ├── mod.rs                                      durable-identity-wins precedence
│   ├── enrollment.rs                               enroll request/response mapping
│   ├── credentials.rs                              WorkerIdentity
│   └── fingerprint.rs                              machine fingerprint
├── cloud_client/
│   ├── mod.rs                                      HTTP client: enroll, heartbeat, ingest, artifact resolve
│   ├── auth.rs                                     bearer header
│   ├── heartbeat.rs                                request builder
│   └── tests.rs
├── lifecycle/
│   ├── mod.rs
│   └── heartbeat.rs                                send_once, interval floor (10 s), catalog-version poll
├── integration_gateway.rs                          dotfile write + post-heartbeat repair
├── launch_options_sync.rs                          verdict-gated launch-option copy (payload opaque)
├── store/
│   ├── mod.rs · connection.rs · migrations.rs      worker SQLite
│   ├── identity.rs                                 worker_id + worker_token
│   └── anyharness_update.rs                        last observed running runtime version
├── versions.rs                                     running-version resolution
├── observability.rs · logging.rs · logging/scrub.rs
├── process_lock.rs                                 one worker process per db path
├── error.rs · test_support.rs · runtime_tests.rs
└── supervisor_bridge/                              NOT SEAM — managed runtime (mailbox)
```

Target additions (※ new, not on `main`): `server/seam/courier/` (outbox drain, delivery attempts, wake-on-completion messages), `server/seam/ingest/` (ship-now endpoint, checkpoint upload, cursors, binding fan-out), and the worker's event shipper subscribed to the runtime's loopback SSE.

## 9. Proof

- [test_cloud_runtime_workers_api.py](../../../server/tests/integration/test_cloud_runtime_workers_api.py)
  — enrollment consumption, single-active-worker retirement, heartbeat 401
  on revocation.
- [test_cloud_runtime_worker_ticket_fencing.py](../../../server/tests/integration/test_cloud_runtime_worker_ticket_fencing.py)
  — newest-wins desktop ticket rotation.
- [test_cloud_runtime_worker_versions_api.py](../../../server/tests/integration/test_cloud_runtime_worker_versions_api.py)
  — admin per-target pins, rolling-label refusal.
- [test_cloud_runtime_workers_launch_options_eligibility.py](../../../server/tests/integration/test_cloud_runtime_workers_launch_options_eligibility.py)
  — the verdict rule equals the ingest rule.
- [test_worker_heartbeat_contract.py](../../../server/tests/unit/test_worker_heartbeat_contract.py)
  with
  [helpers/worker_heartbeat.py](../../../server/tests/helpers/worker_heartbeat.py)
  — Python model serializes byte-for-byte to the shared fixtures the Rust
  side decodes (compat both directions).
- [cloud_client/tests.rs](../../../anyharness/crates/proliferate-worker/src/cloud_client/tests.rs)
  and
  [runtime_tests.rs](../../../anyharness/crates/proliferate-worker/src/runtime_tests.rs)
  — worker-side enrollment precedence, verdict fail-closed, dotfile repair.

## Known gaps

- [ ] Courier (down) and shipping (up) do not exist. Today the control plane
      reaches the runtime directly through the runtime gateway for prompts
      and reads, and nothing ships events up; background runs with no
      attached client have no egress. Build order item 1.
- [ ] > [!decision] PABLO DECIDES: transport for the target half.
      Options: (a) piggyback both cursors and small ship-now batches on the
      existing heartbeat (one route, 30 s floor, simplest); (b) dedicated
      `POST /worker/events` + `POST /worker/checkpoints` + a courier pull
      `GET /worker/deliveries` with the heartbeat carrying only cursors as the
      drain backstop. Recommendation: (b) — the settled design needs
      sub-second ship-now for Slack, which the heartbeat cadence cannot give,
      and the heartbeat stays a pure liveness signal.
- [ ] > [!decision] PABLO DECIDES: who POSTs events — the worker (subscribed
      to the runtime's loopback SSE, as the settled design says) or the
      runtime itself. Recommendation: the worker, to keep "the worker is the
      only control-plane speaker" a law with zero exceptions.
- [ ] > [!decision] PABLO DECIDES: desktop courier. Purely local sessions
      never touch the control plane; a desktop-bound session created by a
      trigger needs *some* courier. Options: the desktop client polls the
      outbox as a client courier; or the desktop worker gains the same
      courier pull as a sandbox worker. Recommendation: the worker — one
      seam, both target classes, no client-side delivery logic.
- [ ] Task-class enrollment carries no `(subject, run)` today; the enrollment
      row is owner-user keyed. Environments' task class needs the ticket
      minted for a run, with the org as subject (Law 6: headless runs hold no
      human credentials).
- [ ] [MANIFEST.toml](../../../server/proliferate/server/seam/MANIFEST.toml)
      `allowed_importers` lists `cloud`, `cloud/harness_launch_options`,
      `cloud/materialization` — all dissolving under
      [delivery-spec-delete-dark-cloud.md](../../../delivery/cull-sweep/delivery-spec-delete-dark-cloud.md).
      After part 2 the importers are `environments` (ticket minting at launch)
      and `agent_auth` (launch-option ingest); the checker re-measures.
- [ ] The admin desired-versions route and the exact-version download
      routes serve the managed runtime's convergence story; they live in the
      seam because they share the worker's auth and store. If the managed
      runtime spec graduates into `specs/systems/`, re-fence them there.
- [ ] `MANAGED_RUNTIME.md` still narrates enrollment and heartbeat in full;
      those two sections now defer here (banner added in this PR) and should
      shrink to worker-side mechanics only.
