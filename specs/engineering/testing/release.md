# Release — the worlds datasheet

Expands: [README.md#4--the-worlds](README.md#4--the-worlds)

What the heavy tests ARE, human-legibly: the worlds, what is real in each,
and the evidence they produce. This document never schedules — when worlds
run is [ci-cd/pipelines.md](../ci-cd/pipelines.md)'s. It also never
enumerates scenario cells: the registry
([tests/release/src/scenarios/registry.ts](../../../tests/release/src/scenarios/registry.ts))
and the manifest
([tests/release/core-release-scenario-manifest.json](../../../tests/release/core-release-scenario-manifest.json))
are the cell list; a scenario either runs and produces evidence or it does
not exist here. The four absorbed contracts (validation, worlds-and-fixtures,
the tier-3/4 scenario contracts) and the desktop-update and self-hosting
notes are archived at
[delivery/testing-cicd/archive/](../../../delivery/testing-cicd/archive/)
for mechanism history.

## 1 · Purpose

Answers **may this ship?** — the only tests where everything is real.
Output contract: **evidence JSON per scenario cell** (scenario id · world ·
observables · verdict; schema lives with the runner in `tests/release/`),
consumed by the release train ([ci-cd](../ci-cd/release-delivery.md)) and,
target, by runs-triage.

## 2 · What an e2e scenario is

Ruled 2026-08-26.

- **One user journey through the product's real surfaces, asserting
  outcomes, never transcripts** (testing law 7).
- **The spine journey is desktop** — launch the desktop app configured
  against the staging control plane → login → create session → prompt →
  the **local runtime** runs the agent → the artifact appears. That is
  literally the demo path: desktop + staging CP + local runtime.
  Mechanism ranked at build time: the runner's existing desktop
  product-host path → Linux + xvfb `tauri-driver` in CI → a scripted local
  macOS pass as interim (`tauri-driver` has no macOS support).
- **Everything else is API-driven** (org/invite · github · billing ·
  worker-enroll · integrations · session-run) — stabler, no browser flake.
  Web gets one thin smoke (loads + login) in the body.
- **Agents in e2e**: real LLM, cheapest capable model, a **hard per-run
  budget** so a wedged agent cannot burn credits overnight.
- Anatomy of a scenario: id + journey name · world required · seed and
  fixtures · observables recorded as evidence · cleanup.
- **The growth law: fixing a system adds its journey to the battery in the
  same PR.** The battery is the demand ledger; it lives in the registry,
  not in prose.
- **Observe mode first (ruled).** Nightly battery vs staging plus an
  on-demand run before any promote; **red blocks nothing** — it produces
  the *known-broken list*, the morning triage queue, delivered as one
  Slack digest ("battery 5/7 green; red: …"), never per-failure alerts.
  "Battery green = prod door" is a later deliberate flip once the battery
  is stable; until then prod's door is Pablo's judgment with the
  broken-list in hand.

## 3 · The worlds

A world is a **setup contract**: what is real in it, the credentials it
needs, how it is provisioned and torn down. Adding a world is a change to
this spec. The ruled split: **deployed surfaces ride staging; shipped
artifacts ride the packaged worlds** — with one artifact base underneath
(built once per green main; see
[ci-cd/README.md](../ci-cd/README.md)).

| World | What's real | Honest state (2026-08-26) |
| --- | --- | --- |
| **staging** | THE standing e2e world for everything that deploys — the full composition: API · web · worker · a desktop build on a staging update channel (channel existence to verify at build time); the staging ECS stack, real LLM via the staging gateway, Stripe test mode. Continuously current (green main auto-deploys, #2269); the battery runs against it nightly + pre-promote; its verdict is prod's door (observe mode first). Seeding: `tests/release/scripts/staging_session_seed.py` (in-VPC one-off). | auto-deploy live (#2269); the e2e session credential rotted (no rotation write-back — being rebuilt); lane was masked by `continue-on-error` (being stripped); no background plane on staging yet |
| **local-real** | real LLM + sandbox on a local runtime — qualifies runtime cells staging cannot | today's genuinely working battery |
| **packaged-upgrade** | exact shipped artifacts: desktop clean install + N−1→N signed update, runtime upgrade through Worker mailbox + Supervisor activation | cells partially manual; mechanism notes archived |
| **self-host** | compose install from scratch on a fresh box | posture ruling open (rec: parked — smoke stays on push:main); retired T3-SH-1 references deleted |

**Deleted, on record:** the managed-cloud world's lane was fiction — five
missing files/CLIs, two unregistered scenarios — removed 2026-08 (#2253);
a real managed-cloud world returns behind the environments ruling.

## 4 · Fixtures & evidence

Fixtures are **retained real artifacts + candidate handles** — exact
shipped packages, seeded durable users, provider material — owned by the
runner (`tests/release/src/fixtures/`, `tests/release/retained-releases/`);
details live with the fixtures, not here. Evidence is one JSON per
scenario cell; the manifest ↔ registry parity test
(`scripts/ci-cd/core-release-scenario-manifest.test.mjs`) keeps the
guarantee inventory honest.

## 5 · Manual QA

The manual procedure is a runbook, not a datasheet:
[guides/deploying/manual-release-qa.md](../../../guides/deploying/manual-release-qa.md),
invoked by the release pipeline.

## Decisions

> [!decision] PABLO DECIDES: the self-host battery posture — parked-but-kept
> (rec) vs first-class world vs culled.

> [!decision] PABLO DECIDES: which world must be green for Thursday's demo
> — one sentence (local-real presumably, since the spine's runtime is
> local).

## Known gaps

- [ ] The staging battery is being rebuilt (credential write-back, env
      mapping, unmasking, nightly cadence — frozen as
      [delivery-spec-e2e-observable.md](../../../delivery/testing-cicd/delivery-spec-e2e-observable.md)).
- [ ] The desktop spine journey's mechanism is unverified (ranked options
      above); built after the battery stands.
- [ ] Packaged-upgrade cells are partially manual.
- [ ] Evidence is not yet consumed by runs-triage (target).
