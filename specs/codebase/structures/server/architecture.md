# Server Architecture

Status: consolidated architecture reference for the Proliferate backend /
control-plane (`server/**`). The per-layer guides and the runtime/protocol design
docs remain the detailed canon; this doc is the single structured overview —
purpose, the 20k-foot model, core workflows, per-folder best practices, and
detailed sections for the **runtime worker tier**, the **cloud ↔ worker up/down
flows**, and the **DB models**.

---

## 1. Purpose / Ownership

The server is the **control plane**: an HTTP API + background workers over
Postgres, integrating external vendors (AnyHarness runtime, Stripe, GitHub, AWS,
Slack). It owns persistence, auth, billing, orgs, and orchestrating runtimes — it
does **not** run agent sessions (AnyHarness does).

**The three rules that generate everything:**

1. **The layer law** — `api.py` (transport) → `service.py` (orchestration) →
   `db/store/**` (DB); `domain/**` (pure rules) on the side; `integrations/**`
   (vendors) as leaves.
2. **The type pipeline** — three distinct layers, never crossed:
   **ORM → dataclass → Pydantic**.
3. **Domain folders answer "what product area?"** — never transport, UI shape, or
   deployment target.

Plus the meta-rule: **lowest layer that can own it cleanly**, and dependencies
point one way.

---

## 2. 20k-Foot Detailed View

### The layers (shelves)

```text
server/proliferate/
  main.py · config.py · errors.py
  constants/<area>.py        # hardcoded policy values
  middleware/                # cross-cutting HTTP lifecycle
  auth/                      # authn deps + shared authz helpers
  db/
    models/<resource>.py     # ORM tables (leaf)
    store/<resource>.py      # ALL database access
  integrations/<vendor>/     # vendor adapters (leaf)
  server/<domain>/           # the product areas (most code)
    api.py service.py models.py
    access.py errors.py domain/<concern>.py
    worker.py reconciler.py scheduler.py worker/
    <subdomain>/
```

| Layer | Owns | Never |
| --- | --- | --- |
| `api.py` | parse → call service → return | `db/store` import, `AsyncSession` methods, SQLAlchemy, business logic, inline auth, try/except around the handler |
| `service.py` | business logic, orchestration, invariants, validation | open sessions, SQLAlchemy, `select/insert/db.execute`, `commit`, inline auth |
| `domain/**` | pure rules: validators, state machines, calculators, mappings, **planners** | `async def`, DB/ORM, FastAPI, integrations, I/O — *returns data* |
| `db/store/**` | query construction + execution; returns **frozen dataclasses** | commit, open sessions; ORM never leaves here |
| `db/models/**` | ORM table definitions only | imports nothing (leaf) |
| `integrations/<vendor>` | typed vendor adapters | importing server domain code (leaf; public via `__init__`) |

### The type pipeline — the server's "state model"

```text
ORM (db/models)  ──store returns──►  @dataclass(frozen=True)  ──models.py ctor──►  Pydantic (wire)
   stays in the store                  the safe travel format          the HTTP format
```
- **ORM never leaves the store.** Stores return frozen dataclasses.
- **Pydantic never accepts ORM.** Constructor functions take dataclasses (no
  `from_attributes=True`).
- Dataclasses carry **enums**; Pydantic maps to wire strings at the boundary.
- Cross-domain service calls pass **dataclasses**, not Pydantic.

### Transactions / sessions / connections (critical)

- **Session** = the unit-of-work object (cheap; per request via the dep, per task
  via the worker entry). **Connection** = the scarce pooled resource, held *only*
  while a transaction is open. They are different things.
- **Stores take `db: AsyncSession`, never commit, never open sessions.**
- **HTTP:** the `get_async_session` dep owns the transaction (commit on success,
  rollback on exception). **Workers:** open a session at the entry point
  (`async with session_factory() as db: async with db.begin(): …`).
- **Never hold a connection across foreign I/O.** Short transactions only; for
  vendor-interleaving flows, commit → release → call → fresh short transaction.
  This is why the **outbox** exists (commit intent in one txn, do the side effect
  in a worker).
- **No `db.commit()` outside session-management code.**

### Dependency direction

```text
api → service → store → models → SQLAlchemy        (nothing else imports SQLAlchemy)
service → integrations / domain / other domains' public services (writes) or stores (reads)
domain → pure (no FastAPI/SQLAlchemy/store/integrations/HTTP)
auth/** → importable by every layer
workers → call services, not stores; own the transaction at the entry
```

