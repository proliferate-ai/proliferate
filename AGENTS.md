# Proliferate

Proliferate runs coding agents against real codebases, end to end. This
repository contains the Desktop, Web, and Mobile clients; the hosted control
plane (server); the AnyHarness runtime that executes coding-agent sessions
across harnesses; the supervisor/worker pair that manages targets; and the
model gateway. Clients talk to the server; the server orchestrates sandboxes
and personal targets; the runtime executes sessions; agent LLM traffic flows
through the gateway. [`ARCHITECTURE.md`](ARCHITECTURE.md) explains how the
pieces fit together and why the seams sit where they sit.

This file routes; it never explains. Land here cold, find the ONE doc to read
next, go. Every "touching X → read Y" fact lives here and nowhere else.

## Orientation

| You want to… | Read |
| --- | --- |
| Understand how Proliferate is structured | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| Understand why a decision was made | `adrs/` — `grep 'Description:' adrs/*.md` is the index |
| Understand a cross-plane system deeply | [`specs/FEATURE_DOCS/`](specs/FEATURE_DOCS/) |
| Do something that isn't writing code (release, debug prod, local setup) | [`guides/`](guides/README.md) |
| Understand how the docs system itself works | [`guides/process/docs-system.md`](guides/process/docs-system.md) |

## Build and develop

Runtime baseline: Rust stable, Node 22+, pnpm, Python 3.12, and `uv`.

```bash
cargo build
cargo run --bin anyharness -- serve

(cd anyharness/sdk && pnpm install && pnpm run generate && pnpm run build)
(cd server && uv run pytest -q)
```

Use an isolated profile for full-stack local work, especially across
worktrees:

```bash
make setup PROFILE=<name>
make build
make run PROFILE=<name>
make dev-list
```

Profile state lives under `~/.proliferate-local/dev/profiles/<name>/`; runtime
state lives under `~/.proliferate-local/runtimes/<name>/`. Read
[`guides/local/README.md`](guides/local/README.md) before running a feature
worktree or changing local launch behavior.

## Source router

Use the most specific matching row. When a change crosses areas, read every
applicable owner.

