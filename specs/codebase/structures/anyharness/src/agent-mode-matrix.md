# Agent Session Mode Matrix

Status: source-of-truth note for session permission / collaboration mode
variants by agent family, scoped to what the repo supports today.

This doc exists to answer one question: "for a given agent kind, what
`mode_id` / `collaboration_mode` values can cowork actually send, and which
one is the most permissive?"

## How modes flow through the stack

The runtime does not hardcode per-agent mode values, but create-session mode
values are now validated against the bundled AnyHarness agent catalog:

- The HTTP create-session request takes an opaque `mode_id` string
  (`anyharness/crates/anyharness-contract/src/v1/sessions.rs`).
- Session creation resolves the agent's bundled catalog row and validates an
  explicit `mode_id` against the catalog's create-session `mode` control before
  launch.
- After validation, the runtime passes the mode through to the ACP binary
  (`anyharness/crates/anyharness-lib/src/domains/sessions/runtime/creation.rs`,
  `anyharness/crates/anyharness-lib/src/domains/sessions/runtime/startup.rs`).
- At session start the ACP binary returns its own `SessionModeState`, which
  the live-session actor config path stores as `LegacyModeState`
  (`anyharness/crates/anyharness-lib/src/live/sessions/actor/config/**`).
- `build_live_config_snapshot` normalizes whatever the agent exposed into the
  common `NormalizedSessionControls` buckets (`model`, `collaboration_mode`,
  `mode`, `reasoning`, `effort`, `fast_mode`, plus `extras`)
  (`anyharness/crates/anyharness-lib/src/domains/sessions/live_config/**`).
- The contract shape with the six normalized buckets is declared at
  `anyharness/crates/anyharness-contract/src/v1/session_config.rs`.

Consequence: the pre-launch legal set is the bundled AnyHarness catalog's
create-session `mode` control for that agent. Once the process is live, the
actual session controls are whatever the ACP binary advertises at
live-session time.

The *desktop-advertised* set of mode values is frozen in a presentation
table at `apps/desktop/src/lib/domain/chat/session-controls/presentation.ts`. This table
is what defines which values the UI renders as selectable, with labels,
tones, icons, and a per-agent `isDefault`. The `ConfiguredSessionControlKey`
type only recognises `mode` and `collaboration_mode`
(`apps/desktop/src/lib/domain/chat/session-controls/presentation.ts`).

Desktop keeps a user preference `defaultSessionModeByAgentKind`
(`apps/desktop/src/lib/domain/preferences/user/model.ts`) as an
unvalidated `Record<string, string>` — it is sanitized for shape only
(`apps/desktop/src/lib/domain/preferences/user/session-defaults.ts`), not against
the presentation table.

Cowork uses that preference verbatim when creating threads
(`apps/desktop/src/hooks/cowork/workflows/use-cowork-thread-workflow.ts`), and
session creation reads the same preference directly from the store
(`apps/desktop/src/hooks/sessions/workflows/use-session-creation-actions.ts`).

Registered agent kinds come from
`anyharness/crates/anyharness-lib/src/domains/agents/model.rs`: `claude`,
`codex`, `gemini`, `cursor`, `opencode`. All five are declared in
`catalogs/agents/v1/catalog.json` and projected into runtime descriptors by
`anyharness/crates/anyharness-lib/src/domains/agents/registry/mod.rs`.

## Per-agent matrix

For each family, "Exposed in desktop" means the value appears in
`apps/desktop/src/lib/domain/chat/session-controls/presentation.ts` and therefore renders
as a first-class selector in the UI. Values not in the table still travel
through the runtime unchanged, but the desktop UI will only see them if the
ACP binary surfaces them in live config and then uses fallback
icon/tone rendering
(`apps/desktop/src/lib/domain/chat/session-controls/session-mode-control.ts`).

### Claude (`claude`)

Control key: `mode` — source:
`apps/desktop/src/lib/domain/chat/session-controls/presentation.ts`.

