# Proliferate

Proliferate is the product repo for the desktop app, cloud control plane, and
AnyHarness runtime stack used to run coding-agent sessions.

AnyHarness is the focused agent runtime. It exposes HTTP + SSE APIs for
workspace management, session orchestration, transcript streaming, and tool
execution.

- Repo: <https://github.com/proliferate-ai/proliferate>

## Build And Dev

Runtime baseline: Rust stable, Node 22+, pnpm, Python 3.12, and `uv` for the
server.

```bash
# Runtime
cargo build
cargo run -- serve

# Core SDK
cd anyharness/sdk
pnpm install
pnpm run generate
pnpm run build

# Server
cd server
uv run pytest -q
```

## Local Full-Stack Profiles

Use `make setup PROFILE=<name>` and `make run PROFILE=<name>` for full-stack
local development, especially when multiple worktrees need to run at the same
time. Do not use the default-port
`make dev-runtime`, `make dev-server`, or `make dev-desktop` shortcuts for
multi-worktree testing.

Useful commands:

```bash
make setup PROFILE=<name>
make build # first clean worktree, or after generated/Rust/frontend artifacts change
make dev-list
make run PROFILE=<name>
make run PROFILE=<name> STRIPE=1
```

Profile state lives under
`~/.proliferate-local/dev/profiles/<name>/`; AnyHarness runtime state lives
under `~/.proliferate-local/runtimes/<name>/`. Read
`specs/developing/local/dev-profiles.md` before changing profile launch behavior,
ports, generated Tauri config, or dev app identity.

## Read This First

Start with `specs/README.md`.

Specs under `specs/**` are authoritative for their area. If this file overlaps
with an area spec, the area spec wins.

You must read the relevant area doc before touching code in that area. Do this
at the start of the task, not halfway through implementation.

## Area Read Order

### Frontend (`apps/desktop/src/**`, `apps/web/src/**`, `apps/mobile/src/**`, `apps/packages/**`)

1. `specs/codebase/structures/frontend/README.md`
2. The focused frontend doc for the layer being changed:
   - `specs/codebase/structures/frontend/guides/components.md`
   - `specs/codebase/structures/frontend/guides/hooks.md`
   - `specs/codebase/structures/frontend/guides/state.md`
   - `specs/codebase/structures/frontend/guides/lib.md`
   - `specs/codebase/structures/frontend/guides/config.md`
   - `specs/codebase/structures/frontend/guides/copy.md`
   - `specs/codebase/structures/frontend/guides/access.md`
   - `specs/codebase/structures/frontend/packages/README.md` for shared frontend packages, package
     dependency direction, shared product rules, product UI, or connected
     product surfaces
3. Specialized docs when relevant:
   - `specs/codebase/structures/frontend/guides/styling.md` for styling, primitives, tokens, or
     theme usage
   - `specs/codebase/structures/frontend/guides/telemetry.md` for analytics, Sentry, replay
     masking, or telemetry payloads
   - `specs/codebase/features/chat-composer.md` for the composer, composer-adjacent
     panels, workspace review panels/defaults, or Claude plan card
   - `specs/codebase/features/chat-transcript.md` for transcript streaming,
     replay, transcript row models, or long-history rendering
   - `specs/codebase/features/pending-workspace-shell.md` for pending workspace
     entry, projected session shell, optimistic prompts, or
     workspace/session materialization handoff
   - `specs/codebase/features/desktop-updates.md` for updater checks,
     download/restart UX, version-aware release notices, or release-notice
     acknowledgment
   - `specs/codebase/features/workspace-files.md` for workspace file browsing,
     file viewing, diff viewing, Changes, or all-changes review

### SDK (`anyharness/sdk/**`, `anyharness/sdk-react/**`)

1. `specs/codebase/structures/sdk/README.md`

### Desktop Native (`apps/desktop/src-tauri/**`)

1. `specs/codebase/structures/desktop-native/README.md`
2. The focused desktop native spec when relevant:
   - `specs/codebase/structures/desktop-native/specs/anyharness-sidecar.md` for AnyHarness sidecar
     packaging, lookup, launch, health, restart, or runtime-info behavior
   - `specs/codebase/structures/desktop-native/specs/agent-seeds.md` for bundled agent seed resources,
     launch env, hydration, ownership state, or seed/reconcile interaction
