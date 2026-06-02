# Spec Orientation Catalog

Status: investigative catalog written from the current `specs/**` tree.

This document catalogs how the current specs are oriented, where each requested
topic already lives, and where the repo still has gaps or naming drift. It is a
map over the authoritative specs, not a replacement for them.

## Investigation Scope

Read first, per repo rule:

```text
specs/README.md
```

Then sampled and cross-checked:

```text
specs/codebase/structures/**/README.md
specs/codebase/structures/**/guides/*.md
specs/codebase/primitives/*.md
specs/codebase/features/*.md
specs/codebase/features/agent-features/**/*.md
specs/developing/**/*.md
specs/developing/reference/env-vars.yaml
```

Inventory counts from the current tree:

| Bucket | Count | Notes |
| --- | ---: | --- |
| Root Markdown docs | 4 | Includes this catalog plus catalog notes; `specs/README.md` is the only canonical root index. |
| `specs/codebase/structures/**/*.md` | 64 | Structure indexes, focused guides, subsystem specs, and migration-era source docs. |
| `specs/codebase/primitives/**/*.md` | 15 | Reusable runtime/product substrate and harness-specific primitive docs. |
| `specs/codebase/features/**/*.md` | 24 | User-facing workflows, agent-feature/Product MCP definitions, and product-surface specs. |
| `specs/developing/**/*.md` | 25 | Operator runbooks for local dev, deploy, debugging, analytics, QA, runbooks, and reference docs. |
| `specs/tbd/**/*.md` | 9 | Includes `tbd/README.md`; all docs remain non-authoritative until promoted. |

High-level shape from `specs/README.md`:

```text
specs/
  codebase/
    structures/   Where code belongs and which layer owns it.
    primitives/   Durable reusable runtime/product substrate.
    features/     User-facing workflows and product surfaces.
  developing/     How operators run, debug, deploy, observe, and QA.
  tbd/            Non-authoritative material.
```

## Orientation Model

The current spec system is organized around four questions:

| Question | Folder | Orientation | Typical contents |
| --- | --- | --- | --- |
| Where does code belong? | `specs/codebase/structures/` | Ownership boundary, folder grammar, dependency direction. | Target tree, "what goes where" tables, hard rules, read order. |
| What durable concept does this feature reuse? | `specs/codebase/primitives/` | Cross-feature substrate and implementation-ready contracts. | Data model, command/wire contracts, lifecycle, APIs, files to change, acceptance tests. |
| What user workflow or product surface is this? | `specs/codebase/features/` | Product semantics assembled from primitives. | UX flows, surface state, feature-specific source ownership, acceptance criteria. |
| How does an operator do the work? | `specs/developing/` | Human/agent runbooks. | Tools, permissions, env locations, happy path, verification, failure rules, final report shape. |

Useful rule of thumb:

```text
Structure spec = ownership law
Primitive spec = reusable runtime/product substrate
Feature spec   = user workflow or product-facing surface
Developing doc = operator process
TBD doc        = useful but not authoritative yet
```

Read-order decision table:

| If the task starts from... | Read first | Then read |
| --- | --- | --- |
| A source path or package/crate boundary | The owning structure README. | Focused structure guide/spec for that layer, then feature/primitive docs if behavior changes. |
| A shared concept reused by multiple product surfaces | `specs/codebase/primitives/README.md`. | The exact primitive file plus implementing structure docs. |
| A user workflow, screen, or agent-visible capability | `specs/codebase/features/README.md`. | The feature spec, then the primitives it consumes and the structures it touches. |
| A release, deploy, local-dev, debugging, analytics, or QA task | `specs/developing/README.md`. | The focused process runbook plus codebase specs for any implementation area touched. |
| A planning note under `specs/tbd/` | Treat it as non-authoritative. | Promote or rewrite into `codebase/**` or `developing/**` only after owner and contract are clear. |

## Requested Topics At A Glance

