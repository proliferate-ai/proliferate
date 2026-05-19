# Codebase Knowledge Ownership Spec

Status: proposed documentation architecture.

Date: 2026-05-17

## Purpose

This spec defines how Proliferate should document the system so engineers and
agents can build a correct mental model before changing code.

The core problem is that the repo has several distinct services, several
cross-service product features, and several fundamental technologies. These are
different kinds of knowledge and should not be mixed into one doc type.

The documentation model has three layers:

```text
Services       where code lives, what it owns, what it exposes
Features       end-to-end product flows across services
Fundamentals   underlying technologies and concepts used by many services
```

Each layer has a different stability profile:

```text
Service docs       static-ish; updated when code ownership or interfaces change
Feature specs      ephemeral; updated while product behavior is designed/built
Fundamentals       static; updated when the underlying technology model changes
```

## Non-Goals

- Do not replace focused area docs such as `docs/frontend/README.md`,
  `docs/server/README.md`, `docs/anyharness/README.md`, or
  `docs/sdk/README.md`.
- Do not turn feature specs into folder-structure guides.
- Do not put product-specific implementation plans into fundamentals primers.
- Do not create empty documentation folder trees. Add docs when a service,
  feature, or concept has enough real content to own.

## Source-Of-Truth Rules

When docs overlap, use this precedence:

```text
1. Service docs own code organization and exposed interfaces.
2. Feature specs own user/product behavior and cross-service flow.
3. Fundamentals own technology concepts and low-level mental models.
```

Examples:

- A Slack feature spec may say that Slack creates a cloud-mediated session.
  It must not redefine where Server stores live or how AnyHarness domains are
  organized.
- The Server service doc owns API/domain/store layering. A feature spec may
  name new DB tables and endpoints, but it must follow Server layering rules.
- A Rust primer may explain ownership, async, and crates. It must not decide
  where AnyHarness session code belongs.

## Layer 1: Service Docs

Service docs answer:

```text
What is this service?
What code belongs here?
What state does it own?
What interfaces does it expose?
Who is allowed to call those interfaces?
What dependencies are allowed?
How do we test changes?
What are common anti-patterns?
```

### Required Service Set

The product should have a clear service-level mental model for:

```text
Desktop
AnyHarness
Proliferate Worker
Server
Proliferate AI Gateway
Mobile
Web
AnyHarness SDKs
Cloud SDKs
```

Some of these already have strong docs:

- Frontend/Desktop standards live under `docs/frontend/**`.
- Server standards live under `docs/server/**`.
- AnyHarness standards live under `docs/anyharness/**`.
- SDK standards live under `docs/sdk/**`.

The missing service docs should extend that model instead of duplicating it.

### Service Responsibility Map

| Service | Owns | Exposes | Primary callers |
| --- | --- | --- | --- |
| Desktop | Tauri app shell, local-first UI, local AnyHarness attachment, Desktop-specific platform access, user workflows | UI, local commands, Cloud client calls, AnyHarness client calls | Human users |
| AnyHarness | Runtime workspaces, sessions, actors, transcripts, tools, adapters, local persistence, runtime HTTP/SSE contract | AnyHarness HTTP/SSE APIs and generated SDK contract | Desktop, Proliferate Worker, direct local clients |
| Proliferate Worker | Target-side long polling, CloudCommand execution, target materialization, AnyHarness command transport, event upload | Worker command result/event protocol back to Cloud | Server control plane |
| Server | Cloud control plane, auth/orgs, DB state, Cloud APIs, worker command queue, projections, billing/account state | Cloud API, worker polling API, web/mobile/desktop API surface | Desktop, Web, Mobile, Worker, integrations |
| Proliferate AI Gateway | Agent model API facade, runtime grant auth, provider-routing enforcement, LiteLLM forwarding, budget/error mapping | Anthropic/OpenAI-compatible gateway endpoints | Agent harnesses running inside configured sandboxes |
| Mobile | Mobile user surface for cloud-mediated work, claiming/opening, automation visibility, lightweight session interaction | Native/mobile UI over Cloud APIs | Human users |
| Web | Browser user surface for cloud-mediated work, admin config, shared workspaces, automations, Slack/work viewing | Web UI over Cloud APIs | Human users |
| AnyHarness SDKs | Typed AnyHarness transport clients, generated contract bindings, runtime-facing React helpers where applicable | `@anyharness/sdk`, `@anyharness/sdk-react` | Desktop, tools, tests, external clients |
| Cloud SDKs | Typed Cloud API clients, React/query helpers for Cloud state, surface-safe access helpers | `cloud/sdk`, `cloud/sdk-react` | Desktop, Web, Mobile |

