# Pipelines — the wiring diagram

Expands: [README.md#2--the-lane-census](README.md#2--the-lane-census)

Seven pipelines, one block each. This document decides nothing —
[testing](../testing/README.md) owns what each block proves and what it
gates; only budgets, triggers, and job/command names live here. **Composes
by citation, never by content.** The census records are the job→pipeline
truth; no table here mirrors them.

```text
## Pipeline — <event>
Budget · Trigger · Green means
Composes: citations + exact job/command names
Enforced by: census rows + checker
Not here: what's excluded, naming the pipeline that owns it
```

## Pipeline — commit

Budget: < 1 s · Trigger: git pre-commit hook · Green means: nothing — it
cannot fail.

Formatters only, on staged files, **auto-fix + restage, never blocks**:
`ruff format` · `cargo fmt` · `biome format --write`. No linting, no
judgment; unformatted code becomes a state that cannot exist in history.
Escape: `PROLIFERATE_SKIP_HOOKS=1`. Installed by `make setup` (worktrees
share `.git/hooks` — one install covers every agent worktree).
Not here: anything that can say no (push's).

## Pipeline — push

`make gate` ※ (in flight). Budget: ≤ 2 min warm · Trigger: pre-push hook, or `make gate` by hand ·
Green means: the merge gate will not embarrass you — same commands, same
verdicts.

Composes, change-scoped by `git diff` vs merge-base(main) + working tree:

```text
always                → the lint engines (repo-shape checkers, ~30s, no deps)
server/**             → ruff check · ruff format --check · mypy ratchet
                        · pytest of the touched domain's tests (-n 2)*
anyharness/**         → cargo fmt --check · clippy -p <touched crates>
                        · nextest -p <touched crates>
apps/** cloud/sdk/**  → tsc for the touched package · its CI-wired vitest
specs/** *.md         → check_docs
```

\* server tests **skip loudly** when local Postgres/Redis are down — never
fail for missing services; CI is authoritative (testing law 10).

Enforced by: **the mirror rule** — every gate command is byte-identical to
a PR-pipeline step; the census marks each PR job gate-mirrored; drift =
census red. Failure output is machine-legible (rule id + the exact re-run
command): the committers are agents — auto-fix beats block, the gate's
value is CI round-trips saved in-context, and bypass is designed against
(never `--no-verify` — [BUILDING.md](../../BUILDING.md) — with CI as the
authority so a bypass is wasteful, never fatal).
Not here: full workspace builds, cross-plane suites, anything staged/live.

## Pipeline — PR (the merge gate)

Budget: ≤ 10 min wall (~6 today) · Trigger: every PR · Green means:
mergeable.

Composes: the merge block entire + all lint engines + bought tools +
CodeQL — `ci.yml` (nextest · SDK · frontend shards · repo-shape ·
terraform · builds) + `server-ci.yml` (ruff · mypy ratchet · unit ·
integration ×3) + CodeQL ×3 + `pr-metadata`; ruled additions: the rust
lint job (fmt + clippy `-D warnings`) · biome `--check` · the three
formerly-hollow vitest suites (desktop · web · `@anyharness/sdk`; mobile
awaits its retire ruling).
Enforced by: the two rollups + drift guards; flakes = quarantine rows,
never skip-comments.
Not here: anything staged or live (nightly/release); change detection
(deferred on record).

## Pipeline — main

main → staging ※ (in flight). Budget: ~15 min to live · Trigger: push:main, green · Green means: staging
IS current main.

**Deploy is not a gate.** Full run + self-host smoke, then staging deploys
immediately — no additional tests; qualification happens *against* staging
afterward (nightly). Staggered latest-wins via concurrency groups; a newer
green supersedes a queued deploy, never one mid-flight. Migrations run
inside the deploy. Deploy failure → Slack. Rollback = re-promote the
previous artifact.
Not here: any test gate (PR's); the battery (nightly's). Supersedes
#2140's inverse doctrine and rewrites its two enforcement tests.

## Pipeline — nightly

※ In flight. Budget: overnight · Trigger: cron ~02:00 PT · Green means: this morning's
promotable-or-not verdict is fresh.

Composes: **the e2e battery against staging**
([release.md](../testing/release.md) — observe mode: red blocks nothing,
it is the morning broken-list) + the slow-but-real set in
`nightly-checks.yml` (the scroll-physics and workflow-canvas qualification
suites · `anyharness/tests` · the release-harness self-check). Reporting:
one Slack digest; red only, never green noise.
Not here: anything that gates a merge.

## Pipeline — release

Shipped artifacts. Budget: shippable any day · Trigger: per release (an honest event cadence,
unlike dispatch-with-no-sunset) · Green means: the candidate set is
qualified.

Composes: the packaged worlds ([release.md](../testing/release.md) —
local-real runtime cells · packaged-upgrade N−1→N · self-host per its
posture ruling) → evidence per cell → candidate promotion
([release-delivery.md](release-delivery.md)). **One artifact base**: extra
qualification on the same candidates staging ran, never a second build.
Red means red — `continue-on-error` only via quarantine rows.
Not here: deployed-surface qualification (nightly-vs-staging owns it).

## Pipeline — prod

Budget: minutes · Trigger: manual promote · Green means: customers run
what staging ran.

**Nothing new runs.** Doors: artifact identity (byte-identical to
staging's — aspirational until artifact handoff lands) + the battery
verdict in observe mode. WHO: Pablo, or an agent instructed per-promote —
never standing. WHEN: the daily digest-then-promote rhythm; demo-critical
fixes same-day after an on-demand battery pass. Rollback inherits promote's
authority. Transitional: the 09:00 UTC prod cron survives until the
staging pipeline + battery stand, then dies in the PR that makes promote
deliberate.
Not here: builds, tests, migrations-as-gate — all upstream.