| Requested topic | Current source of truth | Coverage | Notes |
| --- | --- | --- | --- |
| Frontend apps | `specs/codebase/structures/frontend/README.md` plus focused guides. | Strong | Covers Desktop, Web, Mobile, and shared packages. |
| AnyHarness | `specs/codebase/structures/anyharness/README.md` plus guides/specs. | Strong | Session engine, runtime boundaries, MCP vertical, live resources. |
| Proliferate Worker | `specs/codebase/structures/proliferate-worker/README.md` plus guides. | Strong | Downlink, uplink, target status, target-local effects, identity, store. |
| Supervisor | `specs/codebase/structures/proliferate-supervisor/README.md`. | Good | Focused process/install/update boundary. |
| Server | `specs/codebase/structures/server/README.md` plus guides/audits. | Strong | Layer law, DB pipeline, auth, errors, integrations, workers. |
| Auth Gateway | `structures/README.md` split-ownership note, server auth guide, product auth, and agent-auth primitives. | Split | No standalone structure spec unless it becomes a separately owned/deployed boundary. |
| Sandbox provisioning | `specs/codebase/primitives/sandbox-provisioning.md`. | Strong | Spec 00 foundation. |
| Workspace provisioning/creation | `workspace-provisioning.md`, then `sandbox-provisioning.md`, `cloud-commands.md`, `workspace-lifecycle.md`, and the entrypoint feature spec. | Strong | Single read-path entrypoint; implementation ownership stays split across foundation, commands, lifecycle, and feature handoff specs. |
| MCP + skills flow | `mcp-runtime.md`, `mcp-skills.md`. | Strong | Runtime MCP concepts plus cloud-configured MCP/skills/plugins. |
| Product MCP structure | `features/agent-features/servers.md` and definitions. | Strong, with gaps | Pattern exists; browser/computer-use definitions are not written yet. |
| Agent auth primitive | `agent-auth.md`, `agent-auth-bifrost-byok.md`. | Strong | Agent auth, Bifrost gateway, managed credits, BYOK. |
| Cloud commands | `cloud-commands.md`. | Strong | Command queue, exposure, projection, wake gate. |
| Claiming | `claiming.md`. | Strong | Shared-unclaimed to claimed transition and direct attach. |
| Billing | `billing.md`; local operator doc in `developing/local/stripe-local-testing.md`. | Strong | Product primitive plus local Stripe runbook. |
| Onboarding | `features/onboarding.md`, plus product auth, Bifrost/BYOK, billing, settings, and workspace provisioning specs. | Good | Dedicated feature read path now exists; lower-level slices remain with their owning specs. |
| Cloud access / dispatch | `features/cloud-dispatch.md`, `mobile-cloud-client.md`, `web-cloud-local-parity.md`. | Strong | Web/mobile/cloud-mediated dispatch and parity. |
| Subagents | `agent-features/definitions/subagents.md`, `delegated-work.md`. | Strong | Product MCP plus UX model. |
| Artifacts | `agent-features/definitions/artifacts.md`, `cowork-artifacts.md`. | Strong | Current cowork reality plus target artifacts domain. |
| Browsers | Mentioned as future product MCP. | Missing | No dedicated browser feature/MCP definition. |
| Terminals | AnyHarness structure and SDK contract. | Structural only | No product feature spec. |
| Computer use | Mentioned as future product MCP. | Missing | No dedicated computer-use feature/MCP definition. |
| Plugins | `mcp-skills.md`, `settings-admin-ia.md`. | Good | Primitive owns configured state/runtime expansion; Settings IA owns placement. |
| Deploying/updating prod/infra | `developing/deploying/README.md`, `ci-cd.md`, self-hosted docs. | Strong | Includes tools, permissions, env locations, verification, failures. |
| Developing locally | `developing/local/README.md`, `dev-profiles.md`, `stripe-local-testing.md`, `mobile.md`. | Strong | Profile-first local process. |
| Debugging | `developing/debugging/README.md`, `support-reports.md`, `performance-profiling.md`. | Good | General triage plus support report and performance runbooks. |
| Analytics + freshness | `developing/analytics/README.md` plus tool docs. | Strong | Customer.io, Metabase, PostHog, Sentry, anonymous telemetry. |
| QA | `developing/qa/README.md`. | Good | Release QA entrypoint and surface matrix; per-surface scripts could be split later. |

## Codebase: Structures

Structure specs are consistent: each major system gets a target source shape,
ownership rules, read order, dependency direction, and review checklist or hard
rules. They tell an implementer which file or layer is allowed to own behavior
before code changes begin.

| Structure | Path | Oriented around | Key ownership statement |
| --- | --- | --- | --- |
| Frontend apps and packages | `specs/codebase/structures/frontend/README.md` | Components, hooks, stores, access, lib/domain, providers, config, copy, styling, telemetry, shared packages. | Components render; hooks own React behavior; stores hold client-only shared state; pure rules live in `lib/domain` or `product-domain`. |
| Desktop native | `specs/codebase/structures/desktop-native/README.md` | Tauri shell, bundled sidecars, agent seeds, keychain, desktop worker child process. | Native shell owns OS/Tauri/process/secrets boundary, not product UI or AnyHarness internals. |
| AnyHarness | `specs/codebase/structures/anyharness/README.md` | Runtime server, session engine, domains/live/adapters/integrations, MCP vertical. | Wire contract, durable state, live execution, local capability, and product extension are separate boundaries. |
| SDK | `specs/codebase/structures/sdk/README.md` | `@anyharness/sdk` and `@anyharness/sdk-react`. | Core SDK is pure TypeScript; React SDK owns generic query/provider bindings; app policy stays out. |
| Server | `specs/codebase/structures/server/README.md` | FastAPI control plane layer law. | `api.py` transports, `service.py` orchestrates, `db/store/**` queries, domain policy is pure, integrations own raw clients. |
| Proliferate Worker | `specs/codebase/structures/proliferate-worker/README.md` | Target-side Cloud bridge. | Worker leases Cloud commands, calls AnyHarness/target effects, uploads events/status, and keeps bridge durability. |
| Proliferate Supervisor | `specs/codebase/structures/proliferate-supervisor/README.md` | Target process lifecycle and update staging. | Supervisor starts/restarts AnyHarness and Worker; it does not own Cloud, Worker, or AnyHarness product behavior. |
| Auth Gateway | No standalone structure doc; explicit split-ownership note in `structures/README.md`. | Product auth, server auth, agent auth, and Bifrost gateway behavior. | Current canonical server owner is `server/proliferate/server/cloud/agent_auth/**`; primitive specs own LLM gateway behavior. |