### Service Doc Template

Every service doc should follow this shape:

```text
# <Service> Standards

Status:
Scope:

## Purpose
What the service exists to do.

## Owns
Durable state, runtime state, product concepts, UI surfaces, protocols, and
side effects the service is authoritative for.

## Does Not Own
Adjacent responsibilities that must stay elsewhere.

## Code Shape
Target folders/modules and what each layer is allowed to contain.

## Interfaces
Inbound APIs/events/commands and outbound calls. Include caller/callee and
auth expectations.

## State Model
DB tables, local files, caches, runtime registries, generated state, and what
is restart-safe.

## Dependency Direction
Allowed imports/calls. Explicit banned dependencies.

## Error And Failure Model
How failures are represented, retried, surfaced, and made safe.

## Testing
Unit/integration/e2e expectations and smoke commands.

## Anti-Patterns
Concrete examples that should be rejected in review.
```

## Layer 2: Feature Specs

Feature specs answer:

```text
What user/product outcome are we trying to create?
Which services participate?
What is the source-of-truth data model?
What are the exact end-to-end flows?
What APIs, commands, events, SDK helpers, hooks, and UI states are involved?
What fails closed, what retries, and what remains visible to users?
```

Feature specs are the right home for cross-service flows such as:

```text
AnyHarness ACP session management
MCPs + skills
Cloud sandbox lifecycle
Cloud worker command/event flow
Automation runs
Slack threads
Claiming
Migration
Shared workspaces
Agent LLM auth gateway
Billing/usage limits
```

### Feature Doc Template

```text
# <Feature> Spec

Status:
Date:

## Goal
End-state UX and product outcome.

## Non-Goals
What this feature explicitly does not solve.

## Concepts
Product primitives and vocabulary used by the feature.

## Services Touched
For each service: what changes, what it owns, and which service doc governs
placement.

## Data Model
DB tables, durable records, external ids, generated schemas, and invariants.

## Interfaces
Cloud APIs, AnyHarness APIs, worker commands, gateway endpoints, SDK methods,
hooks, events, webhooks, and auth boundaries.

## End-To-End Flows
Numbered flows from user/system trigger to final projected state.

## Permissions And Identity
Actors, org/admin rules, claim semantics, credential ownership, audit events,
and revocation behavior.

## Failure Model
Retry behavior, stale state detection, fail-closed paths, user-visible errors,
and cleanup.

## Phases
Implementation chunks with concrete end states and acceptance criteria.

## Verification
Tests, smoke commands, migrations, local manual tests, and production rollout
checks.
```

### Feature Specs Must Name Service Boundaries

Every feature spec should include a table like:

| Service | Role In Feature | Owns | Must Not Own |
| --- | --- | --- | --- |
| Server | Example: stores config and queues command | DB rows, Cloud API | Target process state |
| Worker | Example: applies command to target | Target-side materialization | Cloud policy decisions |
| AnyHarness | Example: executes session | Runtime session truth | Org permissions |
| Desktop/Web/Mobile | Example: starts or views flow | User interaction | Raw DB or worker protocol |

This is the most important review artifact. If this table is unclear, the
feature is not implementation-ready.

## Layer 3: Fundamentals

Fundamentals docs answer:

```text
What is the underlying technology?
Which concepts matter for this repo?
What facts must an implementer know?
What procedures or recipes are safe?
What pitfalls should reviewers watch for?
```

Examples:

```text
Rust ownership, async, channels, SQLx/SQLite patterns
TypeScript type modeling
React rendering, hooks, React Query
Expo/native mobile constraints
Tauri desktop/mobile constraints
FastAPI/Pydantic/SQLAlchemy/Alembic
LiteLLM proxy model
Anthropic/OpenAI protocol compatibility
SSH target bootstrap and long polling
MCP protocol basics
ACP session model
```

