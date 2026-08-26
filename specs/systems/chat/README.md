# Chat

The chat surface: one session's transcript plus the composer that writes to
it, mounted inside a workspace shell. Chat is a **client composition
surface**, not a system of record — every fact it shows is projected from a
runtime session stream or a Cloud record, and every write it makes is a
request to a system that owns the outcome. This document is the surface's
contract; the focused documents below are its sections.

| Section | Document |
| --- | --- |
| Whether a model selection creates, preserves, or replaces the visible chat | [lifecycle.md](lifecycle.md) |
| Input, controls, pickers, attached panels, badges | [composer.md](composer.md) |
| Streams, replay, row models, pending/outbox prompts, long-history rendering | [transcript.md](transcript.md) |
| Loading hero and session-loading wait treatment | [../ux-latency-transitions.md](../workspace-surface/ux-latency-transitions.md) |
| Same-workspace subagents (Agents pane, tab hierarchy) | [../agents/delegated-work.md](../subagents/delegated-work.md) |

## Purpose

Let a person read what an agent did and say what it should do next, for one
session at a time, with the runtime as the only authority on what happened.
Chat renders the runtime's append-only session log and turns keystrokes into
prompt, config, permission, and interaction requests; it never invents
session state.

## Owned state

UI state only. Chat owns no durable record.

| Store | Holds | Code |
| --- | --- | --- |
| Draft + attachments | The unsent composer document, attached files/plans, submit gate | [chat-input-store.ts](../../../apps/packages/product-client/src/stores/chat/chat-input-store.ts), [chat-plan-attachment-store.ts](../../../apps/packages/product-client/src/stores/chat/chat-plan-attachment-store.ts) |
| Launch intent | Pre-session model/control choice for a workspace with no active session | [chat-launch-intent-store.ts](../../../apps/packages/product-client/src/stores/chat/chat-launch-intent-store.ts) |
| Prompt recovery | Prompts the runtime rejected, held for resubmit | [chat-prompt-recovery-store.ts](../../../apps/packages/product-client/src/stores/chat/chat-prompt-recovery-store.ts) |
| Diff preferences, model support, slash catalog | Per-user rendering choices and the runtime's advertised catalogs, cached | [chat-diff-preferences-store.ts](../../../apps/packages/product-client/src/stores/chat/chat-diff-preferences-store.ts), [model-support-store.ts](../../../apps/packages/product-client/src/stores/chat/model-support-store.ts), [slash-command-catalog-store.ts](../../../apps/packages/product-client/src/stores/chat/slash-command-catalog-store.ts) |
| Transcript projection | The batched, reduced session stream per session (ingest → transcript → rows) | [session-ingest-store.ts](../../../apps/packages/product-client/src/stores/sessions/session-ingest-store.ts), [session-transcript-store.ts](../../../apps/packages/product-client/src/stores/sessions/session-transcript-store.ts) |
| Session intents | Optimistic prompt/config/interaction intents awaiting runtime settlement | [session-intent-store.ts](../../../apps/packages/product-client/src/stores/sessions/session-intent-store.ts) |

