# Proliferate — Architecture Strategic Review

> Independent technical review of Proliferate's Phase 2 architecture direction,
> informed by competitive analysis of Cursor's "AnyRun" infrastructure, Gemini
> advisor recommendations, reference architectures (background-agents, Sim), and
> real-world enterprise adoption patterns (Ramp, Stripe).
>
> **Date**: 2026-02-24
> **Reviewer**: Claude (Opus 4.6)
> **Context**: Synthesized from terminal forensics of Cursor's sandbox, the full
> Gemini advisor conversation, Proliferate's current codebase, and public
> engineering blog posts from Ramp and Stripe.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Strategic Positioning](#2-strategic-positioning)
3. [Why Enterprises Reject Cursor Cloud](#3-why-enterprises-reject-cursor-cloud)
4. [Competitive Landscape](#4-competitive-landscape)
5. [Phase 2 Architecture — What to Build](#5-phase-2-architecture--what-to-build)
6. [Phase 2 Architecture — What NOT to Build](#6-phase-2-architecture--what-not-to-build)
7. [Control Plane: The Postgres Monolith](#7-control-plane-the-postgres-monolith)
8. [Execution Plane: Sandbox Providers](#8-execution-plane-sandbox-providers)
9. [Security: Zero-Trust Tool Execution](#9-security-zero-trust-tool-execution)
10. [Sandbox Architecture: The "Fat Sandbox"](#10-sandbox-architecture-the-fat-sandbox)
11. [Long-Running Agents & Hibernation](#11-long-running-agents--hibernation)
12. [Omni-Channel Clients](#12-omni-channel-clients)
13. [Self-Hosting Deployment Model](#13-self-hosting-deployment-model)
14. [Migration Sequence](#14-migration-sequence)
15. [Appendix: Gemini Recommendations — Agreement & Disagreement](#15-appendix-gemini-recommendations--agreement--disagreement)

---

## 1. Executive Summary

Proliferate is an open-source, self-hostable platform where AI coding agents run
in cloud sandboxes to do real software engineering work. The Phase 2 architecture
aims to transform the system from an ephemeral, microservice-heavy stack
(Node + Redis + BullMQ + Nango + inbound SSE) into a **Postgres-centric modular
monolith** (Node + Postgres + outbound WebSocket).

### The Core Thesis

Cursor is the "Apple" of AI coding — beautiful, closed, proprietary. Proliferate
must be the "Red Hat" — open, infrastructural, enterprise-sovereign, portable.

Cursor built a custom multi-node container orchestration platform ("AnyRun") in
Rust because they're optimizing marginal cost across millions of consumer users.
**Proliferate should not replicate this.** Instead, Proliferate should deliver the
same agent capabilities using standard infrastructure primitives (Kubernetes,
Docker, Postgres) that enterprises already operate.

### Key Architectural Decisions

| Decision | Rationale |
|---|---|
| **Don't build AnyRun** | Enterprises won't deploy a custom Rust hypervisor; they'll deploy a Helm chart |
| **Kill Redis** | Postgres advisory locks + LISTEN/NOTIFY replace session leases and pub/sub |
| **Kill BullMQ** | Graphile Worker (Postgres-native) enables transactional outbox pattern |
| **Kill Nango** | Self-hosted OAuth with AES-256-GCM encryption for 5 core integrations |
| **Reverse sandbox network** | Sandbox dials OUT to control plane (not inbound SSE) |
| **Remove GH_TOKEN from sandbox** | SourceControlProvider in control plane; sandbox gets repo-scoped deploy tokens only |
| **Keep Redis/BullMQ migration conservative** | Don't rush the Postgres migration — ship K8s provider and self-hosted OAuth first |

---

## 2. Strategic Positioning

### "The Team-Native Daemon" vs "The IDE Sidekick"

| Dimension | Cursor (Consumer IDE) | Proliferate (Enterprise Daemon) |
|---|---|---|
| **Identity** | Iron Man suit for one developer | Autonomous colleague for the whole team |
| **Surface** | IDE-locked (VS Code fork) | Omni-channel: Slack, GitHub, Linear, CLI, Web, Desktop |
| **Compute** | Walled garden (Cursor's AWS) | BYOC: Modal, E2B, K8s, local Docker |
| **Data privacy** | "Trust us" | Air-gappable, behind your firewall |
| **Workflow** | Ephemeral tasks from human typing | 24/7 daemons triggered by webhooks at 3am |
| **Extensibility** | Closed agent toolset + MCP in sandbox | MCP proxy in control plane (zero-trust) |
| **Persistence** | Session-scoped | Persistent agents with hibernation |

### The Real Moat

The Gemini conversation correctly identifies the "enterprise daemon" positioning
but **underweights the actual moat**: Proliferate is the only product that offers
fully open-source, self-hostable autonomous coding agents. No competitor offers
this. Cursor is closed-source SaaS. Factory is closed. Devin is closed. The
ability for an enterprise to `helm install proliferate` and run the entire stack
in their own VPC — including sandboxes — is a category of one.

---

## 3. Why Enterprises Reject Cursor Cloud

Based on analysis of Cursor's newest capabilities (Cloud Agents with Computer
Use, MCP support, full VMs) and real-world adoption patterns:

### The Custom Environment Veto (The Stripe Problem)

Stripe spent 6 months building "Minions" in-house because their codebase requires
proprietary Bazel build systems, internal IAM proxies, and custom testing
harnesses. Cursor's generic Ubuntu VM can't accommodate this. Their docs even note
that Computer Use is not supported for repos with custom Dockerfiles or snapshots
via `environment.json` — forcing a choice between custom environments and their
flagship feature.

**Proliferate's answer**: Bring Your Own Image (BYOI) + DevContainer support. The
agent boots inside the customer's existing dev environment image. No adaptation
required.

### The VPC / Network Veto (The Ramp Problem)

Agents need to access internal staging databases, authenticated package
registries, and internal APIs. Cursor Cloud runs in Cursor's AWS — it can't reach
`db.staging.internal.company.vpc`. Exposing internal endpoints to the public
internet is a SOC2/PCI-DSS violation.

**Interesting nuance**: Ramp was okay using Modal for compute but built their own
control plane. This proves that enterprises distinguish between "dumb compute"
(Modal provides raw microVMs) and "black-box SaaS" (Cursor controls the brain,
the secrets, and the network). Ramp kept the brain internal and used Modal as
disposable muscle.

**Proliferate's answer**: Self-hosted control plane holds all secrets and
credentials. Sandbox compute is pluggable (Modal, K8s, Docker).

### The Code Storage Veto (The Harvey/Brex Problem)

Cursor explicitly states: "Cloud Agents are the only feature that requires Cursor
to store code... encrypted copies of repositories stored temporarily." For
financial and legal companies, sending proprietary code to a third-party startup
for autonomous execution is a compliance violation.

**Proliferate's answer**: Code never leaves the customer's network. Sandboxes run
in their VPC.

---

## 4. Competitive Landscape

### What Cursor Built (AnyRun)

*Full analysis: `docs/cursor-infrastructure-analysis.md`*

Cursor built a custom container orchestration platform in Rust with:
- `/pod-daemon`: Rust init process (PID 1) with gRPC process management
- `/exec-daemon`: Node.js IDE bridge with pty, ripgrep, GitHub CLI
- Event-sourced process streaming with 10,000-event replay buffer
- Checkpoint/snapshot system for pause/resume across nodes
- Multi-node scheduling with heartbeat-based health
- Full desktop stack (VNC + XFCE + Chrome + Playwright)
- Docker-in-Docker via fuse-overlayfs

**Why they built it**: Scale economics (millions of users), sub-second process
attachment for interactive IDE sessions, and checkpoint/restore as a core UX
primitive.

**Why we don't replicate it**: Enterprises won't deploy a custom Rust hypervisor.
They want a Helm chart that drops into their existing K8s cluster. Proliferate's
agents are asynchronous background jobs — we don't need 50ms attach latency.

### What Ramp Built

Ramp built their own control plane (webhooks, LLM orchestration, GitHub
integration) and used Modal as dumb compute. Key insight: they separated the
brain (internal) from the muscle (Modal). This validates Proliferate's
architecture exactly — self-hosted control plane + pluggable sandbox providers.

### What Stripe Built (Minions)

Stripe built fully in-house because their dev environment is too specialized for
any generic sandbox. Key insight: the agent must boot inside the customer's exact
dev toolchain. This validates BYOI (Bring Your Own Image) and DevContainer
support as critical features.

### background-agents (Open-Inspect)

Cloudflare Workers + Durable Objects + D1 + Modal. Architecturally elegant
(zero-idle-cost, automatic persistence) but completely locked to Cloudflare.
Cannot be self-hosted. Useful as a reference for patterns, not platform.

**What to steal**: Pure-function decision logic (lifecycle/decisions.ts),
outbound sandbox WebSocket topology, SourceControlProvider interface, DI-based
testing patterns, transient/permanent error classification.

### Sim (sim.so)

Next.js + Postgres. No Redis, no workers, no queue system. 30+ self-hosted OAuth
providers. Useful as a reference for OAuth self-hosting patterns.

**What to steal**: genericOAuth provider config pattern, credential set sharing
schema. **What NOT to steal**: plaintext token storage, synchronous webhook
processing, DAG execution model.

---

## 5. Phase 2 Architecture — What to Build

### The 3-Tier Model

```
[ TIER 0: CLIENTS ]
  Web App  |  Slack/GitHub/Linear Bots  |  CLI  |  Mac Desktop App  |  Webhooks
                              |
                    (HTTP / WebSocket / oRPC)
                              |
[ TIER 1: CONTROL PLANE — The Postgres Monolith ]
  ┌──────────────────────────────────────────────────────────────────────┐
  │  Proliferate Node.js Binary (Self-Hostable)                          │
  │   ├── Next.js Web / API         ├── Graphile Worker (Jobs)           │
  │   ├── Virtual Actor Engine      ├── MCP Tool Proxy + Permissions     │
  │   └── Outbound WS Gateway       └── SCM API Provider (GitHub/GitLab) │
  └──────────────────────────────────────────────────────────────────────┘
                              |
  ┌──────────────────────────────────────────────────────────────────────┐
  │  PostgreSQL (Single Source of Truth)                                  │
  │   ├── session_inbox (macro events)     ├── AES-256-GCM token vault   │
  │   ├── session_events (event sourcing)  └── RBAC + approval policies  │
  │   └── graphile_worker (queues)                                       │
  └──────────────────────────────────────────────────────────────────────┘
                              |
          (Outbound WebSocket Bridge from sandbox)
                              |
[ TIER 2: EXECUTION PLANE — Untrusted Muscle ]
  ┌──────────────────────────────────────────────────────────────────────┐
  │  SandboxProvider Interface (BYOC)                                    │
  │                                                                      │
  │  [SaaS Tier]                    [Enterprise/OSS Tier]                │
  │   Modal / E2B                    Kubernetes / Local Docker           │
  │         |                                |                           │
  │         v                                v                           │
  │  ┌──────────────────────────────────────────────────────────────┐    │
  │  │ "Fat Sandbox" OR Customer's DevContainer                     │    │
  │  │  ├── /supervisor (dials OUT to control plane WS)             │    │
  │  │  ├── OpenCode Agent (SSE)                                    │    │
  │  │  └── DinD (fuse-overlayfs), Playwright, X11                  │    │
  │  └──────────────────────────────────────────────────────────────┘    │
  │  + Persistent Volume (EBS / PVC / local mount for hibernation)       │
  └──────────────────────────────────────────────────────────────────────┘
```

---

## 6. Phase 2 Architecture — What NOT to Build

| Don't Build | Why |
|---|---|
| Custom multi-node scheduler | K8s already does this; enterprises won't adopt a novel orchestrator |
| Custom Rust init daemon | Standard Docker entrypoint + Node.js supervisor is sufficient |
| Custom checkpoint/restore pipeline | K8s PVCs for workspace persistence; Modal snapshots for SaaS tier |
| Durable Objects | Cloudflare lock-in contradicts self-hosting goal |
| AnyRun replica | 90% of the effort for 10% of the value |
| pg_notify for LLM token streaming | Postgres is not a high-throughput pub/sub broker; use in-memory streaming on the pod holding the advisory lock |

---

## 7. Control Plane: The Postgres Monolith

### 7.1 The Virtual Actor Engine

The session's "soul" lives in Postgres. The sandbox is disposable muscle.

**The Universal Inbox** (`session_inbox`):
Whether a user types in the web UI, a Sentry webhook fires at 3am, or a Slack
message arrives — the receiving HTTP handler simply INSERTs into `session_inbox`
and calls `pg_notify('session_wake', sessionId)`.

```sql
INSERT INTO session_inbox (session_id, source, payload)
VALUES ($1, $2, $3);
SELECT pg_notify('session_wake', $1);
```

This completely decouples client surfaces from agent execution.

**The Actor Lock** (replacing Redis leases):
When a node hears the `session_wake` notification, it attempts:

```sql
SELECT pg_try_advisory_lock(hashtextextended('session_' || $1, 0));
```

- `false`: Another pod is running this session. The active pod will consume the
  inbox.
- `true`: This pod becomes the Actor. It boots the sandbox (if hibernated),
  drains `session_inbox`, and streams execution.

If the pod crashes, the TCP connection to Postgres drops, and the lock is
**instantly and safely released**. No TTLs. No split-brain. No Redis.

**Multi-client streaming**:
LLM token streaming stays **in-memory** on the pod holding the advisory lock.
That pod forwards tokens to connected WebSocket clients directly. If a user is
connected to a different pod (e.g., via a load balancer), route their WebSocket
to the correct pod via consistent hashing at the ingress layer (hash on
`sessionId`).

**Important**: Do NOT use `pg_notify` for high-frequency token streaming. Postgres
is not a pub/sub broker for character-by-character output. `pg_notify` is only
for macro-events (wake signals, status changes). The rule from CLAUDE.md applies:
"DB stores metadata and billing, not real-time message content."

**Session event persistence** (`session_events`):
The Actor writes completed messages, tool calls, and terminal output chunks to
`session_events` in Postgres. This enables:
- Replay when a user opens the web UI days later
- Hibernation recovery (inject event history into LLM context on wake)
- Audit trail for enterprise compliance

This is analogous to Cursor's `last_event_id` replay buffer, but durable (lives
in Postgres, not in-memory).

### 7.2 Transactional Outbox (Graphile Worker)

Replace BullMQ + Redis with Graphile Worker (Postgres-native queue using
`SELECT ... FOR UPDATE SKIP LOCKED`).

The killer feature is the **transactional outbox** — mutate state and enqueue a
job in the same ACID transaction:

```typescript
await db.transaction(async (tx) => {
  const run = await tx.insert(automation_runs).values(payload).returning();
  await tx.execute(
    sql`SELECT graphile_worker.add_job('execute_run', ${JSON.stringify({ id: run.id })})`
  );
});
```

This eliminates the dual-write problem (save to Postgres, enqueue to Redis — if
Redis fails, the trigger is lost forever).

**Cron replacement**: Graphile supports scheduled jobs. Polling groups become
recurring Graphile jobs. OAuth token refresh becomes
`add_job('refresh_token', payload, { run_at: NOW() + interval '55 minutes' })`.

### 7.3 Important Caveat: Don't Rush the Redis Migration

The Postgres Virtual Actor pattern is architecturally sound but represents a big
migration. BullMQ + Redis is battle-tested and already working. The real win for
self-hosting is eliminating *exotic* dependencies (Modal, Nango, ElastiCache),
not swapping one mainstream dependency (Redis) for a novel pattern.

**Recommended sequence**:
1. Ship K8s/Docker provider and self-hosted OAuth first (unlocks self-hosting)
2. Migrate to Graphile Worker when Redis becomes an operational burden
3. Implement the Virtual Actor incrementally, not as a big-bang rewrite

### 7.4 Self-Hosted OAuth (Killing Nango)

Port Sim's `genericOAuth` pattern using better-auth (already in the stack) for
the 5 core integrations (GitHub, Slack, Linear, Sentry, Jira).

**Token storage**: AES-256-GCM envelope encryption (borrow `crypto.ts` from
background-agents). Require `PROLIFERATE_MASTER_KEY` env var.

**Token refresh**: Proactive refresh via Graphile scheduled jobs (refresh 5
minutes before expiry).

**Credential sharing**: Org-scoped integration tokens (existing model). Add
credential set sharing for teams (borrow schema from Sim).

**Long-tail integrations**: Via MCP connector catalog (existing
`org_connectors` table). The platform doesn't need to support 30+ OAuth
providers — it needs 5 core ones and an MCP extensibility mechanism for
everything else.

### 7.5 Drizzle + Raw SQL Boundary

The Virtual Actor relies on Postgres-specific primitives (`pg_try_advisory_lock`,
`pg_notify`, `LISTEN`). Per CLAUDE.md: "Drizzle only; no raw SQL unless
absolutely necessary."

These qualify as "absolutely necessary." Encapsulate all raw SQL in
`packages/services/src/sessions/db.ts` using Drizzle's `` sql` `` template
literal. Never leak raw SQL into SessionHub/Actor logic.

---

## 8. Execution Plane: Sandbox Providers

### 8.1 The Provider Menu (BYOC)

The existing `SandboxProvider` interface is ~90% ready. Four providers:

| Provider | Target User | Boot Time | Cost |
|---|---|---|---|
| `docker.ts` | OSS self-hosters, local dev | ~5-10s | Free (own hardware) |
| `kubernetes.ts` | Enterprise self-hosters | ~3-8s (warm pool: ~200ms) | Own K8s cluster |
| `modal.ts` | SaaS cloud tier | ~2-5s (snapshot: ~500ms) | Modal pricing |
| `e2b.ts` | SaaS cloud tier | ~2-5s | E2B pricing |

### 8.2 Docker Provider (The Open Source Default)

~500-1000 lines of TypeScript. Calls `docker run`, `docker exec`, `docker stop`
via the Docker API. Anyone can `docker compose up` and have the full stack.

This is the **highest ROI item in the entire roadmap**. It makes "fully
self-hostable" a reality instead of marketing.

### 8.3 Kubernetes Provider (Enterprise Scale)

Uses `@kubernetes/client-node` to create sandbox Pods in the customer's existing
cluster. K8s handles:
- Node placement and bin-packing
- Network policies (egress restriction)
- Persistent volumes (workspace persistence across hibernation)
- Resource quotas per namespace/org

**Warm pool pattern**: Keep N generic sandbox Pods running. When a task arrives,
claim a warm pod (~50ms) and inject repo context over WebSocket. Achieves
sub-second boot without custom checkpoint/restore.

**Persistent volumes**: Map `/workspace` to a K8s PVC backed by EBS/GCE-PD. On
pause, the Pod is deleted but the volume remains. On wake, a new Pod mounts the
same volume. This replaces Cursor's custom tarball snapshot pipeline with standard
K8s primitives.

### 8.4 Modal/E2B Providers (Already Exist)

Keep existing providers. They serve the SaaS cloud tier where self-hosting isn't
required. Modal's memory snapshots give the fastest resume (~500ms).

### 8.5 Bring Your Own Image (BYOI)

To solve the Stripe problem: don't force customers into a generic Ubuntu VM.

1. Parse the repo's `.devcontainer/devcontainer.json`
2. Instruct K8s/Docker to boot the customer's existing dev image
3. Mount the Proliferate supervisor binary into the container at boot
4. Agent boots inside the customer's exact environment (Bazel, custom linters,
   internal SSL certs already configured)

### 8.6 Provider Interface Changes

```typescript
interface CreateSandboxOpts {
  // ... existing fields ...

  /** URL the sandbox bridge should connect to (outbound WS) */
  controlPlaneWsUrl?: string;
  /** Short-lived token for bridge authentication */
  bridgeToken?: string;
  /** Custom base image (BYOI) */
  customImage?: string;
  /** DevContainer config path */
  devcontainerPath?: string;
}
```

The `tunnelUrl` return value becomes less critical — only needed for preview URLs,
not for the agent communication path (which now goes over the outbound bridge).

---

## 9. Security: Zero-Trust Tool Execution

### 9.1 The Problem

Cursor injects raw secrets (`GH_TOKEN`, `ANTHROPIC_API_KEY`, `SLACK_BOT_TOKEN`,
database URLs) directly into sandbox environment variables. Every process in the
container — including LLM-controlled code — can read them. This is a severe
prompt injection vulnerability.

We observed this firsthand: the Cursor sandbox dumped every one of Proliferate's
dev secrets into the terminal output.

### 9.2 The MCP Proxy Pattern

The sandbox is treated as **fully untrusted**. High-privilege tokens never enter
the container.

```
Agent (in sandbox) ──tool_call──> Outbound WS ──> Control Plane
                                                        |
                                                   Decrypt token from Postgres
                                                        |
                                                   Execute API call
                                                        |
                                                   Return result
                                                        |
Agent (in sandbox) <──result──────────────────────────────
```

The Control Plane acts as an MCP proxy:
1. Agent emits `tool_call` (e.g., "create Jira ticket") over the outbound
   WebSocket
2. Control Plane intercepts, decrypts the org's Jira OAuth token from Postgres
3. Executes the API call server-side
4. Returns the JSON result to the sandbox

Tokens never enter the untrusted VM.

### 9.3 SourceControlProvider (Remove gh from Sandbox)

Move all GitHub/GitLab API operations to the control plane. Sandbox gets only
short-lived, repo-scoped deployment tokens for `git push/pull`.

```
Today:  Sandbox has GH_TOKEN → runs `gh pr create` inside sandbox
Target: Sandbox has deploy token → pushes code → Control Plane creates PR via API
```

Port the `SourceControlProvider` interface from background-agents. This also
enables GitLab/Bitbucket support via the same abstraction.

### 9.4 Action Permissioning

Because the Control Plane proxies all tools, it's a natural bottleneck for
permissions:

| Tier | Examples | Behavior |
|---|---|---|
| **Read** | `github.read_issue`, `jira.get_ticket` | Auto-approved |
| **Safe write** | `github.create_draft_pr`, `linear.update_status` | Auto-approved, audit logged |
| **Danger** | `aws.deploy`, `github.merge_pr`, `db.drop_table` | Suspend actor, push approval request to Slack/Web/Desktop |

On danger actions, the Actor hibernates. When the human clicks "Approve" (via
Slack, web UI, or desktop app), the approval is INSERTed into `session_inbox` and
the Actor wakes to continue.

### 9.5 Bot Commit Attribution

Stop spoofing user git identities in the sandbox.

- Agent commits as `Proliferate Bot <bot@proliferate.dev>`
- Control Plane signs commits via GitHub App API (or local GPG key)
- `Co-authored-by: User Name <email>` trailers appended based on
  `session_inbox` participant log
- Satisfies enterprise compliance by delineating AI generation from human
  authorization

---

## 10. Sandbox Architecture: The "Fat Sandbox"

Cursor ships a massive sandbox with VNC, XFCE, Chrome, Playwright,
Docker-in-Docker. This is correct — LLM agents increasingly need "Computer Use"
capabilities.

### 10.1 Default Image: `proliferate/sandbox-base:latest`

The base sandbox image should include:

| Component | Purpose |
|---|---|
| **OpenCode** | The coding agent |
| **Supervisor** | PID 1, dials outbound WS to control plane |
| **Docker-in-Docker** | `fuse-overlayfs` storage driver for `docker compose` inside sandbox |
| **Chrome + Playwright** | Browser automation ("Computer Use") |
| **X11 + websockify** | Headless display + WebSocket bridge for "Watch the agent" UI |
| **ripgrep** | Fast code search |
| **Standard dev tools** | git, Node.js, Python, Go (configurable) |

### 10.2 Lean vs Fat

The fat image adds ~2GB and slows boot. Offer two variants:

- `proliferate/sandbox-lean:latest` — OpenCode + supervisor + git + rg. Fast
  boot for coding-only tasks.
- `proliferate/sandbox-full:latest` — Lean + DinD + Chrome + Playwright + X11.
  For computer use and docker-compose workflows.

Let users configure which image to use per repo/configuration.

### 10.3 The fuse-overlayfs Pattern

Cursor proved that `fuse-overlayfs` is the reliable way to run Docker-in-Docker
inside a container. Adopt this:

```dockerfile
RUN apt-get install -y fuse-overlayfs
RUN update-alternatives --set iptables /usr/sbin/iptables-legacy
RUN update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy
# Configure Docker to use fuse-overlayfs
RUN mkdir -p /etc/docker && \
    echo '{"storage-driver": "fuse-overlayfs"}' > /etc/docker/daemon.json
```

### 10.4 The Outbound Bridge (Supervisor)

The sandbox runs a lightweight Node.js supervisor as PID 1 (or as the
entrypoint). On boot:

1. Reads `CONTROL_PLANE_WS_URL` and `BRIDGE_TOKEN` from env
2. Opens outbound WebSocket to `wss://gateway/sandbox/connect?sid=...`
3. Authenticates with short-lived `BRIDGE_TOKEN`
4. Streams OpenCode SSE events over the bridge to the Gateway
5. Receives commands (prompt, stop, snapshot) from the Gateway

The sandbox **never exposes inbound ports** for the agent communication path.
Preview URLs (for web apps the agent builds) are the only ports exposed, via
standard port forwarding.

---

## 11. Long-Running Agents & Hibernation

### 11.1 The Lifecycle State Machine

```
COLD ──(wake)──> WARMING ──(bridge connected)──> READY ──(prompt)──> RUNNING
  ^                                                                      |
  |                                                                      |
  +──────────────────(idle timeout)──── COOLING ──(snapshot)──── COLD ───+
  |
  +──(snapshot expired / manual delete)──> HIBERNATED ──(wake)──> WARMING
```

### 11.2 Hibernation by Provider

| Provider | Hibernate Strategy | Wake Strategy | Resume Time |
|---|---|---|---|
| **Modal** | Memory snapshot (7-day TTL) or filesystem snapshot | Restore from snapshot | ~500ms (memory) / ~5s (fs) |
| **E2B** | Native pause | `Sandbox.connect(id)` | ~2s |
| **Kubernetes** | Delete Pod, keep PVC | New Pod, mount PVC | ~5-10s |
| **Docker** | `docker stop`, keep volume | `docker start` | ~3s |

### 11.3 The Actor's Decision Function

```typescript
function decideSnapshotStrategy(ctx: HibernationContext): SnapshotStrategy {
  if (provider.supportsMemorySnapshot && ctx.expectedWakeWithin < 7_DAYS) {
    return "memory_snapshot"; // Fast wake, 7-day TTL
  }
  if (provider.supportsPause) {
    return "pause"; // E2B native pause
  }
  if (provider.supportsPersistentVolume) {
    return "pvc_persist"; // K8s/Docker: keep workspace volume
  }
  return "filesystem_snapshot"; // Slowest wake, but durable
}
```

### 11.4 Context Rehydration

When an agent wakes from hibernation, the Actor:
1. Loads `session_events` from Postgres (the durable event log)
2. Injects the historical message array into the LLM's context window
3. The agent "remembers" what it was doing

This is more robust than Cursor's in-memory ring buffer — if Cursor's node dies
before snapshotting, the replay history is lost. Proliferate's history lives in
Postgres forever.

---

## 12. Omni-Channel Clients

Because the agent is a persistent daemon tied to `session_inbox`, it's completely
decoupled from any UI.

### 12.1 Web App (Existing)

Next.js + TanStack Query + WebSocket streaming. No changes needed — continues to
work via `session_inbox` + WebSocket to Gateway.

### 12.2 Slack / GitHub / Linear Bots (Existing)

Drop payloads into `session_inbox`. The agent wakes, does work, replies
asynchronously via the notification system.

### 12.3 CLI (Existing)

Device auth + WebSocket. Same `session_inbox` pattern.

### 12.4 Mac Desktop App (Future)

Built with Tauri (preferred for lightweight native apps), communicating with the
Gateway via WebSocket.

**Key features**:
- Persistent menu-bar presence (agent status, active sessions)
- Cmd+K spotlight interface for quick commands
- Rich native push notifications for permission requests ("Agent wants to merge
  PR — [View Diff] [Approve]")
- Seamless disconnect/reconnect (start task at office, close laptop, open at
  home — agent kept running, desktop app replays from `session_events`)

**Future**: Local execution mode. The desktop app bundles the control plane binary
and points execution at local Docker Desktop. Fully offline AI teammate that can
switch to cloud control plane for large workflows.

---

## 13. Self-Hosting Deployment Model

### 13.1 The Target

```
Self-hoster runs:
  1. PostgreSQL (RDS, or docker-compose)
  2. docker run proliferate/server:latest  (single binary)
  3. SANDBOX_PROVIDER=docker (or kubernetes)

That's it. No Redis. No Nango. No Modal account required.
```

### 13.2 Deployment Tiers

| Tier | Target | Stack | Setup Time |
|---|---|---|---|
| **Local dev** | Individual developer | `docker compose up` (Postgres + Proliferate + sandbox) | 5 minutes |
| **Small team** | Startup (5-50 devs) | Single VM, Docker provider | 15 minutes |
| **Enterprise** | Large org (50+ devs) | Helm chart on existing K8s, K8s sandbox provider | 1-2 hours |
| **Cloud SaaS** | Teams that don't want to self-host | Proliferate-managed, Modal/E2B | 2 minutes (sign up) |

### 13.3 What the Helm Chart Deploys

```yaml
# charts/proliferate/
├── Deployment: proliferate-server    # The Node.js binary
├── Service: proliferate-gateway      # WebSocket + HTTP
├── Secret: proliferate-config        # PROLIFERATE_MASTER_KEY, OAuth secrets
├── ServiceAccount: sandbox-creator   # RBAC for creating sandbox Pods
├── NetworkPolicy: sandbox-egress     # Restrict sandbox outbound traffic
└── (Optional) PersistentVolumeClaim  # If using PVC-based hibernation
```

The customer's existing PostgreSQL (RDS, Cloud SQL, self-hosted) is configured
via `DATABASE_URL`.

---

## 14. Migration Sequence

### Phase 1: Secure the Boundary (Highest priority)

1. **Remove `GH_TOKEN` from sandbox.** Implement `SourceControlProvider` in the
   control plane. Sandbox gets only repo-scoped deploy tokens.
2. **Reverse sandbox WebSocket direction.** Sandbox dials out to Gateway, not the
   other way around. Eliminates sandbox port exposure.
3. **Bot commit attribution.** Commit as Proliferate Bot with `Co-authored-by`
   trailers.

### Phase 2: Self-Hosting Unlock

4. **Build Docker sandbox provider.** ~500-1000 lines. Makes `docker compose up`
   fully functional with no external dependencies.
5. **Self-hosted OAuth.** Drop Nango. AES-256-GCM encrypted tokens in Postgres
   for 5 core integrations. Use `genericOAuth` via better-auth.
6. **Build Kubernetes sandbox provider.** Standard `@kubernetes/client-node`.
   Warm pool pattern for fast boot. PVC-based workspace persistence.

### Phase 3: Database Consolidation

7. **Install Graphile Worker.** Migrate BullMQ jobs one at a time (start with
   webhook inbox, then automations, then snapshots). Keep Redis running during
   migration.
8. **Migrate session leases.** Replace Redis advisory locks with Postgres
   `pg_try_advisory_lock`. Eliminate Redis pub/sub with Postgres
   `LISTEN/NOTIFY` (for macro-events only).
9. **Decommission Redis** when all queues and leases are migrated.

### Phase 4: Advanced Features

10. **Fat sandbox image.** DinD + Chrome + Playwright + X11 + websockify.
11. **BYOI + DevContainer support.** Parse `devcontainer.json`, boot customer
    images.
12. **Mac desktop app.** Tauri-based, WebSocket to Gateway.
13. **Action permissioning engine.** Read/write/danger tiers with Slack/web
    approval flow.

---

## 15. Appendix: Gemini Recommendations — Agreement & Disagreement

The Gemini advisor conversation produced excellent strategic analysis. Here's
where this review agrees and diverges:

### Strong Agreement

| Recommendation | Status |
|---|---|
| "Enterprise daemon" vs "IDE sidekick" positioning | Core thesis of this doc |
| Don't build AnyRun | Fundamental architectural decision |
| K8s provider for self-hosting | Phase 2 priority |
| Self-hosted OAuth replacing Nango | Phase 2 priority |
| SourceControlProvider (remove GH_TOKEN from sandbox) | Phase 1 critical security fix |
| Outbound sandbox WebSocket bridge | Phase 1 critical architecture fix |
| Bot commit attribution with Co-authored-by | Phase 1 |
| Transactional outbox via Graphile Worker | Phase 3 |
| Fat sandbox (DinD, Chrome, Playwright) | Phase 4 |
| MCP proxy in control plane | Core security model |

### Pushback / Nuance

| Recommendation | This Review's Position |
|---|---|
| **Postgres Virtual Actor (advisory locks, session_inbox, pg_notify)** | Architecturally sound but over-engineered for where the project is today. BullMQ + Redis works. Don't rewrite the session state layer until K8s provider and self-hosted OAuth are shipped. Migrate incrementally. |
| **pg_notify for LLM token streaming** | **Reject.** Postgres is not a high-frequency pub/sub broker. Violates CLAUDE.md rule: "DB stores metadata, not real-time content." Use consistent hashing at ingress to route WebSockets to the pod holding the advisory lock. Keep streaming in-memory. |
| **Outbound WS bridge changes trust model** | Correct recommendation, but Gemini glosses over the security implication. A compromised sandbox can now initiate connections to the control plane. Requires mTLS or short-lived bridge tokens. Not free. |
| **Fat sandbox is the default** | Premature. The full desktop stack adds ~2GB and slows boot. Offer lean and full variants. Let users opt into the fat image per repo/config. |
| **Strategic comparison underweights open-source moat** | Gemini frames differentiation as "enterprise daemon features." The real moat is being the only fully open-source, self-hostable product. No competitor offers `helm install` for autonomous coding agents. Lean into this harder. |
| **"Postgres-only, single-binary" as near-term target** | Aspirational, not immediate. Ship the Docker/K8s providers and self-hosted OAuth first (these unlock self-hosting). The Postgres monolith migration (killing Redis) is important but not blocking. |

---

*This document should be updated as architectural decisions are made and
validated. It is a strategic review, not a spec — implementation details belong
in `docs/specs/`.*