Recurring structure pattern:

```text
README.md
  Scope
  Goal
  Target shape
  What goes where
  Read order
  Hard rules
  Dependency direction
  Review checklist
```

### Focused Structure Read Map

| System | Index | Focused docs | What they orient around |
| --- | --- | --- | --- |
| Frontend | `structures/frontend/README.md` | `guides/components.md`, `hooks.md`, `state.md`, `lib.md`, `access.md`, `config.md`, `copy.md`, `styling.md`, `telemetry.md`, `packages/README.md` | React layer ownership, package sharing, UI primitives, telemetry/privacy, app access boundaries. |
| Desktop native | `structures/desktop-native/README.md` | `specs/anyharness-sidecar.md`, `specs/agent-seeds.md` | Tauri sidecar launch/health/resources and bundled agent seed hydration. |
| AnyHarness | `structures/anyharness/README.md` | `guides/system-architecture.md`, `api.md`, `app.md`, `domains.md`, `live-runtime.md`, `adapters.md`, `integrations.md`, `persistence.md`, `observability.md`, `repo-shape.md`, `specs/session-engine.md`, `specs/session-actor.md`, `contract.md` | Runtime layer law, session engine, public contract, live resources, local capabilities, MCP/product extensions. |
| Proliferate Worker | `structures/proliferate-worker/README.md` | `guides/runtime.md`, `command-downlink.md`, `event-uplink.md`, `target-status.md`, `target.md`, `clients.md`, `store.md`, `identity.md`, `root-support.md` | Target-side bridge composition, command delivery, event upload, target materialization/status, identity, durable cursors. |
| Proliferate Supervisor | `structures/proliferate-supervisor/README.md` | `install/README.md` when installer/service generation changes | Process lifecycle, restart loops, install layout, update staging/rollback. |
| Server | `structures/server/README.md` | `guides/domains.md`, `database.md`, `auth.md`, `errors.md`, `integrations.md`, `config.md`, `workers.md`, audits under `audits/` | FastAPI domain layering, DB pipeline, auth/resource access, background workers, external clients, env-derived config. |
| SDK | `structures/sdk/README.md` | Generated SDK build/generate commands in `anyharness/sdk/**` | TypeScript SDK generation, React SDK boundaries, generated-code ownership. |

### Auth Gateway Finding

The user-requested "Auth Gateway" structure is not currently a first-class
structure spec. `specs/codebase/structures/README.md` now names the split
ownership explicitly. Related material exists in:

| Concern | Current doc |
| --- | --- |
| Product account auth | `specs/codebase/features/product-auth.md` |
| Server auth and authorization structure | `specs/codebase/structures/server/guides/auth.md` |
| Agent LLM auth primitive | `specs/codebase/primitives/agent-auth.md` |
| Bifrost/BYOK/managed credits | `specs/codebase/primitives/agent-auth-bifrost-byok.md` |
| Server canonical code owner note | `specs/codebase/structures/server/audits/server-structure-hygiene.md` |

Current audit language says the server owner for gateway-backed agent auth is:

```text
server/proliferate/server/cloud/agent_auth/**
```

That suggests the right next decision is not "write a missing placeholder";
it is whether Auth Gateway is a deployable subsystem with its own structure
boundary, or whether it remains a primitive implemented by the server cloud
agent-auth domain plus Bifrost integration.

## Codebase: Primitives

Primitive specs are the most implementation-ready docs. They usually contain:

```text
Purpose and scope
Mental model
Dependencies
Current repo state
Target model
Data model / wire model / APIs
Files to change
Implementation chunks
Acceptance criteria
Verification and tests
Final decisions / deferred questions
```

The numbered implementation-ready chain is roughly:

```text
00 sandbox-provisioning
01 mcp-skills
02 agent-auth
03 settings-admin-ia        # feature, but participates in the numbered program
04 cloud-commands
05 claiming
06 automations              # feature
07 slack-bot                # feature
08 cloud-dispatch           # feature
09 billing
10 workspace-migration      # feature
```