The session stores are shared with the workspace surface (which selects
sessions and renders tabs) — chat is their primary writer for transcript
content, the workspace surface for selection. See
[Fences](#fences).

## Public surface

What other surfaces may mount or call:

- [`ChatView`](../../../apps/packages/product-client/src/components/workspace/chat/ChatView.tsx)
  — the one mount point, placed by the workspace shell's content view. It
  takes the active session identity from context, not props.
- The composer control-row and popover frames under
  [composer/](../../../apps/packages/product-client/src/components/workspace/chat/composer/ChatComposerSurface.tsx)
  are the sanctioned composer kit for the Home screen's first-prompt composer
  and the Agents pane composer (see [composer.md](composer.md) for the
  shared-surface rule).
- Facade hooks under
  [hooks/chat/facade/](../../../apps/packages/product-client/src/hooks/chat/facade/use-chat-session-controls.ts)
  are the read API for chrome outside the chat column (header tabs, activity
  bar) that needs the active session's live config or subagent strip.

Nothing else is public. Transcript row components, scroll physics, and
composer plugins are internal.

## Consumes

Chat is a client of three systems, in this order of authority:

1. **AnyHarness sessions** (runtime) via `@anyharness/sdk` /
   `@anyharness/sdk-react` — the session log stream and every write:
   `sessions` (16 direct client call sites plus `usePromptSessionMutation`,
   `useSetSessionConfigOptionMutation`, `useResolveSessionInteractionMutation`,
   `useCancelSessionMutation`, `useEditPendingPromptMutation`,
   `useDeletePendingPromptMutation`), `replay` (history hydration), `plans`,
   `agentAuth` (harness availability for the picker). Raw access lives only in
   [lib/access/anyharness/sessions.ts](../../../apps/packages/product-client/src/lib/access/anyharness/sessions.ts)
   and its siblings; components never construct a client
   ([FE-ACCESS-2](../../../lints/frontend/boundaries.toml)).
2. **Agent auth / launch options** (runtime-observed, server-declared) —
   `useAgentLaunchOptionsQuery` feeds the model picker before a session
   exists; once a session exists the composer reads only that session's
   `SessionLiveConfigSnapshot`
   ([launch configuration authority](../../areas/frontend.md#launch-configuration-authority)).
3. **Cloud** (`@proliferate/cloud-sdk`) — only for two decorations: the
   composer integrations control reads the shared integration-health query
   ([use-composer-integrations-state.ts](../../../apps/packages/product-client/src/hooks/cloud/derived/use-composer-integrations-state.ts),
   5-minute refresh, dedupes with the settings pane) and session titles
   persist through
   [use-session-title-actions.ts](../../../apps/packages/product-client/src/hooks/sessions/workflows/use-session-title-actions.ts).
   Chat never calls a Cloud endpoint for transcript content.

Presence and multiplayer today are **claiming only**: team-kind chats
(`slack`, `shared-auto`, `shared-chat`) derive a claim state in
[domain/chats/claiming.ts](../../../apps/packages/product-client/src/domain/chats/claiming.ts)
and render [ClaimBanner](../../../apps/packages/product-client/src/components/workspace/chat/ClaimBanner.tsx).
There is no live cursor or co-editing; a second client of the same session is
a second reader of the same runtime stream.

## Laws

- **The runtime log is the transcript.** Every transcript row derives from
  session stream envelopes reduced in
  [envelope-to-state.ts](../../../apps/packages/product-client/src/domain/chats/transcript/envelope-to-state.ts);
  no component appends synthetic history. Optimistic rows (pending prompts,
  outbox echoes) are marked as intents and are replaced, never merged, when
  the runtime's own event arrives
  ([session-intent-reconciliation.ts](../../../apps/packages/product-client/src/domain/sessions/intents/session-intent-reconciliation.ts)).
- **History is cursor-paged, never guessed.** Hydration fetches history by
  `afterSeq`/`beforeSeq` cursor and applies it in order, deduplicating
  against the live stream
  ([use-session-history-hydration.ts](../../../apps/packages/product-client/src/hooks/sessions/lifecycle/use-session-history-hydration.ts),
  [session-history-hydration-dedupe.ts](../../../apps/packages/product-client/src/hooks/sessions/lifecycle/session-history-hydration-dedupe.ts));
  the runtime stops replay at the first sequence hole (PRO-352), so the
  client never receives a torn range to render.
- **One store write per stream flush.** SSE events batch into at most one
  Zustand write per animation frame
  ([stream-batcher.ts](../../../apps/packages/product-client/src/domain/chats/transcript/stream-batcher.ts),
  [use-session-stream-flush.ts](../../../apps/packages/product-client/src/hooks/sessions/lifecycle/use-session-stream-flush.ts)) —
  the transcript's performance contract; see [transcript.md](transcript.md).
- **Pre-session choices come from launch options; in-session choices come
  from the live snapshot.** No picker seeds, filters, or falls back
  ([lifecycle.md](lifecycle.md), [composer.md](composer.md)).
- **Submit is gated, never dropped.** A submit that cannot be delivered
  (runtime unreachable, session replaced, prompt rejected) lands in prompt
  recovery with the typed content intact
  ([use-composer-submit-gate.ts](../../../apps/packages/product-client/src/hooks/chat/ui/use-composer-submit-gate.ts),
  [use-chat-prompt-recovery-actions.ts](../../../apps/packages/product-client/src/hooks/chat/workflows/use-chat-prompt-recovery-actions.ts)).
- **Approvals and elicitations are runtime interactions.** Permission cards,
  MCP elicitation forms, and user-input cards resolve through
  `useResolveSessionInteractionMutation`; the client never decides an outcome
  locally.

## Emits

- Prompt, config, interaction, and cancel requests to the runtime (above).
- Product telemetry events for turn end and reveal performance
  ([use-turn-end-diagnostics.ts](../../../apps/packages/product-client/src/hooks/sessions/lifecycle/use-turn-end-diagnostics.ts),
  under the [telemetry](../../areas/frontend.md) privacy boundary).
- Turn-end sound and workspace activity acknowledgement to the workspace
  surface ([use-turn-end-sound.ts](../../../apps/packages/product-client/src/hooks/sessions/lifecycle/use-turn-end-sound.ts)).
- Open-target requests (open a file, a diff, a terminal) that the workspace
  surface fulfils ([transcript-open-target.ts](../../../apps/packages/product-client/src/domain/chats/transcript/transcript-open-target.ts)).

## Fences

- **Workspace surface** owns which session is visible, tab order and
  restoration, the right panel, and files/terminals — chat receives the
  active session id and emits open-target requests
  ([../workspaces/README.md](../workspaces/README.md)).
- **Agents** owns delegated-work semantics; chat renders the subagent strip
  and launch ledger rows from data the runtime provides
  ([../agents/README.md](../../README.md)).
- **Agent auth / models** owns identity and availability of models and
  controls; chat only renders launch options and the live snapshot
  ([MODELS.md](../agent_auth/models.md), [AGENT_AUTH.md](../agent_auth/deep-dive.md)).
- **Runs triage** (target) owns goals, loops, and background-work rows; today
  those render inside the chat column from the activity domain and are
  recorded there as a migration source
  ([../runs-triage/README.md](../runs-triage/README.md)).
- **Design system** owns every primitive chat composes; the composer kit
  under `primitives/patterns/composer/` is library-owned, the chat-specific
  compositions are not ([DESIGN_SYSTEM.md](../../DESIGN_SYSTEM.md)).
- Layer law: components render, hooks own behavior, `domain/chats` is pure
  and Mobile-safe ([frontend/README.md](../../areas/frontend.md#what-goes-where)).
  Directory edges are frozen by
  [FE-FENCE-001](../../../lints/frontend/fences.toml).

## Code map

Ordered by data flow: runtime stream → stores → domain projection → hooks →
components.

```text
apps/packages/product-client/src/
├── lib/access/anyharness/
│   ├── sessions.ts · replay.ts · plans.ts     raw runtime access (sessions, history, plans)
│   └── session-stream-handles.ts             stream handle lifecycle
├── hooks/sessions/lifecycle/                  stream connect/reconnect/flush, history hydration,
│   └── use-session-stream-flush.ts            intent dispatch, turn-end diagnostics
├── stores/sessions/                           ingest → transcript → intents → records (shared with workspaces)
├── domain/chats/                              PURE, Mobile-safe
│   ├── transcript/   envelope-to-state, row model, virtualization, copy
│   ├── composer/     attachment rules, dock slots, todo progress
│   ├── tools/        tool-call display, agent-operations output, cowork tools
│   ├── subagents/    delegated-work provenance, launch ledger
│   └── cloud/        composer control model + launch catalog projections
├── domain/sessions/                           activity + intent models
├── stores/chat/                               draft, launch intent, prompt recovery, catalogs
├── hooks/chat/
│   ├── derived/      active session identity/config/transcript/usage, launch readiness
│   ├── ui/           composer editor mechanics; transcript scroll, follow, virtual measurement
│   ├── workflows/    launch, prompt, permission, elicitation, recovery, selected-response actions
│   ├── lifecycle/    content search, composer activation focus
│   └── facade/       session controls, model selector, delegated-work composer
├── components/workspace/chat/
│   ├── ChatView.tsx                           the mount
│   ├── surface/      loading hero, ready hero, launch-intent pane, transcript pane, recovery panel
│   ├── composer/     shared composer surface + control-row frame + popover surface
│   ├── input/        dock, draft editor + plugins, controls, cards (approval, elicitation, status)
│   ├── transcript/   turn rows, assistant/user/system messages, markdown, plans, virtual list
│   ├── tool-calls/   collapsed actions, file/bash/generic calls, reasoning, cowork ledger
│   ├── plans/        plan handoff + preview dialogs
│   └── content/      prompt attachment rendering
└── copy/chat/chat-copy.ts
```

Target moves (later sweep wave, not this document's scope): `hooks/sessions`
+ `stores/sessions` + `domain/sessions` become a `sessions` client system
that chat and the workspace surface both consume; `components/workspace/chat`
→ `systems/chat/`.

## Proof

- Unit: 1,092 vitest files under `product-client/src`; the chat-owned share
  is concentrated in `hooks/chat/ui` (49), `components/workspace/chat/transcript`
  (40), `components/workspace/chat/input` (28), `domain/chats/transcript` (22),
  `hooks/sessions/workflows` (24), `hooks/sessions/lifecycle` (17). Run
  `pnpm --filter @proliferate/product-client test`.
- Rendered: the transcript scroll-physics qualification lane
  (`pnpm --filter @proliferate/product-client test:scroll-physics`, CI job
  "Transcript scroll physics (chromium + webkit)") pins follow/pin behavior
  against a real renderer; the Tier-2 composer perimeter spec pins dock depth.
- Typecheck: `pnpm --filter @proliferate/product-client typecheck` (CI:
  "Shared frontend packages").
- Structure: [check_frontend_boundaries.py](../../../scripts/check_frontend_boundaries.py),
  [check_frontend_fences.py](../../../scripts/check_frontend_fences.py)
  (warn mode), [report_frontend_structure.py](../../../scripts/report_frontend_structure.py).
- Manual: the chat rows of
  [manual-release-qa.md](../../engineering/testing/manual-release-qa.md).

## Known gaps / follow-ups

- Multiplayer is claim-only; a live-presence contract (who is viewing, who is
  typing) has no client design and depends on the deferred live mirror in the
  control plane.
- `domain/chats/cloud/*` names a "cloud" composer control model that is in
  fact the launch-options projection used by both local and cloud targets;
  the name predates the target-agnostic contract and should follow the
  sessions-system move.
- The transcript's `GoalTranscriptEventRow` and activity rows belong to the
  runs-triage target; they are listed there as a migration source.
