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

Use `make dev PROFILE=<name>` for full-stack local development, especially when
multiple worktrees need to run at the same time. Do not use the default-port
`make dev-runtime`, `make dev-server`, or `make dev-desktop` shortcuts for
multi-worktree testing.

Useful commands:

```bash
make dev-init PROFILE=<name>
make dev-list
make dev PROFILE=<name>
make dev PROFILE=<name> STRIPE=1
```

Profile state lives under
`~/.proliferate-local/dev/profiles/<name>/`; AnyHarness runtime state lives
under `~/.proliferate-local/runtimes/<name>/`. Read
`docs/reference/dev-profiles.md` before changing profile launch behavior,
ports, generated Tauri config, or dev app identity.

## Read This First

Start with `docs/README.md`.

Docs under `docs/**` are authoritative for their area. If this file overlaps
with an area doc, the area doc wins.

You must read the relevant area doc before touching code in that area. Do this
at the start of the task, not halfway through implementation.

## Area Read Order

### Frontend (`desktop/src/**`)

1. `docs/frontend/README.md`
2. The focused frontend doc for the layer being changed:
   - `docs/frontend/guides/components.md`
   - `docs/frontend/guides/hooks.md`
   - `docs/frontend/guides/state.md`
   - `docs/frontend/guides/lib.md`
   - `docs/frontend/guides/access.md`
3. Specialized docs when relevant:
   - `docs/frontend/guides/styling.md` for styling, primitives, tokens, or
     theme usage
   - `docs/frontend/guides/telemetry.md` for analytics, Sentry, replay
     masking, or telemetry payloads
   - `docs/frontend/specs/chat-composer.md` for the composer, composer-adjacent
     panels, workspace review panels/defaults, or Claude plan card
   - `docs/frontend/specs/chat-transcript.md` for transcript streaming,
     replay, transcript row models, or long-history rendering
   - `docs/frontend/specs/workspace-files.md` for workspace file browsing,
     file viewing, diff viewing, Changes, or all-changes review

### SDK (`anyharness/sdk/**`, `anyharness/sdk-react/**`)

1. `docs/sdk/README.md`

### Server (`server/**`)

1. `docs/server/README.md`

### AnyHarness Runtime (`anyharness/crates/**`)

1. `docs/anyharness/README.md`
2. `docs/anyharness/contract.md` if the change touches contract schemas
3. `docs/anyharness/binary.md` if the change touches the binary crate
4. The relevant subsystem doc under `docs/anyharness/src/**` when the change
   touches runtime logic

### CI/CD, Release, And Deployment

Applies to `.github/workflows/**`, `desktop/infra/**`, `server/infra/**`,
updater publishing, and the desktop updater flow.

1. `docs/ci-cd/README.md`

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
- PR titles and labels must follow `docs/ci-cd/README.md`. Use exactly one
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
`docs/ci-cd/README.md` first. That document is the source of truth for desktop
version bumps, `desktop-v*` tags, draft GitHub releases, updater publishing,
release dry runs, and PR release-note metadata.