Primitive dependency sketch:

```text
sandbox profile / target / slot
  -> runtime config materialization
  -> agent auth materialization
  -> cloud command queue
  -> exposure and session projection
  -> claiming and direct attach
  -> billing wake gate
  -> automations / Slack / web-mobile dispatch / migration
```

| Primitive | Path | Orientation | Important notes |
| --- | --- | --- | --- |
| Sandbox provisioning / creation | `primitives/sandbox-provisioning.md` | Foundation for `sandbox_profile`, target, sandbox slot, worker enrollment, runtime access, and provisioning jobs. | This is the cloud runtime substrate. It separates profile, target, and slot. |
| Workspace provisioning / creation | `primitives/workspace-provisioning.md` | Canonical read path for managed workspace creation across sandbox, command, lifecycle, and pending-shell owners. | This is a bridge spec, not a replacement for the deeper implementation specs. |
| Workspace lifecycle | `primitives/workspace-lifecycle.md` | Workspace pruning, archive/restore/delete, materialization, worktree retention, surface state. | It is broader than its title, but initial workspace creation is not fully centralized here. |
| MCP runtime | `primitives/mcp-runtime.md` | AnyHarness MCP concepts: user bindings, session extensions, product MCP servers, elicitation. | It distinguishes product semantics from MCP protocol mechanics. |
| MCP / skills / plugins | `primitives/mcp-skills.md` | Cloud-configured MCP connections, skill items, plugin items, runtime config revisions, worker materialization. | Plugins expand one way into MCP/skills before AnyHarness launch. |
| Agent auth | `primitives/agent-auth.md` | Per-profile/per-harness auth selection, synced files, gateway env, runtime grants, capability API. | Defines fail-closed behavior and protected env constraints. |
| Bifrost BYOK and managed credits | `primitives/agent-auth-bifrost-byok.md` | Bifrost data/control/usage plane for managed credits and BYOK. | Deepest current gateway/onboarding/credit spec. |
| Cloud commands | `primitives/cloud-commands.md` | Command envelope, lease/result, runtime config preflight, exposure model, projection cursor, wake gate. | Establishes passive UI invariant and `managed_profile_launch` helper. |
| Claiming | `primitives/claiming.md` | One-way `shared_unclaimed` to claimed transition and direct attach tokens. | Owns claim policy, claim token, JWKS/direct access. |
| Billing | `primitives/billing.md` | Billing authorization, free allocation, Pro grants, wake hook, blocked states, Stripe/E2B interactions. | Product primitive; local Stripe operation lives under `developing/local`. |
| Model catalog | `primitives/model-catalog.md` | Dynamic model registries and harness-specific model truth. | Crosses Cloud, AnyHarness, Worker sync, Desktop. |
| Agent catalog/readiness | `primitives/agent-catalog-readiness.md` | Agent catalog input, trusted descriptor projection, readiness and install topology. | Supports AnyHarness session launch readiness. |
| Harnesses | `primitives/agents/claude.md`, `primitives/agents/codex.md` | Provider-specific supported surfaces and launch/runtime constraints. | Complements AnyHarness harness docs. |

### Primitive Read Paths

| If you need to understand... | Read in order |
| --- | --- |
| Managed workspace creation from Web/Mobile/automation/Slack | `workspace-provisioning.md` -> `sandbox-provisioning.md` -> `cloud-commands.md` -> `workspace-lifecycle.md` -> the feature spec for the entrypoint. |
| Agent model/API-key/gateway readiness | `agent-auth.md` -> `agent-auth-bifrost-byok.md` -> `billing.md` if managed credit or wake authorization is involved. |
| MCPs, skills, plugins, and product MCP injection | `mcp-runtime.md` -> `mcp-skills.md` -> `features/agent-features/servers.md` -> the concrete definition under `features/agent-features/definitions/`. |
| Cloud commandability and remote session projection | `cloud-commands.md` -> `claiming.md` when shared/unclaimed workspaces are involved -> `cloud-dispatch.md` or `mobile-cloud-client.md`. |
| Model or agent availability in selectors/session launch | `model-catalog.md` -> `agent-catalog-readiness.md` -> harness doc under `primitives/agents/` and AnyHarness harness docs. |
| Billing gates around runtime starts | `billing.md` -> `agent-auth-bifrost-byok.md` for managed credit -> local Stripe runbook for operator verification. |

### Workspace Provisioning Finding

The prompt asks for "Workspace Provisioning / Creation flow." The repo now has
an obvious read-path file at `primitives/workspace-provisioning.md`; the
implementation ownership remains split:

