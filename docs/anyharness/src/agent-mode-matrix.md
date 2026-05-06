# Agent Session Mode Matrix

Status: source-of-truth note for session permission / collaboration mode
variants by agent family, scoped to what the repo supports today.

This doc exists to answer one question: "for a given agent kind, what
`mode_id` / `collaboration_mode` values can cowork actually send, and which
one is the most permissive?"

## How modes flow through the stack

The runtime is *mode-agnostic*. It does not hardcode a per-agent list of
legal mode values:

- The HTTP create-session request takes an opaque `mode_id` string
  (`anyharness/crates/anyharness-contract/src/v1/sessions.rs:64`,
  `sessions.rs:104`) and the runtime passes it through to the ACP binary
  (`anyharness/crates/anyharness-lib/src/sessions/runtime.rs:208-243`).
- At session start the ACP binary returns its own `SessionModeState`, which
  the session actor stores as `LegacyModeState`
  (`anyharness/crates/anyharness-lib/src/acp/session_actor.rs:286-374`).
- `build_live_config_snapshot` normalizes whatever the agent exposed into the
  common `NormalizedSessionControls` buckets (`model`, `collaboration_mode`,
  `mode`, `reasoning`, `effort`, `fast_mode`, plus `extras`)
  (`anyharness/crates/anyharness-lib/src/sessions/live_config.rs:45-130`,
  `live_config.rs:173-215`).
- The contract shape with the six normalized buckets is declared at
  `anyharness/crates/anyharness-contract/src/v1/session_config.rs:95-120`.

Consequence: the *runtime-legal* set of mode values for a given agent is
whatever that agent's ACP binary advertises at live-session time. There is
no server-side enum to grep.

The *desktop-advertised* set of mode values is frozen in a presentation
table at `desktop/src/config/session-control-presentations.ts`. This table
is what defines which values the UI renders as selectable, with labels,
tones, icons, and a per-agent `isDefault`. The `ConfiguredSessionControlKey`
type only recognises `mode` and `collaboration_mode`
(`session-control-presentations.ts:1`).

Desktop keeps a user preference `defaultSessionModeByAgentKind`
(`desktop/src/stores/preferences/user-preferences-store.ts:13`) as an
unvalidated `Record<string, string>` — it is sanitized for shape only
(`user-preferences-store.ts:101-115`), not against the presentation table.

Cowork uses that preference verbatim when creating threads
(`desktop/src/hooks/cowork/use-cowork-thread-workflow.ts:94`,
`use-cowork-thread-workflow.ts:114`), and session creation reads the same
preference directly from the store
(`desktop/src/hooks/sessions/use-session-creation-actions.ts:288-290`,
`use-session-creation-actions.ts:335`).

Registered agent kinds come from
`anyharness/crates/anyharness-lib/src/agents/model.rs:6-47`: `claude`,
`codex`, `gemini`, `cursor`, `opencode`. All five are wired into the
descriptor list at
`anyharness/crates/anyharness-lib/src/agents/registry.rs:15-20`.

## Per-agent matrix

For each family, "Exposed in desktop" means the value appears in
`desktop/src/config/session-control-presentations.ts` and therefore renders
as a first-class selector in the UI. Values not in the table still travel
through the runtime unchanged, but the desktop UI will only see them if the
ACP binary surfaces them in live config and then uses fallback
icon/tone rendering
(`desktop/src/lib/domain/chat/session-mode-control.ts:18-22`,
`session-mode-control.ts:88-101`).

### Claude (`claude`)

Control key: `mode` — source:
`desktop/src/config/session-control-presentations.ts:34-78`.

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
  binary (`git+proliferate-ai/claude-agent-acp` pinned in
  `anyharness/crates/anyharness-lib/src/agents/registry.rs:5-6`), which owns
  the actual enforcement semantics.

### Codex (`codex`)