---

## 3. Core Workflows

**The request lifecycle:**
```text
request → middleware → api handler
   Depends(get_current_user)            # authn
   Depends(<domain>_user_can_<action>)  # access.py: lookup + check → resource or 403/404
   db = Depends(get_async_session)
   → service(db, …)
        domain/policy.py  → pure verdict
        domain/<concern>  → pure decisions
        db/store/**(db, …)→ SQL → frozen dataclass
        integrations/**   → external calls
   → models.py constructor (dataclass → Pydantic)
→ response   (the dep commits on success / rolls back on error)
```

**Cross-domain coordination:** *reads cross via store* (import another domain's
store to read), *writes cross via service* (call its public service function).
One owning domain per resource; never two domains writing the same ORM resource.

**Planner / executor:** a long service usually wants a **planner in `domain/`**
(returns command-shaped data) + a **thin executor in `service.py`**. Same
"decide here, execute there" split as the frontend's side-effect planner.

**Service decomposition — the five legal moves** (when `service.py` grows): (1)
internal sectioning (~700–800 lines), (2) extract pure logic to
`domain/<concern>.py`, (3) promote a subdomain (own api/service/models), (4) move
vendor specifics to `integrations/<vendor>/`, (5) add a worker entry point.
**Sibling helper files are not a move.**

**External-side-effect pattern (outbox):** a named orchestration function owns an
explicit multi-transaction sequence — write "pending" + commit → external call
(no open txn) → write result + commit — *or*, preferably, write the intent + an
outbox row and let a worker do the call.

---

## 4. Each Folder's Best Practices

### `server/<domain>/api.py`
- Transport only: route declarations, `Depends(...)` injection, response
  construction via `models.py`, request validation. Stays thin.
- **Never:** inline auth (use deps), `db/store` imports, `AsyncSession` methods,
  `async_session_factory`, SQLAlchemy, business logic, ORM imports (except `User`),
  try/except around the whole handler.

### `server/<domain>/service.py`
- Business logic, orchestration, invariants. Takes `db`, threads it to stores,
  calls integrations + `domain/`, raises domain errors.
- **Never:** open sessions, import SQLAlchemy, run `select/insert/db.execute`,
  `commit/rollback`, inline auth, or call another service's private helpers.

### `server/<domain>/models.py`
- Pydantic request/response schemas; constructor functions take **dataclasses**.
- **Never:** functions taking ORM, `ConfigDict(from_attributes=True)`, Pydantic as
  ORM substitutes, deep inheritance, ORM imports.

### `server/<domain>/domain/<concern>.py` (+ `policy.py`)
- Pure synchronous rules: validators, state machines, calculators, mappings,
  planners, frozen dataclasses. `policy.py` returns `PolicyAllowed | PolicyDenied`.
- **Never:** `async def` exports, DB/ORM/store imports, httpx/integrations,
  FastAPI, `service.py` imports, side effects, raising `HTTPException`.

### `server/<domain>/access.py`
- Resource-access route deps: look up the resource, check the user can touch it,
  return it (or raise 403/404). Read-only.
- **Never:** mutating writes, business logic, inline authz helpers (use
  `auth/authorization`).

### `server/<domain>/errors.py`
- Domain error types subclassing the shared base, with a `code`. Types only.
- **Never:** raise `HTTPException` (the global handler maps it), catch/re-wrap
  unrelated exceptions, error logic.

### `db/models/<resource>.py`
- ORM table definitions only. UUID PKs (`gen_random_uuid()`), `TIMESTAMPTZ`
  everywhere, `deleted_at` not `is_deleted`. Leaf — imports no services/stores.

### `db/store/<resource>.py`
- ALL DB access: query construction + execution. Takes `db`, returns **frozen
  dataclasses**, co-locates read-result dataclasses.
- **Never:** open sessions, commit/rollback, import services/integrations, let ORM
  escape. Flat (`cloud_workspaces.py`) or folder (`cloud_mcp/connections.py`).

### `integrations/<vendor>/**`
- Typed adapters around a vendor SDK/API: client, models, errors, concerns.
  Public via `__init__.py` (the one barrel exception).
- **Never:** import server domain code (leaf). Raw third-party calls live *only*
  here; product domains orchestrate results.