| Piece | Current owner |
| --- | --- |
| Sandbox profile/target/slot substrate | `sandbox-provisioning.md` |
| `cloud_workspace` additions | `sandbox-provisioning.md` section 5.7 |
| Managed launch helper and command queue | `cloud-commands.md` |
| Workspace materialization, prune, hydrate, archive, delete | `workspace-lifecycle.md` |
| Mobile/Web first-prompt workspace creation | `cloud-dispatch.md`, `mobile-cloud-client.md` |

Use `workspace-provisioning.md` before jumping into the deeper owner docs for a
creation, onboarding, support, or debugging path.

## Codebase: Features

Feature specs own product workflows and surfaces. Many of the large feature
specs depend directly on the primitive sequence above.

| Feature area | Current docs | Orientation | Coverage |
| --- | --- | --- | --- |
| Cloud access / dispatch | `cloud-dispatch.md`, `web-cloud-local-parity.md`, `mobile-cloud-client.md` | Web/mobile/cloud-mediated clients over command/exposure/projection. | Strong |
| Automations | `automations.md` | Scheduled/manual work over the same sandbox/profile/runtime/auth/command primitives. | Strong |
| Slack bot | `slack-bot.md` | Slack OAuth, thread work, repo routing, mention-to-managed-launch, posting. | Strong |
| Workspace migration | `workspace-migration.md` | Moving runnable workspace state across targets/sides. | Strong |
| Pending workspace shell | `pending-workspace-shell.md` | Session intents, optimistic UI, projected shell before materialization. | Strong |
| Onboarding | `onboarding.md` | Signed-out to product-ready account handoff, readiness gates, and first workspace transition. | Good |
| Chat composer | `chat-composer.md` | Composer layout, approval card, proposed plan, todo tracker, visual rules. | Strong |
| Chat transcript | `chat-transcript.md` | Stream/transcript rows, tool rendering, delegated-work receipts, layout invariants. | Good |
| Workspace files | `workspace-files.md` | File browser, viewer, diff, right-panel tools. | Compact but clear |
| Support reporting | `support-reporting.md` | Desktop support report UX, diagnostics bundle, upload contract, issue trackers, debug correlation. | Good |
| Product auth | `product-auth.md` | Product sign-in methods, linked providers, password credential behavior, readiness gate. | Good |
| Settings/Admin IA | `settings-admin-ia.md` | Settings structure, page ownership, plugins placement, admin gating. | Strong |
| Delegated work | `delegated-work.md` | Parent/child work UX, status model, tabs, composer popover, transcript/details. | Strong |
| Cowork artifacts | `cowork-artifacts.md` | Current artifact lifecycle via cowork and desktop read model. | Good |

### Prompt Topic To Feature Owner

| Prompt topic | Current feature orientation |
| --- | --- |
| Onboarding | `onboarding.md` owns the end-to-end read path; lower-level slices remain in product auth, Bifrost/BYOK, billing, settings/admin IA, workspace provisioning, and local/mobile docs. |
| Cloud Access / Dispatch | `cloud-dispatch.md` owns the remote UX; `web-cloud-local-parity.md` owns parity; `mobile-cloud-client.md` owns mobile specifics. |
| Subagents | `delegated-work.md` owns product UX; `agent-features/definitions/subagents.md` owns Product MCP semantics. |
| Artifacts | `cowork-artifacts.md` owns current artifact behavior; `agent-features/definitions/artifacts.md` owns the target Product MCP definition. |
| Browser | Runtime shape is anticipated in AnyHarness live/adapters guidance and Product MCP server future list; no concrete feature or MCP definition exists. |
| Terminals | AnyHarness structure/contract owns durable/live terminal internals; no feature spec owns terminal product UX or QA gates. |
| Computer Use | Product MCP server pattern lists it as future; no concrete definition or feature workflow exists. |
| Plugins | Runtime/config flow lives in `mcp-skills.md`; Settings IA owns current admin placement; no separate marketplace/manage feature spec yet. |

### Product MCP Feature Family

Product MCPs are now under:

```text
specs/codebase/features/agent-features/
  servers.md
  definitions/
    README.md
    artifacts.md
    cowork.md
    prompt-and-skill-policy.md
    reviews.md
    subagents.md
    workspace-naming.md
```

Their intended source split is:

```text
domains/<domain>/mcp
  Product-specific tool semantics.

domains/sessions/mcp_bindings
  Session selection, binding summaries, launch assembly, injection.

integrations/mcp
  JSON-RPC, MCP tool formatting, product-server dispatcher, capability tokens.

api/http
  HTTP endpoint wrapper for product MCP servers.
```

Every concrete Product MCP definition is expected to answer:

```text
id
owner
visibility
default injection
context
tools
calls
UI exposure
```

