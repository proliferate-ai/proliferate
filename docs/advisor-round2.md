# Phase 2 Architectural Blueprint — Advisor Round 2

> Independent technical advisor's concrete implementation plan for migrating Proliferate to a Postgres-centric modular monolith with persistent agents, outbound sandbox bridge, self-hosted OAuth, and PG-native queues.
>
> **Date**: 2026-02-23

---

## Target Architecture

### The Modular Monolith

Merge existing services into one runtime:

* **HTTP API** (oRPC + REST)
* **WebSocket hub** (interactive streaming path)
* **Webhook ingestion** (fast-ack durable inbox)
* **Job runner** (Postgres-backed worker, cron, polling)
* **OAuth + credential vault**
* **SCM provider layer**
* **Sandbox provider layer**

**Only Postgres is "always-on infra."** Everything else is code modules in the same binary.

### Target Dataflow

```
Clients (Web, Slack, Linear, GH, CLI, VSCode)
  └─> Control Plane (single deployable)
       ├─ HTTP API (sessions, repos, integrations, triggers)
       ├─ WS Hub  (session streaming + multiplayer)
       ├─ Trigger ingress (webhooks -> durable inbox)
       ├─ Job runner (PG queue: inbox processor, pollers, schedulers, ticks)
       ├─ SCM providers (GitHub/GitLab/Bitbucket)
       ├─ OAuth + Vault (encrypted tokens in PG)
       └─ Sandbox orchestration (Modal/E2B/K8s)
             ^
             | outbound WS bridge (sandbox -> control plane)
             |
        Sandbox (OpenCode + supervisor/bridge)
```

Two keystone changes that make the rest fall into place:

1. **Session = Actor** (single writer) without Redis locks
2. **Sandbox dials out** (bridge) so the control plane never reaches "into" a sandbox

---

## 1. Session State Management Without Redis: Actor + Postgres Event Log

### The Key Invariant

> For a given `sessionId`, there must be exactly one active `SessionActor` instance handling client sockets, sandbox bridge socket, the prompt/message queue, and state transitions.

Durable event storage makes crash recovery possible; routing keeps it single-writer.

### "Consistent Hashing" Routing That Works with Browsers

**Practical gotcha:** browser WebSockets can't set custom headers. "Hash by header" only works for CLI/bots.

**Pattern:** All session-affine requests include `?sid=<sessionId>`:

* WebSocket: `wss://…/ws?sid=<sessionId>`
* Internal actor calls: `POST /internal/actor/enqueue?sid=<sessionId>`

Ingress uses `sid` as the hash key (ring-hash / consistent hash).

Result: **no Redis leases**, no TTL renewal, no split-brain from event loop lag.

### Postgres Tables to Add

#### A) `session_events` (append-only)

Used for durable replay, audit, and "rebuild state after crash".

```sql
CREATE TABLE session_events (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_session_events_sid ON session_events (session_id, id);
```

Persist (day 1): user prompts, tool starts/results, sandbox lifecycle transitions, PR/branch events. Token-stream deltas are noncritical (can be batched).

#### B) `session_snapshots` (prevents replaying millions of events)

```sql
CREATE TABLE session_snapshots (
  session_id TEXT,
  last_event_id BIGINT,
  state JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (session_id, last_event_id)
);
```

Snapshot every N events or on major milestones.

#### C) `session_inbox` (durable prompt/trigger queue per session)

This is the "wake the agent at 3am" mechanic.

```sql
CREATE TABLE session_inbox (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL,          -- 'prompt', 'trigger_event', 'system'
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',  -- 'queued', 'processing', 'done', 'failed'
  dedup_key TEXT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  UNIQUE(session_id, dedup_key) WHERE dedup_key IS NOT NULL
);
```

### Actor Activation + Crash Recovery

When any of these happen (client WS connect, inbox item enqueue, scheduled tick):

1. Creates/loads `SessionActor(sid)`
2. Rehydrates from `session_snapshots` + `session_events` tail
3. Attaches any active sockets (clients, sandbox bridge)
4. Drains `session_inbox` sequentially
5. Persists critical events as it goes

If the pod crashes:

* Clients reconnect (same sid routes them back deterministically)
* Sandbox bridge reconnects
* Actor rehydrates and continues from durable inbox/events

---

## 2. Persistent Long-Running Agents: "Always Available" Without "Always Running"

### Explicit Lifecycle State Machine

