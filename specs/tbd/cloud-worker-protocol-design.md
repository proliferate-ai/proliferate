# Cloud ↔ Worker Protocol — Target Design

Status: draft

Current gap: the Target, command/control, exposure/projection, and Worker
event-tail paths described here are absent from current code.

## 1. Tiered Truth (the backbone)

There is no single source of truth — different data has different owners:

| Tier | Owns truth for | Notes |
| --- | --- | --- |
| **Git** | durable **code** | the sandbox is rebuildable from it |
| **Sandbox (AnyHarness)** | the **live work** — running session, files-in-flight, transcript as generated | authoritative *while alive*; ephemeral instance |
| **Cloud DB** | **control-plane** — command intent, desired config, exposure, claims, identity, billing | the sandbox doesn't know about these |

The worker is a **two-direction pump**:

```text
INTENT (down):  Cloud owns it  → worker pulls → sandbox applies   (queue + dispatch)
TRUTH  (up):    sandbox emits  → worker tails → Cloud projection → fan-out to clients
```

Clients cannot reach a cloud sandbox directly, so Cloud is the reachable
**replica + fan-out hub** for the up-direction. That is the whole reason the
projection exists.

## 2. Two Classes of Down-Traffic (different correctness models)

Both ride one transport, but they are NOT the same kind of thing.

| | **Discrete acts** | **Desired steady-state** |
| --- | --- | --- |
| Examples | send_prompt, cancel_turn, create_workspace | auth, plugins, MCPs, skills, exposures, runtime config |
| Durable form in Postgres | a **consumable command row** | a **standing desired-state + revision** |
| Correctness | at-least-once + idempotent + per-session ordered | `applied_revision >= desired_revision` |
| Failure of one message | the act didn't happen → redeliver | nothing to re-fire; next compare/reconcile catches it |

Litmus: *does it have a desired steady-state that must hold regardless of
whether any single message arrives?* → reconcile. Else → command.

Config and exposures are **siblings** of one reconcile pattern — not one
checking the other. Config-reconcile = "what the runtime should be configured
with"; exposure-reconcile = "what the runtime should be projecting."

## 3. The Reconcile Model (desired-state convergence)

A revision lives in **three places**:

| Where | What | Why |
| --- | --- | --- |
| Cloud: **desired** | bumped when config changes | the intent / source of truth |
| Worker: **applied** | derived from the runtime's **real** state | so the worker knows it's behind |
| Cloud: **applied (per target)** | the worker **reports** it up | powers server-side preflight + debug |

Loop: `config change → bump desired → ping control channel → worker compares →
fetch bundle → apply → read-back-verify applied → report applied up`.

The doorbell (Redis pub/sub) is a **lossy wakeup**; the durable truth is the
desired-state + revision in Postgres. A lost doorbell costs nothing — the next
poll/wake/reconcile re-derives `applied < desired` and converges. Self-healing.

`control_cursor` ("highest desired I've been *told*") suppresses re-notification;
it is distinct from `applied` ("highest I've actually installed"). They can
differ (told 7, applied 6 after a failed apply).

### Robustness rules (avoiding the non-converging loop)

- **Check is cheap and runs every cycle; apply is gated by per-domain backoff.**
  So a stuck domain does not hot-retry on every command (decouples retry rate
  from command volume).
- **Terminal failure**: after N backed-off attempts a domain goes `failed`,
  surfaces a typed error, and stops hot-retrying (retries only on backoff
  schedule or when desired bumps again).
- **Per-domain independence**: a broken MCP does not block a prompt that
  doesn't need it. A command that *does* depend on a stuck domain fail-fasts
  with a typed error.
- **`applied` is read back from the runtime's real state** (not an optimistic
  flag) — closes the "applied but forgot to record" bug class.
- **Apply is idempotent** — over-applying is wasted work, never corruption.

## 4. Transport: one long-poll for both classes

The worker holds one control long-poll (`/worker/control/wait`). Cloud holds it
open (parked coroutine, no DB connection held) and wakes it via a Redis pub/sub
doorbell when there is a command to lease or a revision delta — returning both
in one coalesced response. Hold duration < LB idle timeout so the server, not
the proxy, ends each cycle. (See the long-poll mechanics: check → subscribe →
the-check-you-sleep-on → park-on-doorbell-or-deadline → re-check.)

