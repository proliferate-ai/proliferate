# Forks ADR rung 1b — adapter migration (coordinates, mechanism, gates)

Engineering record for the Forks ADR rung 1 adapter migration (rung 1b
continuation, coordinates resolved 2026-08-16). This directory carries the
repo-side artifacts of the migration; the adapter source changes live in the two
fork repositories (below) and the live catalog pin flip is gated (see §3).

## 1. Resolved coordinates (consumed as git refs, NOT npm)

| Adapter | Canonical source | Canonical ref | Proliferate fork ref | Tag |
| --- | --- | --- | --- | --- |
| Claude | github.com/agentclientprotocol/claude-agent-acp v0.66.0 | `6b405138fc82be947964612fac04e56654827b66` | `proliferate-ai/claude-agent-acp@81a4d52e6bfe8f636d6818c6c48c29be28dca35d` | `v0.66.0-proliferate.1` |
| Codex | github.com/agentclientprotocol/codex-acp v1.1.14 | `5faefec5d55ded33c54b68ffec93def4f6c547f5` | `proliferate-ai/codex-acp@219738c9dd4205d3c70ab950f5f22cc3b28103c4` | `v1.1.14-proliferate.1` |

- Claude fork PR: proliferate-ai/claude-agent-acp#50 (draft).
- Codex fork PR: proliferate-ai/codex-acp#19 (draft, based on a pushed
  `canonical-1.1.14-base` branch because the old Rust `main` shares no history
  with canonical TS — replacement, not rebase, per ADR §4.1(b)).

### What each fork carries (the sanctioned thin deltas)

Claude — canonical 0.66.0 already ships registered `_session/goal` (set/clear),
`_session/steering`, nested subagent transcripts, and `unstable_forkSession`.
The legacy 0.59 fork's goal/loop/transcript deltas are **dropped**. Added:
- **Inclusive fork anchor** on `session/fork` via `_meta.anyharness.upToMessageId`
  → SDK `resumeSessionAt` (resume up to and including this message uuid). Absent
  = tip fork; malformed/unresolvable = hard `invalidParams`, never a silent tip
  fork (ADR §5 cardinal sin). Extends the existing method — no proprietary fork
  RPC — so it is upstreamable; the runtime bridge `_anyharness/fork/at` maps onto
  `session/fork` carrying this meta.
- **Labeled partial `_anyharness/rewindFiles`** — SDK `Query.rewindFiles`,
  Write/Edit/NotebookEdit scope only, gated on opt-in
  `_meta.anyharness.enableFileCheckpointing`. NOT complete restore (that is the
  runtime checkpoint layer, rung 7).
- Both advertised at initialize `_meta.anyharness`.