Control keys: **both** `mode` and `collaboration_mode` — source:
`desktop/src/config/session-control-presentations.ts:79-126`.

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
`anyharness/crates/anyharness-lib/src/sessions/live_config.rs:182-194` and
the test at `live_config.rs:538-600` that asserts the two keep distinct
values.

- Most permissive: **`mode = full-access`**.
- Caveat: the desktop UI lets the user set `collaboration_mode` independently,
  and its `plan` value *can* coexist with `mode = full-access` at the product
  layer — the runtime will not reject that combination. "Most permissive" is
  unambiguous only if you also leave `collaboration_mode` at `default`.
- Caveat 2: cowork's `defaultSessionModeByAgentKind` is a single string per
  agent kind (`user-preferences-store.ts:13`) and the create-session path
  only carries `mode_id`
  (`anyharness/crates/anyharness-contract/src/v1/sessions.rs:104`). There is
  no parallel `collaboration_mode_id` on session creation — collaboration
  mode is only mutable at live-config time via
  `SetSessionConfigOptionRequest` (`session_config.rs:148-156`). A cowork
  thread created from the default will therefore start with whatever
  `collaboration_mode` the codex ACP binary picks as its own default.

### Gemini (`gemini`)

Control key: `mode` — source:
`desktop/src/config/session-control-presentations.ts:127-163`.

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
  lives in the Gemini ACP binary
  (`anyharness/crates/anyharness-lib/src/agents/registry.rs:122-155`); the
  desktop labels reflect intent, not a runtime-side whitelist.

### Cursor (`cursor`)

Registered in the runtime
(`anyharness/crates/anyharness-lib/src/agents/model.rs:10,22,53`,
`anyharness/crates/anyharness-lib/src/agents/registry.rs:159-189`) via
`cursor-acp` (fallback `cursor-agent acp`).

**No entry in `desktop/src/config/session-control-presentations.ts`.**
Because `SESSION_CONTROL_PRESENTATIONS` has no `cursor` key,
`listConfiguredSessionControlValues("cursor", ...)` returns the empty array
(`desktop/src/lib/domain/chat/session-mode-control.ts:26-35`), so the
desktop UI has no first-class mode selector for Cursor.

- Most permissive: **unknown from the repo.** The runtime will forward any
  `mode_id` string the client sends through to cursor-acp, and the normalized
  controls will reflect whatever cursor-acp advertises in its
  `SessionModeState`. There is no repo-local list of supported values to
  anchor a "most permissive" claim.
- Ambiguous on purpose: any recommendation here would be guesswork.

### OpenCode (`opencode`)

Registered in the runtime
(`anyharness/crates/anyharness-lib/src/agents/model.rs:11,23,54`,
`anyharness/crates/anyharness-lib/src/agents/registry.rs:239-263`) via the
`opencode` ACP registry id (fallback npm package `opencode-ai`).

**No entry in `desktop/src/config/session-control-presentations.ts`.** Same
situation as Cursor: the desktop UI shows no mode selector, but the runtime
will pass `mode_id` through verbatim.

- Most permissive: **unknown from the repo.** Not defined in either the
  presentation table or anywhere runtime-side.

## Divergence between desktop labels and runtime behaviour

- The desktop presentation table is descriptive, not enforced. The runtime
  will happily forward any `mode_id` string, including values not in the
  table. Conversely, if an ACP binary drops or renames a mode, the desktop
  table will keep offering the stale value and the runtime will forward it
  to a binary that no longer recognises it. There is no repo-side
  reconciliation between the two.
- Claude `dontAsk` and `bypassPermissions` are both in desktop config; they
  are distinct only by copy tone ("Auto-approve most actions" vs "Skip
  permission checks"). If the upstream Claude ACP binary no longer
  distinguishes them, the UI will still show both.
- Codex's `plan` appears in both `mode` and `collaboration_mode` as distinct
  options. The UI treats them as independent controls; the runtime
  normalizer explicitly keeps them separate
  (`live_config.rs:182-194`, `live_config.rs:538-600`).
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
