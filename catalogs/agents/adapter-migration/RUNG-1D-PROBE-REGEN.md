# Forks ADR rung 1d — catalog pin flip via live probe regeneration

Engineering record for the authorized rung-1d attempt to flip the Claude and
Codex catalog pins to the rung-1b fork commits by regenerating probe evidence
against live auth. Investigation dated 2026-08-16. **The flip is NOT landed in
this PR** — two concrete blockers below make a *qualified* flip impossible in
the delegated environment without a decision this agent may not make
unilaterally (fail-closed per the rung-1d brief).

## Target of the flip

| Agent | From (current pin) | To (rung-1b fork commit) |
| --- | --- | --- |
| Claude `agentProcess` | git `26f9ee7a…` v`0.59.0-proliferate.1` | git `81a4d52e6bfe8f636d6818c6c48c29be28dca35d` v`0.66.0-proliferate.1` |
| Claude `native` | `2.1.212` | `2.1.212` (unchanged) |
| Codex `agentProcess` | **npm** `@proliferate-ai/codex-acp@0.18.3-proliferate.1` | **git** `219738c9dd4205d3c70ab950f5f22cc3b28103c4` v`1.1.14-proliferate.1` |
| Codex `native` | archive `rust-v0.144.5` | archive `0.147.0` (independently hashed) |

## What was VERIFIED available (live-auth gate is satisfiable)

Contrary to the earlier §3 assessment in `RUNG-1B-NOTES.md`, every credential
the probe matrix requires IS present on this box:

- `.probe-secrets.env` exists at the main checkout (`/Users/pablohansen/proliferate/.probe-secrets.env`)
  and defines `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`,
  `AWS_BEARER_TOKEN_BEDROCK`, `OPENAI_API_KEY` (+ gemini/opencode/cursor).
- Codex OAuth `~/.codex/auth.json` is present.
- That covers all six required contexts for the two-agent flip:
  `claude.{anthropic-api,anthropic-oauth,bedrock}` and
  `codex.{openai-api,openai-oauth,bedrock}`.

So the *auth* half of the gate is no longer the blocker. The blockers are below.

## BLOCKER 1 (dominant) — probe regen is NOT node-only; it requires a local Rust runtime build

`scripts/agent-catalog/run-probes.sh` is the only probe generator. It is not a
node-only adapter spawner. Its authoritative path:

1. `node resolve-pins.mjs` (node — OK),
2. **`(cd anyharness && cargo build -q -p anyharness)`** — a full runtime build,
   unconditional (`|| exit 1`),
3. `"$ROOT/target/debug/anyharness" install-agents …`,
4. `"$ROOT/target/debug/anyharness" catalog-probe --agent … --auth-context …` —
   the adapters are spawned **by the compiled Rust runtime's ACP client**, and
   the stock script backgrounds the per-context probes (runs them in parallel).

This contradicts rung-1d binding condition #1 ("Node-only spawns, SEQUENTIAL —
one adapter at a time") on two counts: (a) it mandates a local anyharness Rust
build, and (b) the stock runner is parallel, not sequential. There is no
node-only probe path — by design, the probe exercises the real Rust-client ↔
adapter handshake (this is also exactly open qualification item (e) from
`RUNG-1B-NOTES.md §5`).