| Value               | Label         | Meaning (from desktop copy)  | Default | Tone         |
| ------------------- | ------------- | ---------------------------- | ------- | ------------ |
| `default`           | Default       | Ask before each action.      | yes     | info         |
| `acceptEdits`       | Accept Edits  | Auto-approve file edits.     |         | success      |
| `plan`              | Plan          | Plan without execution.      |         | accent       |
| `dontAsk`           | Don't Ask     | Auto-approve most actions.   |         | warning      |
| `bypassPermissions` | Bypass        | Skip permission checks.      |         | destructive  |

All five values are exposed in desktop config. No `collaboration_mode` is
configured for Claude.

- Most permissive: **`bypassPermissions`**.
- Unambiguous? Yes on the desktop copy ("Skip permission checks"), which is
  stricter than `dontAsk` ("Auto-approve most actions"). Runtime cannot
  verify this independently — these strings are forwarded to the Claude ACP
  binary selected by the bundled agent catalog, which owns the actual
  enforcement semantics.

### Codex (`codex`)

Control keys: **both** `mode` and `collaboration_mode` — source:
`apps/desktop/src/lib/domain/chat/session-controls/presentation.ts`.

`mode` values:

| Value         | Label       | Meaning                           | Default | Tone        |
| ------------- | ----------- | --------------------------------- | ------- | ----------- |
| `read-only`   | Read Only   | Inspect and plan without editing. | yes     | info        |
| `auto`        | Auto        | Auto-approve standard edits.      |         | success     |
| `full-access` | Full Access | Allow unrestricted changes.       |         | destructive |

`collaboration_mode` values:

| Value     | Label   | Meaning                           | Default | Tone    |
| --------- | ------- | --------------------------------- | ------- | ------- |
| `default` | Default | Standard collaboration behavior.  | yes     | info    |
| `plan`    | Plan    | Plan before applying changes.     |         | accent  |

Both keys are exposed in desktop config. Codex is the only family where the
normalizer expects two distinct controls — see the `collaboration_mode`
detection branch at
`anyharness/crates/anyharness-lib/src/domains/sessions/live_config/controls.rs`; the
tests under `domains/sessions/live_config/**` assert that the two controls keep
distinct values.

- Most permissive: **`mode = full-access`**.
- Caveat: the desktop UI lets the user set `collaboration_mode` independently,
  and its `plan` value *can* coexist with `mode = full-access` at the product
  layer — the runtime will not reject that combination. "Most permissive" is
  unambiguous only if you also leave `collaboration_mode` at `default`.
- Caveat 2: cowork's `defaultSessionModeByAgentKind` is a single string per
  agent kind (`apps/desktop/src/lib/domain/preferences/user/model.ts`) and the
  create-session path only carries `mode_id`
  (`anyharness/crates/anyharness-contract/src/v1/sessions.rs`). There is
  no parallel `collaboration_mode_id` on session creation — collaboration
  mode is only mutable at live-config time via
  `SetSessionConfigOptionRequest`
  (`anyharness/crates/anyharness-contract/src/v1/session_config.rs`). A
  cowork thread created from the default will therefore start with whatever
  `collaboration_mode` the codex ACP binary picks as its own default.

### Gemini (`gemini`)

Control key: `mode` — source:
`apps/desktop/src/lib/domain/chat/session-controls/presentation.ts`.

| Value      | Label     | Meaning                    | Default | Tone        |
| ---------- | --------- | -------------------------- | ------- | ----------- |
| `default`  | Default   | Ask before each action.    | yes     | info        |
| `autoEdit` | Auto Edit | Auto-approve edits.        |         | success     |
| `yolo`     | YOLO      | Skip permission checks.    |         | destructive |
| `plan`     | Plan      | Plan without execution.    |         | accent      |

All four values are exposed in desktop config. No `collaboration_mode`.

