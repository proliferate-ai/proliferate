# Grok Harness

Grok (xAI Grok Build) speaks the Agent Client Protocol natively, so it is launched through the upstream ACP registry rather than a Proliferate-owned adapter: `agentProcess.install.kind = registry_backed`, `registryId = "grok-build"`. The upstream ACP registry resolves that id to its npx distribution (currently `@xai-official/grok`, run as `agent stdio`); the exact package is owned by that registry, not this repo. A `binary_hint` fallback runs a local `grok` (`agent stdio`) when the registry is unreachable. No fork or wrapper adapter is required.

## Live Model Control

Grok does **not** advertise its model menu through the ACP `models` block or a `model` `configOptions` entry, and it reports no `agent_info` at `initialize`. It exposes the menu only on the initialize response's vendor `_meta.modelState`:

- `_meta.modelState.currentModelId` — the current session model id
- `_meta.modelState.availableModels[]` — `{ modelId, name, description }`

The target launch-options probe reads this through the general `initialize._meta.modelState` observation path when standard ACP model paths are empty. It preserves every reported model and confirms any explicit setter through response-carried current state before advertising it. Grok has no separate model config control, so the observation contains model rows without inventing a control matrix.

The live session start takes its model authority from the session response, not from `initialize`. `session/new` and `session/load` return no `configOptions`, but their vendor `_meta["x.ai/sessionConfig"].options` list the model rows (`category: "model"`, `selected`) for that exact native session, observed after `authenticate`; the runtime adopts that as `current_model_id` and the menu (`NativeSessionStartupState::from_session_parts`), and it tracks a later `session/set_model` on `session/load`. `initialize._meta.modelState` is only an enumeration fallback when the session response carries no model statement (`absorb_init_meta_model_menu`): it is pre-session and pre-auth, so it never sets `current_model_id`. Because Grok exposes no `model` config option, a requested model that differs from the current one is applied through the legacy `session/set_model` extension method, and only an exact effective-model readback (`_meta.model.Ok` or `_meta.modelState.currentModelId`) confirms it; an id the enumeration does not list is refused before anything is sent. The menu is subscription-dependent (a Grok team login reports `grok-4.6` and `grok-4.5`), so the live statement, not the catalog's presentation rows, decides which ids a session accepts.

## Model Surface

Grok's advertised set depends on the target's installed/authenticated state. A clean target may report raw backend IDs while an onboarded target may report named presets. `HarnessLaunchOptions` stores and serves that exact target observation—no reported row is hidden by catalog visibility policy and no catalog row is added. Presentation metadata may decorate a matching ID; unknown IDs remain reachable under their observed name or raw ID.

## Auth

Provider id `xai`. Readiness is satisfied by `XAI_API_KEY` / `GROK_API_KEY`, or by a cached login token at `~/.grok/auth.json` (produced by `grok login`). The registry auth slot uses `syncedFiles` materialization for `.grok/auth.json` (discovery `grok`, fact `grok-auth-json-oauth`). ACP `authMethods` are `cached_token` (the file) and `grok.com` (browser sign-in). Cloud auth is via the gateway or an `XAI_API_KEY` selection: the registry declares `syncedFiles` for `~/.grok/auth.json`, but nothing exports that file to a cloud sandbox, so syncing a local Grok login into a cloud sandbox is not wired today.

## ACP Capabilities and Vendor Extensions

From a manual ACP `initialize` (these are not captured by the catalog probe), Grok reported `loadSession`, MCP `http` + `sse` (Product MCPs attach over HTTP), and no image/audio prompt input. It also emits non-standard JSON-RPC the protocol does not define — `_x.ai/announcements/update` notifications, repeated `skills-reload` results, and `_meta` keys such as `x.ai/fs_notify`. The ACP client tolerates unknown methods (`method_not_found`, no crash); do not assume these vendor messages are present or stable.

## Modes

Grok's ACP `session/new` currently advertises **no modes** (`modes: null` in the target observation), so `HarnessLaunchOptions` contains no permission-mode control and first-party callers send no corresponding `controlValues` entry. Grok's CLI does accept a top-level `--permission-mode` (`default`/`acceptEdits`/`auto`/`dontAsk`/`bypassPermissions`/`plan`), but that surface is not exposed over the ACP `agent stdio` path Grok runs under here. If Grok later advertises a mode control through ACP, the next successful target observation exposes its exact key and values automatically.

## Transcript and Permissions

Grok uses the standard ACP `request_permission` path, normalized into AnyHarness `permission` interactions like every other harness; there is no Grok-specific transcript or permission normalization, and unknown vendor methods resolve as `method_not_found` (no crash). Because Grok advertises no ACP modes (see Modes), its permission behavior is whatever the Grok adapter defaults to for the session.

## Limitations

- No native CLI is modeled (registry-backed); the descriptor's `native` is
  `null`.
- Grok is not pre-seeded into the desktop runtime — it downloads on first
  install rather than shipping in the agent seed.
- Model display names are the raw advertised ids until curated display-name
  overrides are added.