`target/debug/anyharness` does not exist in this worktree; the only prebuilt is
the shared `~/.proliferate-local/dev/runtime-bin/anyharness` dated 2026-07-28 —
too stale to trust for evidence-only-green (a stale host client risks a false
pass/fail against SDK 1.3.0 adapters, which would violate condition #2).

Machine-limit conflict: building anyharness is one of the heaviest operations on
this box, and it is currently swap-stressed (~1.2 GB swap free of 14 GB, deep in
use). Pablo's hard limit — "RAM is the ceiling; this machine has OOM/swap-died
from builds" — plus "do NOT build the Rust runtime for work that doesn't change
Rust" make an unilateral local build the wrong call, especially with a sibling
rung-2 merge-train agent sharing the box. Held pending an explicit go/no-go.

## BLOCKER 2 — codex native 0.147.0 archive hashes are not in the archive-target shape

Condition #3 says the `rust-v0.144.5 → 0.147.0` native move can ride the flip
because "sha256 already in the merged fixture README". The fixture
(`fixtures/contracts/codex-app-server-schema/README.md`) records exactly ONE
sha256: `19c4f144c5226a9f17c58e6f0fa854843b0f77a6eb420f40e2745a12f10f5d37` for
the **locally-extracted aarch64 binary** at
`~/.codex/packages/standalone/releases/0.147.0-aarch64-apple-darwin/bin/codex`.

The catalog `native.source` needs the release **archive** (`.tar.gz`) shape:
per-target `url` + `sha256` + `downloadSizeBytes` for `macos_arm64`,
`macos_x64`, `linux_x64` (as the current `rust-v0.144.5` pin carries). The
single extracted-binary sha does not supply any of the three archive shas. These
must be obtained by hashing the published 0.147.0 release archives (a node/curl
step, doable, but the release tag/URL scheme for 0.147.0 must be confirmed — the
0.144.5 pin used the `openai/codex@rust-v0.144.5` release assets).

## Evidence gathered node-only (zero machine risk)

Baseline validator on the untouched tree:

```
$ node scripts/validate-agent-catalog.mjs
agent catalog OK: 2026-08-15.1 (5 agents)        # exit 0
```

**Negative control** (scratch copy of catalog+probes in /tmp, never committed):
tampering one probe's `attestation.version` `0.59.0-proliferate.1` →
`…-proliferate.STALE` makes the validator fail closed:

```
agent catalog validation failed: claude: probe snapshot
'generated/claude.anthropic-api.probe.json' attests process version
'0.59.0-proliferate.STALE', expected '0.59.0-proliferate.1'      # exit 1
```

**Flip-without-probes** (same scratch): bumping the Claude pin to
`0.66.0-proliferate.1 @ 81a4d52e` in `catalog.json` + `catalog.draft.json`
while the committed probes still attest `0.59.0-proliferate.1` is rejected for
every Claude context:

```
agent catalog validation failed: claude: probe snapshot
'generated/claude.anthropic-api.probe.json' attests process version
'0.59.0-proliferate.1', expected '0.66.0-proliferate.1'
… (same for anthropic-oauth, bedrock)            # exit non-zero
```

This is the proof that the flip **cannot** land without genuinely regenerated
probes — the gate works, and short-circuiting it (hand-editing attestations)
is exactly what condition #2 forbids.

## Completion recipe (once BLOCKER 1 is authorized on a safe box)

1. Wait for the cargo slot: `pgrep -x cargo; pgrep -x rustc` empty; pressure < 3.
2. `source /Users/pablohansen/proliferate/.probe-secrets.env` (or point
   `.probe-secrets.env` into this worktree root).
3. Resolve BLOCKER 2: fetch the three 0.147.0 release archives, sha256 them,
   record `url`/`sha256`/`downloadSizeBytes` per target.
4. `bash scripts/agent-catalog/run-probes.sh --agent claude,codex` — this builds
   anyharness, installs the resolved pins, and regenerates the six probe
   snapshots against live auth. Run sequentially if honoring condition #1
   (invoke `catalog-probe` per context rather than the parallel stock loop).
5. Flip the two `agentProcess` pins + codex `native` archive in `catalog.json`
   AND `scripts/agent-catalog/catalog.draft.json` (they must match exactly).
6. `node scripts/validate-agent-catalog.mjs` must print `agent catalog OK`.
7. Push; the CI cargo lane (`Cargo check & test`, catalog.json is
   `include_str!`'d) is the authoritative second gate.

Revert path: the pre-flip pins above are all restorable — restore
`agentProcess.version`/`source` and `native` for both agents to the "From"
column and re-run the validator.

---

## AS-RUN (2026-08-16, rung-1d GO grant) — supersedes the fail-closed status above

The orchestrator ratified the amendment voiding the "node-only" condition and
authorized the live probe regeneration. Under that grant:

### BLOCKER 2 — RESOLVED and cross-verified (node/shell only, no build)

The codex native `rust-v0.144.5 → 0.147.0` archive move is fully resolved. The
official release is `openai/codex@rust-v0.147.0`; the three assets match the
current pin's naming exactly. Downloaded and hashed locally:

| Target | Asset | downloadSizeBytes | sha256 |
| --- | --- | --- | --- |
| macos_arm64 | `codex-aarch64-apple-darwin.tar.gz` | 87984231 | `75984b81f92a71b0c0f4b3b5cad80e5c57177e4d8c8b4b1e13db703b20dc4358` |
| macos_x64 | `codex-x86_64-apple-darwin.tar.gz` | 95851149 | `36e782f71d8164cc37c2b89c64948f2180e9a2f8456b27e660da75bc6b5574e2` |
| linux_x64 | `codex-x86_64-unknown-linux-musl.tar.gz` | 98970270 | `0246e2e773834e07f0fb5249ed6ebad12e4591e608f8c7bb97dd6a9690544c36` |

URL scheme: `https://github.com/openai/codex/releases/download/rust-v0.147.0/<asset>`.
Authenticity cross-check: extracting the aarch64 archive and hashing its inner
`codex-aarch64-apple-darwin` binary yields
`19c4f144c5226a9f17c58e6f0fa854843b0f77a6eb420f40e2745a12f10f5d37`, an EXACT
match to the fixture README's attested 0.147.0 aarch64 binary — so the archive
is the genuine 0.147.0 build. `expectedBinary` for the two darwin/linux targets
follows the current pin's convention (`codex-<triple>`).

### BLOCKER 1 — HELD at the build gate (swap thin), fail-closed per condition #1

The one runtime build (`cargo build -p anyharness`, mandated by run-probes.sh)
was NOT started. Build-gate reading at grant time:

```
cargo: empty        rustc: empty        pressure: 1  (< 3, OK)
vm.swapusage: total 14336M  used ~13330M  free ~1000M   (THIN — < 1 GB)
PhysMem: 23G used, 108M unused, 6042M compressor   (RAM effectively exhausted)
```

cargo slot and pressure pass, but **swap headroom fails** (~1 GB free, 108 MB
RAM unused). Per binding condition #1 / the closing "if swap thin, HOLD — do
not force it", the heavy anyharness build is held: starting it here risks the
OOM/swap-death the hard machine limit forbids and would take the sibling
rung-2 merge-train agent down with it. Awaiting swap recovery (or a different
box) before running steps 4–7 of the completion recipe. Everything else (auth,
pins, blocker-2 hashes, gate proofs) is ready; only the build window is missing.

### Pin coordinates verified live for the flip (ls-remote)

Claude `81a4d52e6bfe8f636d6818c6c48c29be28dca35d` (tag v0.66.0-proliferate.1,
merged via 99a990c4 on canonical-0.66.0-base, #50; tag `^{}` peels to the
commit); Codex `219738c9…` (tag v1.1.14-proliferate.1 peels to the commit,
merged via bb3c8866 on canonical-1.1.14-base, #19). Rollback anchor: claude
`v0.59.0-proliferate.1 @ 26f9ee7a0049507bff5476ce390695515ce92840`.

---

## AS-RUN #2 (2026-08-16, pressure-1 amendment) — build+probe attempted; BLOCKED by a runtime install bug

Under the refined gate (pressure level EXACTLY 1 is the live signal; swap-free
overridden), the gate was open (`cargo`/`rustc` empty, pressure 1) and the one
authorized `cargo build -q -p anyharness` was run via the real harness
(`run-probes.sh --agent codex`, unpatched).

**What SUCCEEDED (the catalog flip is correct):**
- `resolve-pins` cleanly resolved the codex flip from the edited registry:
  `native rust-v0.147.0 (archive)`, `agentProcess 1.1.14-proliferate.1 (git)`,
  and re-verified all three published 0.147.0 archive checksums — matching the
  independently-computed BLOCKER-2 hashes above.
- `cargo build -q -p anyharness` completed (warnings only).

**What FAILED (a runtime bug, NOT a catalog/pin/adapter problem):** the next
step, `anyharness install-agents --agent codex`, **panics immediately**:

```
thread 'main' panicked at tokio-1.50.0/src/runtime/blocking/shutdown.rs:51:21:
Cannot drop a runtime in a context where blocking is not allowed. This happens
when a runtime is dropped from within an asynchronous context.
stack backtrace (abridged):
   7: reqwest::blocking::wait::enter
   9: reqwest::blocking::client::ClientHandle::new
  10: reqwest::blocking::client::ClientBuilder::build
  11: download_binary_inner   anyharness-lib/src/domains/agents/installer/downloads.rs:63
  13: download_binary_verified                                     downloads.rs:172
  14: download_and_extract_archive_verified                        downloads.rs:202
  15: install_binary_or_archive_from_pin                              pinned.rs:69
```

Root cause: `install-agents` builds a **`reqwest::blocking`** client (which
spins and then drops its own tokio runtime) from *inside* the CLI's async tokio
context; dropping a runtime in async context is illegal → panic. It fires on the
**native archive download** — the codex `rust-v0.144.5 → rust-v0.147.0` bump
forces a native re-download, which is what exercises this blocking-reqwest path.
(A no-native-drift run would not hit it; the Aug-9 run reportedly had no native
bump.)

**Consequence — fail-closed (condition #3):** no codex context can produce a
live attestation, so the flip is NOT landed and NOT committed (no hand-edit /
replay). The validator + cargo gates are irrelevant until a live attestation
exists. This needs a **runtime fix** to the installer (use async reqwest, or
`spawn_blocking`/off-runtime the blocking client) — a Rust change outside this
catalog pin-flip's scope and beyond the one authorized build. The freshly-built
`target/debug/anyharness` carries the bug, so a retry needs a fixed+rebuilt
binary.

Mid-run pressure note: pressure rose to 2 during the compile (would pause
between contexts per condition iii) and returned to 1; it never reached 3, and
the crash was the install bug, not memory.

### Separate finding — claude native would DRIFT off the "2.1.212 unchanged" pin

`resolve-pins` for claude native (`direct_binary`) always fetches
`latestVersionUrl`, which currently returns **2.1.233** (catalog pins 2.1.212).
There is no registry field to pin a specific non-latest native. So regenerating
the claude probe via the standard flow would install native 2.1.233, the
snapshot would attest 2.1.233, and the catalog claude native would be forced to
2.1.233 — contradicting the "native 2.1.212 unchanged" instruction. Claude was
therefore NOT attempted; it needs a ruling: accept the 2.1.212→2.1.233 native
bump as sanctioned, or add a pin-specific-native mechanism. (codex had zero
native drift — openai/codex latest IS rust-v0.147.0.)

### AS-RUN #3 — both agents flipped and green (option #2 in, installer fix live)

With the installer fix (PR #1991) the `install-agents` panic is gone, so the
codex probe regenerated clean. Orchestrator rulings then landed: **option #2**
for the gateway-carryover contradiction, and **option (a)** unfreezing claude
(clean-full-pass-or-held).

**Option #2 (gateway mode-vocab carryover).** codex-acp 1.1.14 renamed the
unattended-mode vocabulary adapter-wide: `auto → agent`, `full-access →
agent-full-access`. Fresh probe `modes` block, identical across all three codex
contexts: `["read-only","agent","agent-full-access"]` (currentModeId `agent`).
Session curation `AGENT_UNATTENDED_MODE_IDS.codex` was updated to
`agent-full-access` (+ build-catalog test). The three carried-over **gateway-only**
models (`gpt-5.2-2025-12-11`, `gpt-5-mini`, `gpt-5-mini-2025-08-07`) are not
re-probed (no gateway auth context), so `applyBundledCuration` used to clone
their stale per-model `mode` matrix and the Rust validator rejected the catalog.
Fix: `applyBundledCuration` now drops the redundant per-model `mode` on
carried-over gateway models so they inherit the freshly-probed agent-level vocab
(`mode` is adapter-global — every probed model gets an identical copy from the
`modes` block; a frozen clone goes stale on any rename). Negative control
(literal): pre-fix the validator rejected — `agent catalog agent 'codex'
unattendedModeId 'agent-full-access' is not supported by model
'gpt-5.2-2025-12-11'`; post-fix it validates.

**MANDATORY probe precondition — `CLAUDE_CODE_EXECUTABLE` scrub.** The first
claude probe attested nativeCli `2.1.212` while installing `2.1.233`. Root cause
= the known agent-shell profile-leak class on this box: the invoking shell had
`CLAUDE_CODE_EXECUTABLE` set to a dev-profile's old native
(`~/.proliferate-local/runtimes/wf2pablo/agents/claude/native/claude` = 2.1.212),
and `detect_native_cli` (anyharness-lib `.../live/sessions/probe.rs`) lets that
var OVERRIDE the managed native for claude. The catalog probe MUST run with
`CLAUDE_CODE_EXECUTABLE` unset or the native attestation is corrupted by the
foreign binary. Enforced in `run-probes.sh` (defensive `unset` after secrets
sourcing, with comment). Codex is unaffected (the override is claude-only).

**Sequencing note.** To run the claude probe while the codex flip was still
being assembled, `catalog.json`/`catalog.draft.json` were reverted to the valid
`origin/main` version as a probe prerequisite (the embedded catalog is validated
at `install-agents` load, `bundled.rs`), while the codex snapshots + registry
edits were preserved. The version pins were then declared in `catalog.json`
(operator "flip the pin"; verified against the live attestations — not a snapshot
hand-edit) and the candidate re-derived.

**Combined authoritative probe (evidence-only-green).** `run.state
complete=true`; all six contexts passed:

- claude anthropic-api / anthropic-oauth / bedrock — attest `0.66.0-proliferate.1`,
  nativeCli `2.1.233 (Claude Code)`.
- codex openai-api / openai-oauth / bedrock — attest `1.1.14-proliferate.1`,
  nativeCli `codex-cli 0.147.0`.

**Gates.** `build-catalog --require-complete-probe` exit 0 (`catalog.json`
byte-identical to `catalog.draft.json`); `node scripts/validate-agent-catalog.mjs`
→ `agent catalog OK: 2026-08-16.4 (5 agents)`. The Rust cargo-test catalog gate
is authoritative in CI (held locally: this box was pinned at memory-pressure 2 by
the live fleet, and the START gate is pressure EXACTLY 1 — fail-closed, not
forced).

**Native moves are REAL at the catalog-pin level** (the env-leak was only the
attestation mismatch): claude old pin `2.1.212` → attested/pinned `2.1.233`;
codex `rust-v0.144.5` → `rust-v0.147.0`. Both ride the founder-visible line item
+ one-commit rollback recipe in the flip PR body.

**Morning follow-ups (recorded, not tonight):** the `resolve-pins`
pin-specific-native gap; and whether the three gateway-only codex models are
still offered post-migration (no gateway probe context exists to prove launch).
