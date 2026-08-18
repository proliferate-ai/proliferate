# Architecture

How the components of Proliferate fit together and why the seams sit where they
sit. This document is comprehension, not routing — [`AGENTS.md`](AGENTS.md) says
WHERE to read; this says how the pieces relate. It is deliberately starved: the
moment a sentence explains an area's internals, it belongs in that area's doc.
It changes only when a plane is added or a seam moves.

## The plane map

```
   clients                    control plane              execution plane
┌────────────┐            ┌─────────────────┐        ┌──────────────────────┐
│  Desktop   │            │                 │        │  sandbox (E2B) or    │
│  Web       │ ─────────► │     Server      │ ─────► │  personal target     │
│  Mobile    │   HTTP/SSE │   (FastAPI)     │        │ ┌──────────────────┐ │
└────────────┘            │                 │        │ │ supervisor       │ │
      │                   └─────────────────┘        │ │  ├─ worker       │ │
      │  desktop only:              │                │ │  └─ anyharness   │ │
      │  local sidecar              │                │ │     runtime      │ │
      ▼                             ▼                │ └──────────────────┘ │
┌────────────┐            ┌─────────────────┐        └──────────────────────┘
│ anyharness │            │  model gateway  │                  │
│  sidecar   │            │   (LiteLLM)     │ ◄────────────────┘
└────────────┘            └─────────────────┘   agent LLM traffic
```

- **Clients** (`apps/desktop`, `apps/web`, `apps/mobile`, shared code in
  `apps/packages/product-client`) render and interact. They are clients of the
  server's contracts and, on desktop, of a locally-spawned AnyHarness sidecar.
- **Server** (`server/`) is the hosted control plane: durable product state,
  policy, orchestration, auth, integrations, billing, background work.
- **Execution plane** runs coding-agent sessions: a supervisor process manages a
  worker and the AnyHarness runtime inside a sandbox or on a personal target.
- **AnyHarness runtime** (`anyharness/crates/anyharness*`) is the
  harness-agnostic engine: session/workspace execution, adapter and protocol
  contracts, runtime-side product domains.
- **Model gateway** (LiteLLM, `server/litellm`) sits off to the side: agent LLM
  traffic flows through it for managed credentials, metering, and provider
  routing.

## Who owns what

- **AnyHarness** owns the harness-agnostic runtime: session/workspace
  execution, adapter + protocol contracts, and the runtime-side product
  domains. Never hosted control-plane policy.
- **Server** owns the hosted control plane: durable product state, policy,
  orchestration, auth, integrations, background work — not just "crud".
- **Frontend** packages own presentation and interaction: clients of the
  server's contracts.
- **Desktop Native** (`apps/desktop/src-tauri`) owns OS integration and local
  process lifecycle: the shell, native commands, sidecar launch.
- **Supervisor** (`anyharness/crates/proliferate-supervisor`) owns process
  supervision on a target: spawn loops, install layout, update staging,
  rollback. **Worker** (`anyharness/crates/proliferate-worker`) owns the
  target's identity toward the control plane: enrollment, heartbeat, version
  observation, gateway credentials. They run in tandem but do distinct work;
  the tandem story is
  [`specs/FEATURE_DOCS/MANAGED_RUNTIME.md`](specs/FEATURE_DOCS/MANAGED_RUNTIME.md).
- **SDKs** (`anyharness/sdk*`, `cloud/sdk*`) are generated contract consumers;
  the contract owns them, not the reverse.

## The seams and why they sit there

- **Server ↔ runtime.** The server never executes agent sessions and the
  runtime never holds product policy. Everything crossing this seam is an
  explicit contract (runtime HTTP/SSE API, mailbox messages). Why: sessions
  must run identically in a cloud sandbox, on a personal target, and under the
  desktop app — a policy dependency in the runtime would fork those worlds.
- **Client ↔ server.** Clients use generated SDK contracts by default so
  three clients share one behavior surface and generation catches drift.
  Explicitly owned typed raw seams remain for boot, health, upload, telemetry,
  and deployment-capability access where SDK generation cannot own the
  lifecycle; the relevant frontend or capability owner document defines each
  exception.
- **Desktop ↔ sidecar.** The desktop shell spawns the same AnyHarness binary
  the cloud runs, and talks to it over the same API it would use remotely. Why:
  one runtime code path — desktop is a deployment mode, not a fork.
- **Supervisor ↔ worker ↔ runtime.** The supervisor is the only process
  manager; the worker is the only control-plane speaker on a target; binaries
  converge by catalog update, not by ad-hoc deploys. Why: managed targets must
  self-heal and converge without SSH-shaped operations.
- **Agent LLM traffic ↔ gateway.** Agent model calls go through the gateway
  rather than provider SDKs in the runtime. Why: managed credentials, metering
  for billing, and provider swaps must not require touching the runtime.

## Educational read order for grokking the repo

This sequence builds a mental model; it does not route changes. Start every
task at [`AGENTS.md`](AGENTS.md) and follow all source-area and cross-plane
owners selected there.

1. [`specs/server/README.md`](specs/server/README.md) — the control plane and
   the grid ownership model.
2. [`specs/anyharness/README.md`](specs/anyharness/README.md) — the runtime's
   mental model.
3. [`specs/frontend/README.md`](specs/frontend/README.md) — how the clients
   are put together.

Then the feature doc for whichever cross-plane system you are touching
([`specs/FEATURE_DOCS/`](specs/FEATURE_DOCS/)).