### `auth/**`
- `dependencies.py` = authn (`get_current_user` → `User`). `authorization.py` =
  shared helpers (`require_org_role`, `OwnerContext`, `PolicyVerdict`). Importable
  by every layer; cross-domain authz always comes from here, never another service.

### `worker.py` / `reconciler.py` / `scheduler.py` / `worker/`
- Non-HTTP entry points; same layer law (call services, not stores; no ORM; no
  vendor client construction). **Open the session at the entry point.** Loop bodies
  belong in `service.py`; `domain/` holds pure logic; `worker/` is promoted only
  for substantial worker-only logic (`main.py` + worker-facing `service.py`).

### `config.py` / `constants/<area>.py`
- `config.py` = env-derived runtime settings (secrets, URLs, flags). `constants/`
  = hardcoded policy (limits, timeouts, headers, sentinels). Product-policy
  literals in service/api/store files are forbidden. No `localhost` outside config.

### `middleware/**`
- Cross-cutting HTTP lifecycle only (request context, tracing, correlation ids).
  No product logic.

**Cross-cutting hygiene:** canonical files never prefixed/suffixed; no junk-drawer
modules (`helpers.py`/`utils.py`/`misc.py`); no single-file folders (except
`domain/`); a folder is all-subfolders or all-flat; never `datetime.utcnow()`
(use `datetime.now(timezone.utc)`). Size thresholds are CI-enforced
(`check_max_lines.py`); boundaries by `check_server_boundaries.py`.

---

## 5. The Runtime Worker Tier (detailed)

The runtime is **three components** in a **watchdog chain**:

```text
systemd  ──supervises──►  proliferate-supervisor  ──supervises──►  proliferate-worker  +  anyharness
 (Restart=always)              (process + update)                   (cloud comms)        (the runtime)
```

**Collapsed identity model** (decided): **one runtime = one sandbox = one Target
(1:1), ephemeral.** No slots, no `slot_generation`, no fencing. A sandbox death =
a Target death → provision a fresh Target. Pause/resume keeps the same instance.
**All product state is ephemeral** (cascades on Target death). See
`specs/tbd/runtime-worker-supervisor-design.md` for the full model + deltas.

**Worker = two polls + lifecycle:**
```text
ENROLL (once):  one-time token (env for managed / install command for ssh) → worker token
AUTH (every call): Bearer worker_token → cloud looks up the Target
TWO POLLS:
  control (DOWN)  long-poll → commands + ALL reconcile (config/exposures/revoked-jti)
  events  (UP)    tail AnyHarness → ship batches
HEARTBEAT       liveness ping; self-update check rides its response → writes supervisor mailbox
INVENTORY       one-shot at startup (capabilities → capability negotiation)
MATERIALIZATION report on command completion
```
Worker structure: `identity/` · `cloud_client/` · `anyharness_client/` ·
`control/{loop,commands,reconcile/{manager,handlers}}` · `tail/` · `lifecycle/` ·
`inventory/` · `store/`.

**Supervisor** (keep as-is): `process/` (keep children alive, restart on crash) +
`update/` (staged, SHA-verified, rollback-able, per-component) + `install/`
(layout + systemd). Self-update = stage own binary → exit → systemd relaunches.