3. `specs/developing/local/dev-profiles.md` when changing profile launch behavior,
   ports, generated Tauri config, app identity, or profile runtime homes.
4. `specs/developing/deploying/ci-cd.md` when changing packaging, release, updater, or
   bundled desktop resources.

### Server (`server/**`)

1. `specs/codebase/structures/server/README.md`

### Proliferate Worker (`anyharness/crates/proliferate-worker/**`)

1. `specs/codebase/structures/proliferate-worker/README.md`

### Proliferate Supervisor (`anyharness/crates/proliferate-supervisor/**`)

1. `specs/codebase/structures/proliferate-supervisor/README.md`
2. `install/README.md` when changing SSH installer config, service generation,
   target install layout, or target smoke-test behavior.
3. `specs/codebase/structures/server/README.md` when changing managed-cloud bootstrap
   code that writes supervisor config or launches supervisor.

### AnyHarness Runtime

Applies to `anyharness/crates/anyharness/**`,
`anyharness/crates/anyharness-lib/**`,
`anyharness/crates/anyharness-contract/**`, and
`anyharness/crates/anyharness-credential-discovery/**`.

1. `specs/codebase/structures/anyharness/README.md`
2. The focused guide under `specs/codebase/structures/anyharness/guides/**` for the layer being
   changed, such as API, domains, live runtime, adapters, integrations,
   harnesses, persistence, observability, repo shape, or crate ownership.
3. The focused spec under `specs/codebase/structures/anyharness/specs/**` when changing a covered
   subsystem such as the session actor or session engine.
4. `specs/codebase/primitives/mcp-runtime.md` for MCP runtime behavior, and
   `specs/codebase/features/agent-features/servers.md` for product MCP server behavior.
5. `specs/codebase/structures/anyharness/contract.md` if the change touches contract schemas.
6. The relevant legacy subsystem doc under `specs/codebase/structures/anyharness/src/**` when the
   change touches runtime logic not yet covered by a newer guide or spec.

### CI/CD, Release, And Deployment

Applies to `.github/workflows/**`, `apps/desktop/infra/**`, `server/infra/**`,
updater publishing, and the desktop updater flow.

1. `specs/developing/deploying/ci-cd.md`
2. `specs/codebase/features/desktop-updates.md` when changing updater manifest
   metadata or in-app updater/release-notice behavior.

If a release or deployment change also touches frontend, server, SDK, or
AnyHarness code, read the relevant area doc too.

## Repo-Wide Rules

- Read the relevant area doc before editing code in that area.
- Preserve current behavior unless an explicit behavior change is requested.
- Prefer ownership-correct extractions over cosmetic churn.
- Do not leave duplicate old and new code paths behind after a migration.
- Keep the repo buildable and run targeted verification when feasible.
- Follow area docs before inventing new folders, layers, or patterns.
- Use direct imports. Do not add barrel files or convenience re-export modules.
- Respect generated-code boundaries. Regenerate generated code with the owning
  tool rather than hand-editing generated output.
- Delete dead code when replacing an implementation.
- Do not use destructive git commands such as `git reset --hard` or
  `git checkout --` unless the user explicitly asks for that operation.
- PR titles and labels must follow `specs/developing/deploying/ci-cd.md`. Use exactly one
  `release:*` label and at least one `area:*` label before marking a PR ready
  for review.

## Architecture Rules

These are repo-level invariants. Area docs explain the concrete folder rules.

- Components render UI.
- Hooks own React behavior, effects, query/mutation wiring, and UI-facing
  orchestration.
- Stores hold shared client state. They are not service layers or remote data
  caches.
- Providers define scoped dependencies and app boundaries. They are not a
  general replacement for stores.
- Pure product rules live outside React. Do not bury reusable business logic
  inside components or giant hooks.
- Raw external access belongs behind the owning access/platform boundary.
  Product components should not construct clients or call raw endpoint paths.
- Server, SDK, AnyHarness, desktop, and CI/CD ownership rules are separate.
  Do not copy patterns across those areas without checking the area docs.

## Desktop Release Procedure

If you are releasing a new version of the product, read
`specs/developing/deploying/ci-cd.md` first. That document is the source of truth for desktop
version bumps, `desktop-v*` tags, draft GitHub releases, updater publishing,
release dry runs, and PR release-note metadata.