| Agent feature | Current doc | Status |
| --- | --- | --- |
| Subagents | `agent-features/definitions/subagents.md` | Strong |
| Artifacts | `agent-features/definitions/artifacts.md` | Strong target; current implementation still cowork-backed. |
| Reviews | `agent-features/definitions/reviews.md` | Strong |
| Cowork | `agent-features/definitions/cowork.md` | Strong |
| Workspace naming | `agent-features/definitions/workspace-naming.md` | Good |
| Prompt and skill policy | `agent-features/definitions/prompt-and-skill-policy.md` | Good cross-cutting standard |
| Browser | No definition yet. | Missing |
| Computer use | No definition yet. | Missing |
| Plugins | Primitive/IA docs, not an agent-feature definition. | Covered elsewhere |

### Feature Gaps

| Gap | Why it matters | Suggested location |
| --- | --- | --- |
| Browser product feature/MCP | `servers.md` names browser as likely future product MCP, but no identity/tools/auth/UI definition exists. | `specs/codebase/features/agent-features/definitions/browser.md` |
| Computer-use product feature/MCP | Same as browser; mentioned as future product MCP only. | `specs/codebase/features/agent-features/definitions/computer-use.md` |
| Terminals product feature | Terminals are structurally covered in AnyHarness and SDK, but there is no product surface/runbook spec for how users interact with terminals. | Either `features/terminals.md` or `structures/anyharness/specs/terminals.md`, depending on whether the change is UX or runtime. |
| Plugins feature split | Plugin configured state/runtime expansion is well covered by `mcp-skills.md`, and IA placement is covered. If marketplace UX grows, a dedicated `features/plugins.md` would help. | Optional `specs/codebase/features/plugins.md` |

## Developer Processes

Developer process docs are explicitly operator-oriented. The root contract says
a process doc is not complete until it names tools/MCPs/connectors/CLIs,
permissions, env/config locations, normal path, verification, failure modes,
secrets policy, and final report shape.

### Deploying / Updating Production / Infra

| Requested subtopic | Current docs | Tools / MCPs / surfaces | Permissions |
| --- | --- | --- | --- |
| Full stack / infrastructure | `developing/deploying/README.md`, `ci-cd.md` | GitHub Actions via GitHub MCP, `gh`, shell, `curl`, `jq`, AWS CLI, Vercel CLI/dashboard, Expo/EAS, App Store Connect, Sentry, browser/Chrome. | GitHub repo read/write, Production environment approval, GitHub env secret admin, AWS deploy roles, Vercel team, Expo/App Store Connect, Sentry. |
| Environment variables and where they live | `ci-cd.md`, `reference/env-vars.yaml`, `reference/env-secrets-matrix.md` | GitHub environments, AWS SSM, Vercel project settings, Expo/EAS, local shell for catalog checks. | Secret/env admin for the relevant surface; no secret values in chat/docs/logs. |
| Production/staging deployment | `ci-cd.md` Agent Deployment Runbook | `Deploy Staging`, `Promote Production`, Actions artifacts, health checks. | Exact SHA on `main`, CI passed, staging success unless approved bypass, production approval. |
| New release process | `ci-cd.md` delivery flows | Desktop updater feeds, runtime/SDK release, cloud template, server image, mobile/TestFlight, hosted web/API. | Lane-specific release/deploy permissions. |
| Landing page/docs follow-up | `deploying/README.md`, `ci-cd.md` | PR/release notes, public docs, changelog, in-app copy. | Repo/docs ownership and release operator responsibility. |

Deployment reporting shape:

```text
workflow run URL
commit SHA
surfaces that ran
surfaces skipped and why
verification results
release/docs/landing-page follow-up
remaining owner or risk
```

Deploying orientation in one line:

```text
GitHub Actions is the orchestration source, GitHub environments hold deploy-time
config/secrets, AWS/Vercel/Expo/Apple/E2B own lane-specific runtime state, and
the operator must report the exact SHA plus each lane's verification.
```

### Developing Locally

| Requested subtopic | Current docs | Tools / MCPs / surfaces | Permissions |
| --- | --- | --- | --- |
| Working with profiles | `developing/local/README.md`, `dev-profiles.md` | Shell, `make dev-init PROFILE=<name>`, `make dev PROFILE=<name>`, browser/Desktop/mobile web. | Local machine, Rust, Node 22+, pnpm, Python 3.12, `uv`; local env secrets only when real auth/runtime needed. |
| Working with Stripe | `local/stripe-local-testing.md` | Stripe CLI, local profile, Stripe test card, local DB shell. | Stripe test-mode access; production Stripe read/write only when explicit. |
| Working with Mobile | `local/mobile.md` | Expo, mobile web, `make dev-mobile-auth`, ngrok, simulator/device. | Provider console redirect configuration when testing native OAuth; device/simulator access. |
| Agent gateway local dev | `dev-profiles.md`, Bifrost spec | `make dev PROFILE=<name> AGENT_GATEWAY=bifrost`, optional ngrok tunnel. | Local provider keys/Bifrost config; do not commit or print secrets. |