**Self-update handoff:** worker writes an atomic, idempotent `desired-update.json`
**mailbox** (knows desired from cloud); supervisor reads it and applies (can
restart the worker, which the worker can't do to itself).

---

## 6. Cloud ↔ Worker: Up / Down (detailed)

Tiered truth: **git** owns durable code; the **sandbox** owns live work
(authoritative while alive); **cloud** owns control-plane + a replica/fan-out of
the live work. The worker is a **dispatch pump down** and a **replication +
fan-out pump up**.

### DOWN — intent (cloud → worker)

Two classes over one control long-poll:
- **Acts** (send_prompt, cancel, create_workspace) — a **command row** in
  `cloud/commands`; at-least-once + idempotent + per-session ordered. Enqueue runs
  preflight + idempotency + wake.
- **Desired-state** (auth, plugins, mcp, skills, runtime config, **exposures**,
  **revoked-jti**) — **versioned reconcile**, not commands. Each domain owns a
  revision; bumps it on change; the control long-poll signals the delta; the
  worker fetches the bundle, applies to local AnyHarness, verifies, with backoff.
  `applied >= desired` is correctness; a missed signal self-heals.

Transport: the control long-poll holds the request open (parked coroutine), woken
by a Redis **doorbell** + a per-target **RevisionMap** cursor; commands are leased
(at-least-once + slot-free fencing in the collapsed model). Cloud owns the channel
(`cloud/worker`); each config domain owns its revision + bundle; `cloud/commands`
owns acts.

### UP — truth replication (worker → cloud → clients)

```text
AnyHarness (event_sink normalizes ACP chunks → SessionEvent log: item_started→item_delta→item_completed,
            stable item_id, monotonic seq; item_completed carries FULL content)
  → worker tails by after_seq (cursor in SQLite) → ships batches
  → cloud /events/batches: exposure-gate → classify durable/live (deltas are live-only, dropped)
        → idempotent insert (seq+hash) → derive projections → (after batch) publish patches to Redis (post-commit)
        → advance the contiguous cursor (gap detection → backfill)
  → clients: SSE — Postgres snapshot + Redis patch stream (cursor-deduped, heartbeated)
```
Redis on the up-side is a **data channel** (carries the patch), with the Postgres
snapshot as recovery. Stable `item_id`/`seq` make both sinks idempotent and the
live/history read paths render identically (shared `product-domain` reducer).

Cloud owners: `cloud/events` (ingest + projection), `cloud/live` (publish→Redis +
SSE). Full contracts: `specs/tbd/cloud-worker-protocol-design.md`.

---

## 7. DB Models (detailed)

### Conventions (enforced)
- **UUID primary keys** (`gen_random_uuid()`); no integer PKs for new resources.
- **`TIMESTAMPTZ` everywhere**; never naive `TIMESTAMP`; `datetime.now(timezone.utc)`.
- **Soft delete** via `deleted_at TIMESTAMPTZ NULL`, never `is_deleted`; default to
  hard delete.
- **No lazy ORM access past the store boundary** (the reason stores return
  frozen dataclasses).
- Schema changes go through **Alembic**.

### The type pipeline (recap)
ORM (`db/models`) → frozen dataclass (store returns) → Pydantic (`models.py` ctor).
ORM stays in the store; Pydantic never sees ORM.

### Store rules
- One ORM resource per store file. Takes `db`, never commits/opens sessions,
  returns dataclasses. Flat (prefixed) or folder (un-prefixed inside).

### Key model families
- **Runtime identity** (`db/models/cloud/targets.py`): **Target** (= runtime =
  sandbox, collapsed — carries kind/ownership/provider/desired-versions + worker
  creds + liveness), **Enrollment** (one-time, hashed token, TTL, consume-once).
  In the collapsed model: `slot_generation`/supersession/active-slot-index are
  removed.
- **Commands** (`db/models/cloud/commands.py`): the imperative-act queue —
  id/kind/payload/preconditions/status/lease/result, addressed to a target.
- **Sync** (`db/models/cloud/sync.py`): the up-direction projection — event log
  (`cloud_session_events`), session state (`cloud_sessions`), transcript
  (`cloud_transcript_items`), open interactions (`cloud_pending_interactions`),
  ingest cursor (`cloud_event_ingest_state`), and the control-revision cursor
  (`worker_control` → a per-domain `RevisionMap` in the target model).
- **Exposures / claims** — what's projected/commandable + one-way ownership.
- **Workspaces, billing, orgs, agent-auth, automations** — the product domains,
  each with its own `db/models/cloud/<resource>.py` + `db/store/**`.

### Projections are CQRS-style read views
One event log → several read-optimized views, each shaped for a UI query:
`cloud_session_events` (the log, rebuildable source), `cloud_sessions` (header /
list state), `cloud_transcript_items` (the conversation, keyed by `item_id`),
`cloud_pending_interactions` (the "what's awaiting me" actionable view).

---

## The Compression

**`api` transports, `service` orchestrates, `domain` decides, `store` persists,
`integrations` reach outside; types flow ORM → dataclass → Pydantic, never
backward; transactions are short and owned at the edge (dep or worker entry), with
the outbox for external side effects.** The runtime tier is **one ephemeral Target
(= sandbox + worker creds), two polls (control down / events up), a watchdog
chain (systemd → supervisor → worker + anyharness)**, with **acts as commands and
config/exposures/revoked-jti as versioned reconcile** down, and **normalized
events → idempotent projection → SSE fan-out** up.
