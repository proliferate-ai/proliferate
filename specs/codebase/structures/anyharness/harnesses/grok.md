# Grok Harness

Status: authoritative for Grok-specific AnyHarness adapter behavior.

Grok (xAI Grok Build) speaks the Agent Client Protocol natively, so it is
launched through the upstream ACP registry rather than a Proliferate-owned
adapter: `agentProcess.install.kind = registry_backed`, `registryId =
"grok-build"`. The upstream ACP registry resolves that id to its npx
distribution (currently `@xai-official/grok`, run as `agent stdio`); the exact
package is owned by that registry, not this repo. A `binary_hint` fallback runs
a local `grok` (`agent stdio`) when the registry is unreachable. No fork or
wrapper adapter is required.

## Live Model Control

Grok does **not** advertise its model menu through the ACP `models` block or a
`model` `configOptions` entry, and it reports no `agent_info` at `initialize`.
It exposes the menu only on the initialize response's vendor `_meta.modelState`:

- `_meta.modelState.currentModelId` — the current session model id
- `_meta.modelState.availableModels[]` — `{ modelId, name, description }`

The catalog probe reads this via a general `initialize._meta.modelState`
fallback in `live/sessions/probe.rs`, used only when the standard ACP model
paths are empty (so other harnesses are unaffected). Grok's models are not
switchable through a config option, so no per-model config matrix is captured.

## Model Surface

In a clean / un-onboarded environment (what the probe and a fresh workspace
see) Grok advertises raw backend ids — coding models (`grok-4.20-0309-*`,
`grok-4.20-multi-agent-0309`, `grok-4.3`, `grok-build-0.1`) plus image/video
generation models (`grok-imagine-*`). The image/video models are hidden from
the catalog via visibility opt-out in `scripts/agent-catalog/build-catalog.mjs`
— they are not removed, because only the probe may prove a model launches
(catalog-v2 rule). An onboarded Grok (a real `~/.grok`) instead shows curated
presets (Grok Build, Grok Composer 2.5 Fast); the catalog reflects the
probe-advertised set.

## Auth

Provider id `xai`. Readiness is satisfied by `XAI_API_KEY` / `GROK_API_KEY`, or
by a cached login token at `~/.grok/auth.json` (produced by `grok login`). The
registry auth slot uses `syncedFiles` materialization for `.grok/auth.json`
(discovery `grok`, fact `grok-auth-json-oauth`). ACP `authMethods` are
`cached_token` (the file) and `grok.com` (browser sign-in). Grok is not a
gateway/BYOK provider, so it does not surface in the cloud BYOK credential UI.
Cloud auth is via `XAI_API_KEY` / `GROK_API_KEY`: the registry declares
`syncedFiles` for `~/.grok/auth.json`, but Desktop does not yet export that file
(the Tauri credential exporter covers claude/codex/gemini only), so syncing a
local Grok login into a cloud sandbox is not wired today.

## ACP Capabilities and Vendor Extensions

From a manual ACP `initialize` (these are not captured by the catalog probe),
Grok reported `loadSession`, MCP `http` + `sse` (Product MCPs attach over HTTP),
and no image/audio prompt input. It also emits non-standard JSON-RPC the
protocol does not define — `_x.ai/announcements/update` notifications, repeated
`skills-reload` results, and `_meta` keys such as `x.ai/fs_notify`. The ACP
client tolerates unknown methods (`method_not_found`, no crash); do not assume
these vendor messages are present or stable.

## Modes

Grok's ACP `session/new` advertises **no modes** (`modes: null` at probe time),
so AnyHarness exposes no create-session permission-mode control for Grok: the
catalog carries only a `model` control, the desktop shows no mode picker, and
cowork launches Grok with no `mode_id` (sending one is rejected by
`validate_mode`). Grok's CLI does accept a top-level `--permission-mode`
(`default`/`acceptEdits`/`auto`/`dontAsk`/`bypassPermissions`/`plan`), but that
surface is not exposed over the ACP `agent stdio` path Grok runs under here. If
Grok later advertises modes via ACP, the probe captures them and the catalog
gains a `mode` control automatically.

## Transcript and Permissions

Grok uses the standard ACP `request_permission` path, normalized into AnyHarness
`permission` interactions like every other harness; there is no Grok-specific
transcript or permission normalization, and unknown vendor methods resolve as
`method_not_found` (no crash). Because Grok advertises no ACP modes (see Modes),
its permission behavior is whatever the Grok adapter defaults to for the session.

## Limitations

- No native CLI is modeled (registry-backed); the descriptor's `native` is
  `null`.
- Grok is not pre-seeded into the desktop runtime — it downloads on first
  install rather than shipping in the agent seed.
- Model display names are the raw advertised ids until curated display-name
  overrides are added.