```
HIBERNATED  (no sandbox, no sockets, only DB state)
     ↓ inbox item arrives
WARMING     (restoring/spawning sandbox)
     ↓ sandbox connected
READY       (sandbox connected, idle)
     ↓ processing prompt/tool
RUNNING     (processing prompt/tool)
     ↓ idle timeout
COOLING     (snapshotting, shutting down)
     ↓ snapshot complete
COLD        (snapshot exists, sandbox not running)
     ↓ inbox item arrives → WARMING
ARCHIVED    (no triggers, manual only)
```

Persist state transitions as `session_events`.

### Hibernation Policy as Pure Decision Functions

Inputs:
* last user activity time
* last trigger time
* sandbox cost tier
* snapshot available?
* queue depth (inbox length)
* org budget/quota

Decision: keep warm, snapshot + terminate, do nothing, refuse new work (budget).

These functions should be deterministic and testable.

### Waking Agents for Triggers (No User Online)

Trigger pipeline ends with:
* Insert `session_inbox` rows (deduped)
* Schedule/emit a "wake" signal

**Option A (recommended): Job queue `wake_session(sid)`**
* Enqueue a job keyed by sid (dedupe)
* Job calls the actor internal enqueue endpoint (routed by sid hashing)

**Option B: `LISTEN/NOTIFY`**
* After inserting inbox row, `NOTIFY session_inbox, '<sid>'`
* Each pod listens; only the "owner pod" for sid acts

Prefer A because it centralizes retries/backoff in the job system.

---

## 3. Sandbox Lifecycle + Orchestration: Reverse the Connection Direction

### Outbound Bridge: Control Plane Never Connects Inward

Supervisor responsibilities:
* Start OpenCode
* Open outbound WebSocket to control plane `/sandbox/connect?sid=…&sandboxId=…`
* Stream OpenCode SSE events to control plane over that socket
* Receive commands: `prompt`, `abort`, `exec`, `snapshot`, `status`
* Send heartbeats

Control plane responsibilities:
* Authenticate bridge connection (short-lived token)
* Map bridge socket to SessionActor(sid)
* Broadcast events to clients
* Persist critical events to Postgres

### Bridge Reconnection Semantics

* Supervisor reconnects with exponential backoff
* Control plane treats a new socket as a replacement for the old one
* Session actor persists `sandbox_connection_generation` (event), so clients can understand restarts

### Snapshot/Restore/Hibernate Flows

1. Actor decides to hibernate (pure decision)
2. Actor sends bridge command `snapshot` (supervisor scrubs + snapshots)
3. Actor persists snapshot ID to Postgres
4. Actor sends bridge command `shutdown`
5. Actor transitions session state to `COLD`

On wake: restore from snapshot if available; else spawn base image.

---

## 4. SCM Boundary: Remove `gh` from the Sandbox

### Boundary Rules

* Sandbox can do **local git operations** (commit, diff, run tests)
* Sandbox gets **only the minimum auth needed for pushing code** (short-lived)
* All **GitHub/GitLab API operations** happen in the control plane: create PR, comment, label, request review, merge, create issue

### Two-Step Hardening Plan

**Step 1 (fast, big win):**
* Keep `git push` in sandbox but move PR creation to control plane (no `gh pr create`)
* Push token is **repo-scoped GitHub App installation token** with minimal permissions
* PR creation uses **user OAuth** if available, else app token

**Step 2 (best security, more work):**
* Sandbox never pushes at all
* Sandbox exports patch/bundle (`git format-patch` or `git bundle`)
* Control plane applies + pushes using app token
* *No SCM tokens enter the sandbox, ever*

Step 1 already eliminates the worst vulnerability.

---

## 5. Postgres-Native Job Queue (Replace Redis/BullMQ)

### Graphile Worker

TypeScript-native queue using `SELECT ... FOR UPDATE SKIP LOCKED`.

**Transactional Outbox:**

```typescript
await db.transaction(async (tx) => {
  const run = await tx.insert(automation_runs).values(payload).returning();
  // Enqueued atomically. Guaranteed exactly-once execution.
  await tx.execute(sql`SELECT graphile_worker.add_job('execute_run', ${run.id})`);
});
```

### Replaces Current Worker Apps

Everything in `apps/worker` and `apps/trigger-service` becomes Graphile Worker tasks:

* `process_webhook_inbox`
* `process_poll_group`
* `process_scheduled_trigger`
* `dispatch_outbox`
* `refresh_oauth_token`
* `session_tick` (hibernate decisions, heartbeat checks)
* `sweep_orphans`
* `billing_enforcement`

---

## 6. Self-Hosted OAuth + Postgres Credential Vault

### Envelope Encryption