Codex — canonical 1.1.14 already registers `_session/goal` (full set) and
`_session/steering` (→ App Server `turn/steer`); goals + steering are freebies.
Added: **`session/fork` registration** mapped onto the native App Server
`thread/fork`, anchored inclusive on `lastTurnId` via `_meta.anyharness.lastTurnId`.
Per the pinned 0.147.0 schema (`fixtures/contracts/codex-app-server-schema`, PR
#1982), `lastTurnId` is the ONLY fork anchor — no `beforeTurnId`/`excludeTurns`.

The committed patch `codex-acp-1.1.14+fork-registration.patch` (this directory)
is the `src/` diff canonical→fork: a review artifact and a patch-package
install-time fallback if a consumer prefers canonical-npm + patch over the git
ref.

## 2. Git-ref consumption mechanism

Both forks add a `prepare` build script (`npm run build` / `node build.mjs`) so
`npm install <git-url>#<sha>` builds `dist/` from source on install — the same
mechanism the current Claude catalog pin already relies on. The catalog
`agentProcess.source` becomes `{ kind: "git", repo, gitRef, executableRelpath }`
for Codex (matching Claude's existing shape), replacing the current
`{ kind: "npm" }` Codex pin.

Native bytes are pinned **independently**: canonical codex-acp declares
`@openai/codex ^0.147.0`, so the catalog's `codex.harness.native` must move from
`rust-v0.144.5` to the 0.147.0 archive (sha256 recorded alongside the pinned
schema in `fixtures/contracts/codex-app-server-schema/README.md`).

## 3. Catalog pin flip — GATED (not done in this PR)

The pin flip is gated by TWO validators (ADR rung 1 gate):
- `scripts/validate-agent-catalog.mjs` (JS tripwire), and
- `cargo test` against `catalogs/agents/catalog.json` (include_str!'d;
  `anyharness-lib/.../catalog/validation.rs`).

Both enforce `validateSnapshotEvidence`: every agent's committed probe snapshot
(`scripts/agent-catalog/generated/<kind>.<ctx>.probe.json`) must attest the
EXACT `harness.agentProcess.version` (for git sources attestation is mandatory)
and the EXACT `harness.native.version`. Current snapshots attest
`claude 0.59.0-proliferate.1 / native 2.1.212` and
`codex 0.18.3-proliferate.1 / native 0.144.5`.

**Blocker:** flipping to `0.66.0-proliferate.1` (native 2.1.212 unchanged) and
`1.1.14-proliferate.1` (native 0.147.0) fails both validators until the probe
snapshots are regenerated. Regeneration (`scripts/agent-catalog/build-catalog.mjs`)
**spawns each adapter and records its live initialize attestation + native CLI
version**, which requires real Anthropic / OpenAI auth and the ability to boot
the adapters — neither available in this delegated environment. This is the same
class of live-auth gate as the ADR's Tier-3 proofs.

To complete the flip (follow-up, on a box with real auth):
1. `npm install` each fork by its git ref above; confirm `dist/` builds.
2. Regenerate probe snapshots via `build-catalog.mjs` against real auth for each
   auth context (anthropic-api/oauth/bedrock; openai-api/oauth/bedrock).
3. Update `catalog.json` + `catalog.draft.json`: Claude `agentProcess` git
   ref/version; Codex `agentProcess.source` → git + new native 0.147.0 archive.
4. `node scripts/validate-agent-catalog.mjs` and the catalog `cargo test` (obey
   the one-cargo-build-at-a-time machine rule) must both pass.
5. Revert path: restore the previous catalog pins (all five old artifacts are
   unchanged and restorable).

## 4. Session adapter-migration markers + dual-read (ADR R9) — DESIGN

Deferred to a dedicated Rust slice (independently reviewable; not landed here to
avoid an unverifiable Rust change — this environment cannot safely build the
runtime, and a sibling agent holds the one-cargo-build slot). The contract:

- **Migration marker** on each session recording the `(adapterVersion,
  nativeVersion)` pair it was created under, stamped at session create/load, so a
  session created against the pinned pre-migration adapter is distinguishable
  from a canonical-migrated one at reattach.
- **Dual-read** of legacy metadata dialects: sessions created by the old Claude
  (0.59 fork) and old Codex (Rust 0.18.3 fork) adapters must load through an
  EXPLICIT compatible path OR fail with an actionable, typed incompatibility —
  never a silent reinterpretation under the new dialect (R9). The goals membrane
  (rung 6) versions both GoalPort dialects; the session store versions the
  transcript/metadata read. Durable normalized `session_events` remain readable
  regardless (runtime-owned).
- **Test (Tier 2 fixture):** legacy Claude/Codex session metadata blobs loaded
  under the new adapters assert explicit compatible-load or typed
  incompatibility; a regression pin proves durable transcripts still render.

## 5. JS ACP SDK 1.3.0 vs pinned Rust ACP client — QUALIFICATION

Both canonical adapters declare **`@agentclientprotocol/sdk@1.3.0`** (Claude:
exact `1.3.0`; Codex: `^1.3.0`, lockfile resolves 1.3.0). The runtime speaks ACP
via its pinned **Rust** ACP client. Qualification findings:

- **Stable v1 wire is the contract.** Both adapters register their handlers
  against `acp.methods.agent.*` (the stable v1 method table). The Rust client
  targets the same v1 method names; no v2/Draft methods are on the load-bearing
  path for rung 1 (fork/steer/goal all ride v1 + `_meta` extensions).
- **`session/fork` is `unstable_`-prefixed in the SDK** (`unstable_forkSession`)
  but wired to the stable `session/fork` method spelling; the Rust client
  dispatches by method string, so the prefix is a JS-side naming detail, not a
  wire difference.
- **Extension methods** (`_session/steering`, `_session/goal`,
  `_anyharness/rewindFiles`) are custom `_`-prefixed requests carried over the
  same JSON-RPC framing; the Rust client's ext-request path handles them by
  method string. Capability discovery is via initialize `_meta` (never inferred
  from harness name).
- **Open qualification item (needs live cross-process spawn):** confirm the Rust
  client parses SDK 1.3.0's `ForkSessionResponse` / initialize `_meta` shapes
  end-to-end and that no framing/line-buffer regression exists between the
  pinned Rust client and SDK 1.3.0's ndjson writer. This is a Tier-3 spawn test,
  not a known break — the SDK 1.3.0 wire is v1-compatible by inspection.

## Scope note

This PR carries the repo-side migration artifacts and does NOT flip the live
catalog pin (§3 blocker) or land the Rust session-marker/dual-read slice (§4,
separate reviewable slice). The two adapter forks are pushed as draft PRs. No
merges without Pablo's review.