- Most permissive: **`yolo`**.
- Unambiguous? Yes on desktop copy (`yolo` = "Skip permission checks" vs
  `autoEdit` = "Auto-approve edits"). As with Claude, actual enforcement
  lives in the Gemini ACP binary selected by the bundled agent catalog; the
  desktop labels reflect intent, not a runtime-side whitelist.

### Cursor (`cursor`)

Registered in the runtime
through `catalogs/agents/v1/catalog.json` and
`anyharness/crates/anyharness-lib/src/domains/agents/registry/mod.rs` via
`cursor-acp` (fallback `cursor-agent acp`).

**No entry in `apps/desktop/src/lib/domain/chat/session-controls/presentation.ts`.**
Because `SESSION_CONTROL_PRESENTATIONS` has no `cursor` key,
`listConfiguredSessionControlValues("cursor", ...)` returns the empty array
(`apps/desktop/src/lib/domain/chat/session-controls/session-mode-control.ts`), so
the desktop UI has no first-class mode selector for Cursor.

- Most permissive: **unknown from the repo.** The runtime will forward any
  `mode_id` string the client sends through to cursor-acp, and the normalized
  controls will reflect whatever cursor-acp advertises in its
  `SessionModeState`. There is no repo-local list of supported values to
  anchor a "most permissive" claim.
- Ambiguous on purpose: any recommendation here would be guesswork.

### OpenCode (`opencode`)

Registered in the runtime
through `catalogs/agents/v1/catalog.json` and
`anyharness/crates/anyharness-lib/src/domains/agents/registry/mod.rs` via the
`opencode` ACP registry id (fallback npm package `opencode-ai`).

**No entry in `apps/desktop/src/lib/domain/chat/session-controls/presentation.ts`.** Same
situation as Cursor: the desktop UI shows no mode selector, but the runtime
will pass `mode_id` through verbatim.

- Most permissive: **unknown from the repo.** Not defined in either the
  presentation table or anywhere runtime-side.

## Divergence between desktop labels and runtime behaviour

- The desktop presentation table is descriptive. Session creation enforces the
  bundled AnyHarness catalog's create-session `mode` values, and live controls
  then come from the ACP binary.
- Claude `dontAsk` and `bypassPermissions` are both in desktop config; they
  are distinct only by copy tone ("Auto-approve most actions" vs "Skip
  permission checks"). If the upstream Claude ACP binary no longer
  distinguishes them, the UI will still show both.
- Codex's `plan` appears in both `mode` and `collaboration_mode` as distinct
  options. The UI treats them as independent controls; the runtime
  normalizer explicitly keeps them separate
  (`anyharness/crates/anyharness-lib/src/domains/sessions/live_config/controls.rs`).
- Cursor and OpenCode have zero desktop mode metadata. A cowork thread
  created against one of these families today will send `mode_id = undefined`
  (since `defaultSessionModeByAgentKind` has no entry for them unless the
  user typed one in by hand) and inherit whatever default the ACP binary
  picks.

## Recommended cowork default by agent family

Only families with a repo-supported "most permissive" value get a
recommendation. For the rest, explicitly: unknown — do not ship a default.

| Agent    | Control             | Recommended permissive value | Confidence                                       |
| -------- | ------------------- | ---------------------------- | ------------------------------------------------ |
| claude   | `mode`              | `bypassPermissions`          | High. Unambiguous in desktop config.             |
| codex    | `mode`              | `full-access`                | High for `mode`. `collaboration_mode` unset (see caveats above). |
| gemini   | `mode`              | `yolo`                       | High. Unambiguous in desktop config.             |
| cursor   | `mode`              | *unknown*                    | None. No repo-local source of truth.             |
| opencode | `mode`              | *unknown*                    | None. No repo-local source of truth.             |

If cowork needs a permissive default for cursor / opencode, the next
step is to either (a) query the live `SessionLiveConfigSnapshot` after the
first session starts and pick the most permissive value from the
`normalized_controls.mode` bucket heuristically, or (b) extend the
desktop presentation table with vetted entries from each ACP binary. This
doc does not choose between those.