* Single master key (KEK) via env: `TOKEN_ENCRYPTION_KEY`
* Per-row DEK for token encryption
* Store: `encrypted_dek`, `iv`, `ciphertext`, `auth_tag`, `expires_at`, `scopes`, metadata JSONB
* Borrow `crypto.ts` from background-agents (AES-256-GCM)
* Extended to envelope encryption so KEKs can be rotated later

### Refresh Strategy

* **On-demand refresh with buffer**: If `expires_at < now() + 5m`, refresh synchronously and store
* **Optional background refresh**: Schedule Graphile job for high-traffic integrations

### Credential Set Sharing (from Sim)

* `credential_sets` (workspace/org scoped)
* `credential_set_members`
* `oauth_connections` belong to a credential set
* Triggers/actions choose: org integration, personal integration, or credential set (round-robin / LRU)

---

## 7. MCP Integration Without Leaking Secrets

### Control Plane as MCP Proxy

* Sandbox does **not** receive third-party OAuth tokens directly
* Agent calls platform tool: `mcp.call(connectorId, toolName, args)`
* Control plane: loads connector config + encrypted creds, calls MCP server, returns result
* **Tokens never enter the untrusted VM**

If some MCP servers must run inside sandbox: opt-in only, classified as higher risk.

---

## 8. Commit Attribution: Cryptographic Truth

1. Sandbox commits as `Proliferate Bot <bot@proliferate.dev>`
2. Control plane cryptographically signs via GitHub App API (or local GPG key)
3. Gateway appends `Co-authored-by: User Name <email>` trailers based on `session_inbox` participants

---

## 9. Session Actor Using Postgres Advisory Locks

### The "Postgres Virtual Actor" Pattern

Instead of routing network connections to the correct pod, route data through Postgres:

#### 1. Universal Funnel (`session_inbox`)

```sql
INSERT INTO session_inbox (session_id, source, payload) VALUES ($1, $2, $3);
SELECT pg_notify('session_wake', $1);
```

A CLI prompt and an automated trigger are processed identically.

#### 2. Actor Lock (Replacing Redis Leases)

```sql
SELECT pg_try_advisory_lock(hashtextextended('session_' || $1, 0));
```

* **If `false`:** Another pod is running this agent. Do nothing.
* **If `true`:** This pod becomes the Actor. Boots sandbox, drains inbox, streams execution.
* **If pod crashes:** TCP connection to Postgres drops, lock is instantly released. No TTLs, no split-brain.

#### 3. Multi-Client Streaming

When Actor generates an LLM token:
* Save to DB
* Call `pg_notify('session_stream_<sid>', chunk)`
* Any pod with a client WS for that session listens and forwards

Redis Pub/Sub eliminated.

---

## 10. Migration Plan

### Phase 1: Secure the Boundary

* Remove `GH_TOKEN` from sandbox
* Implement `SourceControlProvider` + `createPullRequest()` in control plane
* Reverse sandbox WebSocket connection to dial outward
* Implement bot authorship + co-author trailers

### Phase 2: Database Consolidation

* Install Graphile Worker
* Migrate BullMQ jobs, webhook inbox, scheduled triggers to Postgres
* Delete Redis queues

### Phase 3: The Virtual Actor

* Implement `session_inbox` + `LISTEN/NOTIFY` + `pg_try_advisory_lock`
* Decommission Redis Pub/Sub and session leases entirely

### Phase 4: Self-Hosted OAuth

* Build AES-256-GCM token storage
* Migrate off Nango
* Formalize MCP Control Plane proxy

### Phase 5: Merge Services into Single Deployable

* Gateway + trigger-service + worker become one binary
* Self-host story: Postgres + control plane + sandbox provider

---

## 11. Key Risks and Mitigations

### Ingress hashing is "hard"

* Use query param hashing (`sid`) for browser WS
* Keep it simple and explicit

### Postgres load from high-volume streaming events

* Persist critical events synchronously
* Batch token stream events (store only message deltas + final output)
* Snapshot state periodically
* Consider partitioning `session_events` by time later

### Actor activation + jobs create concurrency bugs

* `SessionActor` is the only component allowed to mutate session runtime state
* Everything else only enqueues to `session_inbox`
* One inbox drain loop per actor, sequential processing

### Token refresh quirks across providers

* Provider-specific refresh adapters for Slack/Jira/Sentry/etc
* Single "token validity" library with buffer + rotation handling
* Integration tests per provider (mock token server)

---

## Result

Proliferate drops from 5 infrastructure pieces (Web, Gateway, Workers, Trigger Service, Redis) down to **two**:

1. **Proliferate Node.js Binary** (Next.js + Express Gateway + Graphile Workers)
2. **PostgreSQL Database** (State, Queues, Pub/Sub, Encrypted Vault)
