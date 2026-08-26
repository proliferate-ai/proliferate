# Architecture

How the components of Proliferate fit together and why the seams sit where they
sit. This document is comprehension, not routing — [`AGENTS.md`](../AGENTS.md) says
WHERE to read; this says how the pieces relate. It is deliberately starved: the
moment a sentence explains an area's internals, it belongs in that area's doc.
It changes only when a plane is added or a seam moves.

## The plane map

```
   clients                    control plane              execution plane
┌────────────┐            ┌─────────────────┐        ┌──────────────────────┐
│  Desktop   │            │                 │        │  cloud sandbox (E2B) │
│  Web       │ ─────────► │     Server      │ ─────► │ ┌──────────────────┐ │
│  Mobile    │   HTTP/SSE │   (FastAPI)     │        │ │ supervisor       │ │
└────────────┘            │                 │        │ │  ├─ worker       │ │
      │                   └─────────────────┘        │ │  └─ anyharness   │ │
      │  desktop only:              │                │ │     runtime      │ │
      │  local sidecar              │                │ └──────────────────┘ │
      ▼                             ▼                └──────────────────────┘
┌────────────┐            ┌─────────────────┐                  │
│ anyharness │            │  model gateway  │                  │
│  sidecar   │            │   (LiteLLM)     │ ◄────────────────┘
└────────────┘            └─────────────────┘   agent LLM traffic
```

- **Clients** (`apps/desktop`, `apps/web`, `apps/mobile`, shared code in
  `apps/packages/product-client`) render and interact. They are clients of the
  server's contracts and, on desktop, of a locally-spawned AnyHarness sidecar.
- **Server** (`server/`) is the hosted control plane: durable product state,
  policy, orchestration, auth, integrations, billing, background work. It
  governs; it never executes an agent session.
- **Execution plane** runs coding-agent sessions: one execution bundle — a
  supervisor managing a worker and the AnyHarness runtime — inside a cloud
  sandbox. The desktop app runs the same runtime binary as a local sidecar;
  desktop is a deployment mode, not a fork.
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
  [`specs/systems/harnesses/managed-runtime.md`](systems/harnesses/managed-runtime.md).
- **SDKs** (`anyharness/sdk*`, `cloud/sdk*`) are generated contract consumers;
  the contract owns them, not the reverse.

Behavior is owned by **system specs**, one per system, each with a checked
code map: every source file belongs to exactly one spec. The index is
[`specs/README.md`](README.md#system-index).

## The seams and why they sit there

- **Server ↔ runtime.** The server never executes agent sessions and the
  runtime never holds product policy. Everything crossing this seam is an
  explicit contract — worker enrollment and heartbeat today, courier and event
  shipping as the target — owned by
  [`specs/systems/environments/seam.md`](systems/environments/seam.md).
  Why: sessions must run identically in a cloud sandbox and under the desktop
  app — a policy dependency in the runtime would fork those worlds.
- **Client ↔ server.** Clients speak the generated SDK contracts only. Why:
  three clients share one behavior surface; contract drift is caught at
  generation time instead of at runtime.
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
- **Agent ↔ company systems ↔ integration gateway.** An agent reaches Linear,
  Slack, GitHub-as-tool, or any MCP provider only through the integration
  gateway; credentials never enter the environment. Why: capability is
  resolved per call from what *this run* may do, and revocation must not
  require touching a sandbox.

## Cross-cutting engineering systems

Testing, observability, alerting, the building loop, and the customer loop are
systems too, but they own no product state. Each consumes every product
spec's `Emits` section (the named events and signals a system produces) and
`Proof` section (the tests that pin it). A product system with an empty
`Emits` section is invisible in production; the observability spec lists those
gaps per system.

The one property they all serve is **legibility by session id**: every user
action, agent turn, gateway call, and failure is one readable story keyed by
the session it belongs to — readable by a person, and machine-legible (stable
names, ids, links across Sentry, Grafana, and Honeycomb) for the agents that
triage and fix from it.

Their specs live at `specs/engineering/<name>/README.md` —
`testing`, `observability`, `shipping`, `security`, `customer-loop`.
Alongside them, [`specs/engineering/testing/standard.md`](engineering/testing/standard.md) and
[`specs/engineering/observability/standard.md`](engineering/observability/standard.md) are the per-PR law.

## Read order for grokking the repo

1. [`specs/README.md`](README.md#system-index) — the system index; pick
   the system you are touching and read its spec.
2. [`specs/areas/server.md`](areas/server.md) — the control plane and
   the grid ownership model.
3. [`specs/areas/anyharness.md`](areas/anyharness.md) — the runtime's
   mental model.
4. [`specs/areas/frontend.md`](areas/frontend.md) — how the clients
   are put together.

Then the depth files beside the owning spec's `README.md` under
[`specs/systems/`](README.md#system-index), if it has any.
