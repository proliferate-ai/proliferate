# Proliferate

Proliferate runs coding agents against real codebases, end to end. This
repository contains the Desktop, Web, and Mobile clients; the hosted control
plane (server); the AnyHarness runtime that executes coding-agent sessions
across harnesses; the supervisor/worker pair that manages execution targets;
and the model gateway. Clients talk to the server; the server orchestrates
cloud sandboxes; the runtime executes sessions (in a sandbox, or as the
desktop app's local sidecar); agent LLM traffic flows through the gateway.
[`ARCHITECTURE.md`](specs/ARCHITECTURE.md) explains how the pieces fit together and
why the seams sit where they sit.

This file routes; it never explains. Land here cold, find the ONE doc to read
next, go. Every "touching X → read Y" fact lives here and nowhere else.

## Orientation

| You want to… | Read |
| --- | --- |
| Understand how Proliferate is structured | [`ARCHITECTURE.md`](specs/ARCHITECTURE.md) |
| Find the system that owns a behavior (product, runtime, or engineering) | [`specs/README.md`](specs/README.md#system-index) — one line per system spec |
| Understand why a decision was made | `adrs/` — `grep 'Description:' adrs/*.md` is the index |
| Read a depth reference behind a system spec | the depth files beside that spec's `README.md` in [`specs/systems/<name>/`](specs/README.md#system-index) — depth only; the README is the authority |
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
applicable owner. Area docs own source layout and dependency direction; the
system spec (next section) owns the behavior.

| Source area | Start here |
| --- | --- |
| `apps/desktop/**`, `apps/web/**`, `apps/mobile/**`, `apps/packages/**` | [`specs/areas/frontend.md`](specs/areas/frontend.md) |
| `apps/desktop/src-tauri/**`, `apps/desktop/src-tauri-debug/**` | [`specs/systems/desktop-host/desktop-native.md`](specs/systems/desktop-host/desktop-native.md) |
| `server/**` | [`specs/areas/server.md`](specs/areas/server.md) |
| `anyharness/crates/anyharness*/**` | [`specs/areas/anyharness.md`](specs/areas/anyharness.md) |
| `anyharness/crates/proliferate-worker/**` | [`specs/areas/anyharness.md`](specs/areas/anyharness.md) (worker section) |
| `anyharness/crates/proliferate-supervisor/**`, `install/**` | [`specs/areas/anyharness.md`](specs/areas/anyharness.md) (supervisor section) |
| `cloud/sdk/**`, `cloud/sdk-react/**`, `anyharness/sdk/**`, `anyharness/sdk-react/**` | [`specs/areas/frontend.md`](specs/areas/frontend.md) (SDK section) |
| UI: components, styling, tokens, theme | [`specs/DESIGN_SYSTEM.md`](specs/DESIGN_SYSTEM.md) |
| User-facing copy, naming, product feel | [`specs/product-sense.md`](specs/product-sense.md) |
| `tests/release/**`, `anyharness/tests/**`, `fixtures/contracts/**`, `scripts/agent-gateway-smoke/**` | [`specs/engineering/testing/README.md`](specs/engineering/testing/README.md) |
| Telemetry and scrubber sources in any area (`**/telemetry/**`, `**/telemetry.rs`, `server/proliferate/integrations/sentry/**`, `server/proliferate/middleware/logging.py`), `server/infra/observability/**` | [`specs/engineering/observability/standard.md`](specs/engineering/observability/standard.md) |
| `scripts/check_*`, `lints/**`, `MANIFEST.toml` files, checker allowlists and ratchets | Constitution — see [Repository-wide rules](#repository-wide-rules) |
| `adrs/**` — writing or reviewing a decision record | [`guides/process/adrs.md`](guides/process/adrs.md) |
| `AGENTS.md`, `CONTRIBUTING.md`, `.github/pull_request_template.md` | [`guides/process/README.md`](guides/process/README.md) |
| `.github/workflows/**`, `scripts/ci-cd/**`, `apps/desktop/infra/**`, `apps/desktop/scripts/**`, `server/infra/**`, `server/deploy/**` | [`guides/deploying/README.md`](guides/deploying/README.md) and [`specs/engineering/ci-cd/release-delivery.md`](specs/engineering/ci-cd/release-delivery.md) |
| `.auth-env/**`, local profiles, local app identity | [`guides/local/README.md`](guides/local/README.md) |
| `delivery/**` | Frozen delivery specs; never edited after freeze except for a founder re-ruling — [`specs/README.md`](specs/README.md#authority) |
| `specs/areas/anyharness-db-schema.sql` and other generated references | Never hand-edit; the owning area doc names the regenerate command — [`specs/areas/anyharness.md`](specs/areas/anyharness.md) |

## Systems

Every source file belongs to exactly one system spec's code map, and a change
is filed against the spec that owns the code, not the surface that discovered
it. The complete index is [`specs/README.md`](specs/README.md#system-index);
the rows below are the ones whose code is spread across planes, so the
matching path alone would not have sent you there.

| System | Touching | Read |
| --- | --- | --- |
| Environments | sandbox provisioning, lifecycle, E2B, templates, usage fencing, sandbox GitHub auth, the sandbox gateway | [`specs/systems/environments/README.md`](specs/systems/environments/README.md) (archaeology of the deleted sandbox stack: its salvage notes) |
| Seam | worker enrollment, identity, heartbeat; courier and event shipping | [`specs/systems/environments/seam.md`](specs/systems/environments/seam.md) |
| Sessions | the runtime event log and its invariants; the control-plane session row and bindings | [`specs/systems/sessions/README.md`](specs/systems/sessions/README.md) |
| Managed runtime | supervisor/worker convergence, install layout, runtime updates | [`specs/systems/harnesses/managed-runtime.md`](specs/systems/harnesses/managed-runtime.md) |
| Agent auth | agent credentials, key vault, selections, `state.json` | [`specs/systems/agent_auth/README.md`](specs/systems/agent_auth/README.md)  |
| Harnesses and models | `catalogs/**`, `scripts/agent-catalog/**`, probes, launch options, readiness | [`specs/systems/harnesses/README.md`](specs/systems/harnesses/README.md) and [`specs/systems/harnesses/launch-options.md`](specs/systems/harnesses/launch-options.md) |
| Model gateway | `server/proliferate/server/ai_gateway/**`, `server/litellm/**`, `server/proliferate/server/ai_magic/**` | [`specs/systems/ai_gateway/README.md`](specs/systems/ai_gateway/README.md) |
| Integration gateway | `server/proliferate/server/integration_gateway/**`, `db/models/integration*.py`, `db/models/cloud/integration_approvals.py`, `db/store/integrations/**` | [`specs/systems/integration_gateway/README.md`](specs/systems/integration_gateway/README.md) |
| GitHub | `server/proliferate/server/github/**`, `db/models/github_app.py`, `db/store/github_app.py`, `integrations/github/**` | [`specs/systems/github/README.md`](specs/systems/github/README.md) |
| Billing | Stripe, meters, credits, plans, webhooks | [`specs/systems/billing/README.md`](specs/systems/billing/README.md) |
| Automations | workflow definitions, invocations, runs, placement, the trigger courier | [`specs/systems/automations/README.md`](specs/systems/automations/README.md) |
| Subagents | the Workspace product MCP, delegated child sessions, completion delivery | [`specs/systems/subagents/README.md`](specs/systems/subagents/README.md) |
| Desktop host | web bundle ↔ native shell ↔ sidecar seam | [`specs/systems/desktop-host/README.md`](specs/systems/desktop-host/README.md) (depth: [`specs/systems/desktop-host/deep-dive.md`](specs/systems/desktop-host/deep-dive.md)) |
| Support | in-product report capture, redaction, storage, the Slack receipt | [`specs/systems/support/README.md`](specs/systems/support/README.md) |

Engineering systems (testing, observability, alerting, the building loop, the
customer loop) are cross-cutting: they own no product state and consume every
product spec's `Emits` and `Proof` sections. Their specs live under
`specs/engineering/<name>/README.md`; the per-PR standards are
[`specs/engineering/testing/README.md`](specs/engineering/testing/README.md) and
[`specs/engineering/observability/standard.md`](specs/engineering/observability/standard.md).

## Repository-wide rules

- If it's not current, it's not in this repo: future work lives in PRs, issues,
  and `adrs/`; update docs in the same PR that changes behavior.
- Consider [`specs/engineering/testing/README.md`](specs/engineering/testing/README.md) and
  [`specs/engineering/observability/standard.md`](specs/engineering/observability/standard.md) in every PR; the PR
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