Canonical local command block:

```bash
make dev-init PROFILE=<name>
make dev PROFILE=<name>
make dev PROFILE=<name> STRIPE=1
source ~/.proliferate-local/dev/profiles/<name>/launch.env
pnpm --dir apps/mobile web:profile
```

Local development orientation in one line:

```text
A dev profile is the unit of isolation: ports, database, runtime home, desktop
identity, Tauri state, mobile-web env, and optional Stripe/gateway tunnels all
hang off PROFILE=<name>.
```

### Debugging

| Requested subtopic | Current docs | Tools / MCPs / surfaces | Permissions |
| --- | --- | --- | --- |
| General issue runbook | `developing/debugging/README.md` | GitHub issues first, Sentry, deploy/release artifacts, local profile reproduction, browser/Chrome. | GitHub issue/PR access, Sentry, local shell. |
| Tenant/support correlation | `debugging/support-reports.md`, `features/support-reporting.md` | Support report id, tenant id, user/org id, cloud workspace id, AnyHarness workspace id, session id, command id, worker id, S3, CloudWatch, Sentry, GitHub, Linear. | Internal support report/S3 access, CloudWatch/AWS, Sentry, GitHub/Linear as needed. |
| Specific runbooks | `support-reports.md`, `performance-profiling.md`, analytics Sentry doc, deploy doc. | JSON diagnostics, slow-state dump, Sentry projects, deploy workflows. | Surface-specific read/write permissions. |

General debugging loop:

```text
start from GitHub issue or support report
  -> collect stable ids
  -> check Sentry
  -> check deploy/release timing
  -> reproduce in isolated profile
  -> capture sanitized evidence
  -> update issue with diagnosis and owner
```

Debugging orientation in one line:

```text
Start from a durable artifact, prefer stable ids over user text, correlate
through Cloud/Sentry/logs/deploys, reproduce in an isolated profile, then update
the GitHub issue or support handoff with sanitized evidence.
```

### Analytics And Keeping Fresh

| Surface | Owns | Current doc | Tools / permissions |
| --- | --- | --- | --- |
| Customer.io | Engagement and lifecycle messaging. | `analytics/customerio.md` | Customer.io workspace, GitHub/AWS env access, Cloudflare DNS for sending domain. |
| Metabase | Durable operating metrics over database facts. | `analytics/metabase.md` | Metabase editor/admin, read-only analytics DB credentials, migration rights when views change. |
| PostHog | Hosted-product analytics and optional replay. | `analytics/posthog.md` | PostHog project/replay privacy config, deploy env access. |
| Sentry | Exceptions, native crashes, release health, support correlation. | `analytics/sentry.md`, `sentry-setup-runbook.md` | Sentry org/project/alert/release token access. |
| Anonymous telemetry | First-party aggregate usage for desktop/self-managed/local-dev. | `analytics/anonymous-telemetry.md` | Repo write, migrations/tests, production DB read for aggregate validation. |

Freshness triggers:

```text
event names or payloads change
identity traits change
replay gates/masking changes
lifecycle emails or journeys change
dashboard SQL/views/cards change
Sentry projects/releases/alerts change
anonymous telemetry ingestion/aggregation changes
```

Privacy invariant:

```text
No prompts, transcript bodies, terminal output, repo names, raw paths,
request bodies, cookies, auth headers, provider responses, or secret values
go to analytics/replay/error-monitoring docs or payloads.
```

Analytics orientation in one line:

```text
Customer.io messages users, Metabase charts database facts, PostHog observes
hosted-product behavior/replay, Sentry tracks failures, and anonymous telemetry
handles first-party aggregate desktop/self-managed/local-dev usage.
```

### QA

The QA root is no longer empty. It is an authoritative release QA entrypoint
with operator requirements, intake, baseline verification, local full-stack QA,
surface matrix, regression rules, failure handling, and final report shape.

| QA area | Current doc | Tools / MCPs / surfaces | Permissions |
| --- | --- | --- | --- |
| Release QA process | `developing/qa/README.md` | GitHub MCP/`gh`, local shell, Browser/Chrome, dev profiles, Stripe CLI, Expo/EAS, AWS/Vercel/E2B dashboards. | GitHub repo read/write as needed, environment approval for deploy QA, staging/prod app accounts, Stripe test mode, analytics/vendor access, AWS/Vercel/E2B/Expo/App Store Connect as touched. |
| Surface matrix | `developing/qa/README.md` | Desktop, Web, Mobile web, Native mobile, Server/API, AnyHarness, workers/supervisor, billing, analytics, deploy/release. | Surface-specific. |
| Feature-specific acceptance | Owning `specs/codebase/**` docs | Targeted commands/manual smoke per feature. | Whatever the feature touches. |