### Fundamentals Doc Template

```text
# <Technology> Primer

Status:
Scope:

## Core Concepts
The minimum model needed to reason about the technology.

## Repo Usage
Where the repo uses this technology and which service docs own placement.

## Facts
Stable facts that should be true across feature work.

## Procedures
Common workflows and commands.

## Pitfalls
Mistakes that are likely to produce incorrect implementations.

## References
Official docs, local facts notes, and high-signal internal docs.
```

## Recommended Directory Shape

Do not create all of these folders at once. This is the target shape as docs
earn their place.

```text
docs/
  services/
    desktop.md
    anyharness.md
    proliferate-worker.md
    server.md
    ai-gateway.md
    web.md
    mobile.md
    anyharness-sdks.md
    cloud-sdks.md

  features/
    anyharness-acp-session-management.md
    mcp-skills.md
    cloud-sandbox-lifecycle.md
    cloud-worker-command-flow.md
    automations.md
    slack.md
    claiming.md
    migration.md
    shared-workspaces.md
    agent-llm-auth-gateway.md

  fundamentals/
    rust.md
    typescript.md
    react.md
    tauri.md
    fastapi-sqlalchemy-alembic.md
    litellm.md
    mcp.md
    acp.md
    ssh-targets.md
```

Existing authoritative area docs should either be linked from these service
docs or promoted into this shape over time. Do not fork their content.

## Read Workflow For Implementers

Before implementing a feature:

1. Read `docs/README.md`.
2. Read every service doc for services touched by the feature.
3. Read the feature spec.
4. Read fundamentals only for technologies you are actively changing or using
   in a non-trivial way.
5. If service docs and feature specs conflict, resolve the conflict in docs
   before coding.

For example, implementing Slack over cloud sessions should require:

```text
Service docs:
  Server
  Proliferate Worker
  AnyHarness
  Web/Desktop as relevant
  Cloud SDKs

Feature specs:
  Slack
  Cloud worker command flow
  Cloud sandbox lifecycle
  Claiming
  MCPs + skills if Slack exposes tools

Fundamentals:
  Slack API/webhooks
  AnyHarness session model
  Worker long polling
```

## Review Rules

A PR that adds a new cross-service feature should be reviewable against:

- one or more service docs for code placement,
- one feature spec for product flow and acceptance criteria,
- optional fundamentals docs for low-level protocol/technology assumptions.

Reviewers should ask:

```text
Does each service own only its part?
Is source-of-truth state located in one place?
Are inbound and outbound interfaces explicit?
Does the feature spec say what happens on retry, restart, and stale state?
Are permissions, credentials, and claiming semantics explicit?
Are SDK/hook surfaces named instead of raw endpoint calls leaking upward?
Are tests mapped to the service and feature boundaries?
```

## Applying This To Proliferate AI Gateway

The AI Gateway should get a service doc before broad implementation continues.
That service doc should say:

```text
Owns:
  runtime grant authorization
  provider-protocol facade behavior
  LiteLLM forwarding
  request/response/error mapping
  model/budget fail-closed enforcement

Does not own:
  org/admin UI
  credential collection UX
  LiteLLM provisioning policy
  sandbox materialization
  AnyHarness session state

Inbound:
  Anthropic-compatible model API routes
  OpenAI-compatible model API routes
  health/status route

Outbound:
  private LiteLLM runtime proxy calls
  Server store reads for runtime grant validation

Primary callers:
  agent harnesses inside configured sandboxes

Primary config:
  gateway enabled flag
  LiteLLM base URL
  request size/time limits
  per-harness feature gates
```

The existing `agent-llm-auth-gateway-spec.md` remains a feature spec. It should
depend on the AI Gateway service doc for route ownership, forwarding behavior,
and security boundaries.

## Migration Path

1. Land this taxonomy spec.
2. Add a `docs/services/ai-gateway.md` service doc, because that service is new
   and currently only described indirectly through the feature spec.
3. Add or promote service docs for Worker, Web, Mobile, and Cloud SDKs as those
   surfaces become implementation-heavy.
4. Rename or copy high-value architecture docs into `docs/features/**` only
   when doing so reduces confusion. Avoid churn for its own sake.
5. Add fundamentals docs only after a real feature needs a stable primer.