Reconcile is **not a separate process** — same channel, same worker loop. The
control response delivers commands *and* revision signals; the worker routes
commands to the command executor and revision signals to a local reconcile
manager (background work, does not block the next poll).

## 5. Code Structure

```text
cloud/worker/                 # TRANSPORT only
  api.py                      # control long-poll, command lease/result, applied-version report
  control/service.py          # the long-poll machinery
  service.py, models.py, domain/

cloud/<config-domain>/        # each owns its desired-state + revision + bundle builder
  agent_auth/  plugins/  mcp_connections/  ...
  → each exposes a thin worker-facing bundle read that calls its OWN service
```

`cloud/worker` owns transport; **bundle business logic stays in the owning
domain** (no god-module reaching into every domain's config).

```text
worker/outbound/
  loop.py                 # long-poll transport + re-arm (thin)
  dispatch.py             # command → commands/ ; revision-signal → sync/reconciler
worker/commands/
  executor.py             # generic lease→execute→report; forwards most kinds to AnyHarness
  handlers/<kind>.py      # only for kinds needing real local work (materialize, git, …)
worker/sync/
  reconciler.py           # GENERIC: tracks applied/desired/backoff per domain; decides what's due
  handlers/<domain>.py    # PER-DOMAIN apply: fetch bundle → push to AnyHarness/local → verify
worker/state/
  store.py                # local persistence: applied revisions + backoff state (survives restart)
worker/contract/          # generated types (single source — see §7)
```

Light apply → worker pushes config straight to local AnyHarness. Heavy apply
(needs the runtime to materialize) → rides the command path.

## 6. The Four Contracts

Shared currency:

```text
type RevisionMap = Map<string, u64>   // key: "auth" | "plugins" | "mcp:<id>" | "exposures" | "revoked-jti" | ...
```

There is no `SlotFence`. Identity is the bearer `worker_token` (which resolves
to a single `target_id`); the target is ephemeral and 1:1 with its sandbox, so
there is no slot id or generation to carry. Folding `revoked-jti` into the
RevisionMap is what keeps everything on the **one** control poll.

**(1) Control exchange** (long-poll, both directions):

```text
ControlRequest  = { control_cursor; supported_command_kinds[]; wait_seconds; lease_timeout_seconds }
ControlResponse = { reason; commands: CommandEnvelope[]; revision_signals: RevisionMap; control_cursor; server_time }
```

**(2) Command envelope** (down):

```text
CommandEnvelope = {
  command_id: uuid            // idempotency key + correlation id + status handle
  kind; payload               // discriminated union per kind
  required_revisions: RevisionMap   // preflight: applied >= these before executing
  lease_id; lease_expires_at; attempt
}
```

**(3) Worker report** (up): `AppliedRevisionsReport = { applied_revisions: RevisionMap }`
and per command `CommandResult = { command_id; lease_id; status; error_code?; error_detail?; result_payload? }`.

**(4) Bundle** (down, per domain, on fetch): `BundleResponse = { key; revision; content_hash; payload<domain> }`.
`content_hash` lets the worker set `applied = revision` only after verifying the
runtime's real installed state.

## 7. Single-Source Contracts (across the Py/Rust + independent-deploy boundary)

"Single place" = one authoritative **definition**, all language types
**generated** — not a runtime-shared library (impossible across Python/Rust/
network).

- Cloud is the server, so the **cloud-side contract module is the source**;
  FastAPI emits OpenAPI; the Rust worker client + TS client SDK are generated
  from it. Generated code is checked in, never hand-edited.
- **CI enforces sync**: regen → `git diff` must be clean.
- **Capability negotiation** (`supported_command_kinds`) makes new kinds safe:
  Cloud only leases kinds the worker advertises.
- **Additive-only, unknown-tolerant**: add fields, never remove/repurpose
  without deprecation; unknown fields ignored; unknown command kind → typed
  `unsupported_kind` rejection, never a crash.
- Command payloads that mirror AnyHarness ops **reuse `anyharness-contract`**;
  this contract owns only the envelopes + revisions (no fencing — identity is
  the `worker_token`/`target_id`).

## 8. The Up-Direction (events)

Out of scope for detailed design here, but the same robustness bar: ordered
per-session sequence + gap detection + backfill + idempotent ingest (dedup by
seq/hash). The worker tails AnyHarness events (exposure-gated) and uploads
batches; Cloud ingests into the projection for client fan-out.