| Source area | Start here |
| --- | --- |
| `apps/desktop/**`, `apps/web/**`, `apps/mobile/**`, `apps/packages/**` | [`specs/frontend/README.md`](specs/frontend/README.md) |
| `apps/desktop/src-tauri/**`, `apps/desktop/src-tauri-debug/**` | [`specs/desktop-native.md`](specs/desktop-native.md) |
| `server/**` | [`specs/server/README.md`](specs/server/README.md) |
| `anyharness/crates/anyharness*/**` | [`specs/anyharness/README.md`](specs/anyharness/README.md) |
| `anyharness/crates/proliferate-worker/**` | [`specs/worker.md`](specs/worker.md) |
| `anyharness/crates/proliferate-supervisor/**`, `install/**` | [`specs/supervisor.md`](specs/supervisor.md) |
| `cloud/sdk/**`, `cloud/sdk-react/**`, `anyharness/sdk/**`, `anyharness/sdk-react/**` | [`specs/sdk.md`](specs/sdk.md) |
| UI: components, styling, tokens, theme | [`specs/DESIGN_SYSTEM.md`](specs/DESIGN_SYSTEM.md) |
| User-facing copy, naming, product feel | [`specs/PRODUCT_SENSE.md`](specs/PRODUCT_SENSE.md) |
| `tests/intent/**`, `tests/release/**`, `anyharness/tests/**`, `fixtures/contracts/**`, `scripts/agent-gateway-smoke/**` | [`specs/TESTING.md`](specs/TESTING.md) |
| Telemetry and scrubber sources in any area (`**/telemetry/**`, `**/telemetry.rs`, `server/proliferate/integrations/sentry/**`, `server/proliferate/middleware/logging.py`), `server/infra/observability/**` | [`specs/OBSERVABILITY.md`](specs/OBSERVABILITY.md) |
| `scripts/check_*`, checker allowlists | Constitution — see [Repository-wide rules](#repository-wide-rules) |
| `adrs/**` — writing or reviewing a decision record | [`guides/process/adrs.md`](guides/process/adrs.md) |
| `AGENTS.md`, `CONTRIBUTING.md`, `.github/pull_request_template.md` | [`guides/process/README.md`](guides/process/README.md) |
| `.github/workflows/**`, `scripts/ci-cd/**`, `apps/desktop/infra/**`, `apps/desktop/scripts/**`, `server/infra/**`, `server/deploy/**` | [`guides/deploying/README.md`](guides/deploying/README.md) |
| `.auth-env/**`, local profiles, local app identity | [`guides/local/README.md`](guides/local/README.md) |
| `specs/GENERATED/**` | Never hand-edit; [`specs/GENERATED/README.md`](specs/GENERATED/README.md) names the regenerate command |

## Cross-plane systems

Touching one of these systems means reading its feature doc first, whatever
source area you are in.

| System | Touching | Read |
| --- | --- | --- |
| Sandbox | sandbox lifecycle/access/content, E2B, sandbox gateway, sandbox GitHub auth | [`specs/FEATURE_DOCS/SANDBOX/`](specs/FEATURE_DOCS/SANDBOX/) |
| Billing | Stripe, meters, credits, plans, webhooks | [`specs/codebase/systems/product/billing/README.md`](specs/codebase/systems/product/billing/README.md) |
| Managed runtime | supervisor/worker convergence, enrollment, runtime updates | [`specs/FEATURE_DOCS/MANAGED_RUNTIME.md`](specs/FEATURE_DOCS/MANAGED_RUNTIME.md) |
| Agent auth | agent credentials, key vault, selections, `state.json` | [`specs/FEATURE_DOCS/AGENT_AUTH.md`](specs/FEATURE_DOCS/AGENT_AUTH.md) |
| Models | `catalogs/**`, `scripts/agent-catalog/**`, model gateway, probes, LiteLLM | [`specs/FEATURE_DOCS/MODELS.md`](specs/FEATURE_DOCS/MODELS.md) |
| Workflows | workflow definitions, invocations, runs, workspace placement | [`specs/FEATURE_DOCS/WORKFLOWS.md`](specs/FEATURE_DOCS/WORKFLOWS.md) |
| Desktop host | web bundle ↔ native shell ↔ sidecar seam | [`specs/FEATURE_DOCS/DESKTOP_HOST.md`](specs/FEATURE_DOCS/DESKTOP_HOST.md) |

## Repository-wide rules

- If it's not current, it's not in this repo: future work lives in PRs, issues,
  and `adrs/`; update docs in the same PR that changes behavior.
- Consider [`specs/TESTING.md`](specs/TESTING.md) and
  [`specs/OBSERVABILITY.md`](specs/OBSERVABILITY.md) in every PR; the PR
  template asks for both sections.
- Constitution: never weaken a lint, add a net-new exception, delete a pinning
  test, or rewrite a normative rule without flagging it in the PR description
  and stopping for founder review. Making CI green by changing the rules is
  never a fix. Carrying an exception fingerprint forward on rename/move is
  legal maintenance.
- Preserve current behavior unless an approved ADR or PR scope changes it.
- Prefer ownership-correct changes over cosmetic churn.
- Do not leave duplicate old and new paths after a migration.
- Use direct imports; do not add convenience barrel or re-export modules.
- Respect generated-code boundaries and regenerate through the owning tool.
- Delete dead code when replacing an implementation.
- Keep the repository buildable and run the narrowest proof that establishes
  the requested behavior.
- Do not use destructive Git commands such as `git reset --hard` or
  `git checkout --` unless the user explicitly requests them.
- Record unrelated defects as follow-ups instead of expanding the current PR.
- Describe our design in our own vocabulary. When another product's UI informs
  a treatment, state what the treatment IS — sizes, colors, roles, states —
  never that it came from that product. No other product's name in comments,
  class names, commit messages, branch names, or pull request text. This is
  about attribution only: names that are real product vocabulary here (`codex`
  as an agent harness, `codex-mini` as a model id, `cursor` as a CSS property
  or an editor target) stay. `python3 scripts/check_design_attribution.py`
  enforces the distinction.

Run `python3 scripts/check_docs.py` after changing repository documentation.

Prepare and mark pull requests ready according to
[`guides/process/pull-requests.md`](guides/process/pull-requests.md).