Baseline verification examples:

```bash
cargo test --workspace
pnpm --filter @proliferate/product-domain test
pnpm --filter @proliferate/web typecheck
pnpm --filter @proliferate/mobile typecheck
pnpm --filter @proliferate/product-ui typecheck
cd server && uv run pytest -q
```

The remaining QA opportunity is not absence of a runbook; it is depth. If
release QA becomes repetitive by surface, split detailed checklists into files
such as:

```text
specs/developing/qa/desktop.md
specs/developing/qa/web.md
specs/developing/qa/mobile.md
specs/developing/qa/cloud-runtime.md
specs/developing/qa/billing.md
specs/developing/qa/release.md
```

## Recommended Spec Additions

| Priority | Add or fix | Proposed path | Reason |
| --- | --- | --- | --- |
| P1 | Decide Auth Gateway boundary only if product ownership changes. | `specs/codebase/structures/auth-gateway/README.md` if first-class; otherwise keep the split-ownership note current. | Current behavior is split but now explicitly cross-linked. |
| Done | Add onboarding feature spec. | `specs/codebase/features/onboarding.md` | Dedicated feature read path now exists; deepen it as onboarding UX changes. |
| P1 | Add browser product MCP definition. | `specs/codebase/features/agent-features/definitions/browser.md` | `servers.md` names browser use as likely future product MCP. |
| P1 | Add computer-use product MCP definition. | `specs/codebase/features/agent-features/definitions/computer-use.md` | Same future MCP gap as browser. |
| Done | Clarify workspace creation/provisioning read path. | `specs/codebase/primitives/workspace-provisioning.md` | Creation still spans sandbox, commands, lifecycle, dispatch, and mobile, but there is now one first-read doc. |
| P2 | Add terminal spec at the correct layer. | `features/terminals.md` or `structures/anyharness/specs/terminals.md`. | Current docs cover terminal internals but not product behavior. |
| P2 | Split per-surface QA checklists if releases need more detail. | `specs/developing/qa/*.md` | Root QA has the process and matrix; per-surface runbooks would make release execution faster. |
| P3 | Add plugin UX feature spec if marketplace/admin UX expands. | `specs/codebase/features/plugins.md` | Runtime/config state is covered; richer product UX may need its own feature doc. |

## Proposed Future Spec Tree

Only create these if the product/implementation work needs them. Do not create
empty placeholder specs.

```text
specs/codebase/structures/auth-gateway/README.md

specs/codebase/features/onboarding.md
specs/codebase/features/terminals.md
specs/codebase/features/plugins.md
specs/codebase/features/agent-features/definitions/browser.md
specs/codebase/features/agent-features/definitions/computer-use.md

specs/developing/qa/desktop.md
specs/developing/qa/web.md
specs/developing/qa/mobile.md
specs/developing/qa/cloud-runtime.md
specs/developing/qa/billing.md
specs/developing/qa/release.md
```

## Suggested Template For New Specs

For structure specs:

```markdown
# <System> Standards

Status: authoritative for `<paths>`.

## Scope
## Goal
## Target Shape
## What Goes Where
## Read Order
## Ownership Boundaries
## Dependency Direction
## Hard Rules
## Review Checklist
```

For primitives:

```markdown
# <Primitive>

Status: implementation-ready spec.

## Purpose & Scope
## Mental Model
## Dependencies
## Current Repo State
## Target Model
## Data Model
## API / Wire Contract
## Flows
## Files To Change
## Implementation Chunks
## Acceptance Criteria
## Verification / Tests
## Final Decisions / Deferred Questions
```

For features:

```markdown
# <Feature>

Status: authoritative for <workflow/surface>.

## Purpose
## Scope Map
## Product Model
## State Ownership
## Core Invariants
## End-To-End Flows
## Surface / UI Contract
## Source Ownership
## Tests
## Acceptance
```

For developer-process runbooks:

```markdown
# <Process>

Status: authoritative for <operator task>.

## Read Order
## Operator Requirements
## Tools And Permissions
## Configuration And Secrets
## Happy Path
## Verification
## Failure Handling
## Final Report Shape
```

## Bottom Line

The current spec corpus is strongest where the repo already has hard ownership
boundaries: frontend, server, AnyHarness, Worker, sandbox provisioning, cloud
commands, agent auth, billing, and Product MCP structure.

The main gaps are not lack of overall organization; they are a few missing or
split product concepts:

```text
Auth Gateway as a first-class structure decision
Onboarding has a dedicated product feature read path; deepen it as onboarding UX changes
Browser and computer-use as concrete Product MCP definitions
Terminals as either a product feature spec or an AnyHarness subsystem spec
Workspace creation/provisioning has an easier read path; keep it current as the
deeper owner specs change
Per-surface QA checklists if release QA needs more operational detail
```
