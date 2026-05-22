# Shared Chat UI Spec

Status: proposed migration spec. Not yet authoritative. Three foundational
decisions are resolved (see [§13](#13-open-decisions)): the shared components
live in `packages/product-ui/chat/**`; the Cloud projection is extended by an
owned prerequisite phase; mobile is out of scope. Once accepted, update the
file paths in `docs/frontend/specs/chat-transcript.md` and
`docs/frontend/specs/chat-composer.md`.

Read this before extracting chat components into shared packages or before
building the Web chat surface.

## 1. Goal

Render the chat transcript and the chat composer with **the same React
components** on Desktop and Web. Today Desktop has a rich chat surface
(~141 files, ~18k lines under `desktop/src/components/workspace/chat/`) and Web
has a hand-rolled placeholder (`web/src/components/chat/screen/ChatScreen.tsx`)
that renders transcript items as flat `role + text` cards.

This is the flagship instance of an existing repo rule
(`docs/frontend/guides/components.md`): Web product surfaces are controllers
over `packages/product-ui/**`; Desktop keeps its controller (stores, hooks,
AnyHarness/Tauri/cloud access). The chat surface is the largest surface still
violating that rule.

## 2. Scope and non-goals

In scope: sharing the chat transcript and composer between Desktop and Web.

Non-goals:

- **Mobile.** `mobile/` is React Native / Expo — no DOM. It cannot consume
  `packages/product-ui` (a `react-dom` package) and keeps its own
  `MobileChatScreen` and Cloud-transport chat implementation. If mobile chat
  reuse is revisited later, the `packages/product-model/src/chats/**` layer
  (pure adapter + view models, no DOM) is the natural reuse seam — so this spec
  keeps that layer DOM-free, but does not design for mobile.
- **Token-by-token streaming on Web.** See [§7](#7-known-fidelity-gaps).
- **Chat UX/visual redesign.** Phases 1–4 are behavior-preserving for Desktop.

## 3. Background: two transports, one UI

The two clients reach a running agent session through different transports.

**Desktop → AnyHarness direct.** Desktop tails the runtime session SSE stream
(`item_started` / `item_delta` / `item_completed` / `turn_started` /
`turn_ended` / `interaction_requested` …), folds the envelopes through the SDK
reducer (`anyharness/sdk/src/reducer/transcript.ts`) into a rich
`TranscriptState`, and sends prompts straight to the runtime.

**Web → Cloud projection.** The Rust `proliferate-worker` tails the *same* SSE
and POSTs envelopes to the control plane, which projects them into
`CloudSessionProjection` / `CloudTranscriptItem` / `CloudPendingInteraction`
rows. Web reads them via `useSessionLive` / `useWorkspaceLive`
(`cloud/sdk-react/`) and sends prompts by enqueuing an async `send_prompt`
cloud command.

| | Desktop (AnyHarness) | Web (Cloud) |
| --- | --- | --- |
| Transcript model | `TranscriptState` (reducer-built) | `CloudTranscriptItem[]` (projection rows) |
| Stream events | per-event SSE incl. turn + delta events | `snapshot` / `patch` / `command_status` / `heartbeat` |
| Streaming granularity | token-by-token deltas | one row per item, last-write-wins |
| Send a prompt | direct runtime call | enqueue cloud command, poll status |
| Resolve approval/input | direct runtime call | cloud command |

`@anyharness/sdk` is framework-free and **confirmed dependency-free** (no
`dependencies` in `anyharness/sdk/package.json`): it exports the
`TranscriptState`/`TranscriptItem`/`ContentPart` types and the **pure** reducer
(`createTranscriptState`, `reduceEvent`, `reduceEvents`). Using types and pure
functions is not "constructing an SDK client", so shared packages may depend on
`@anyharness/sdk`.

## 4. The convergence model — and what it requires from the server

The reducer is the intended convergence point: both transports produce the same
`TranscriptState`, which the shared components consume.

```text
Desktop:  AnyHarness SSE ──────────────────────────► reduceEvent ─► TranscriptState ─┐
                                                                                     ├─► shared chat UI
Web:      Cloud snapshot/patch ─► SessionEventEnvelope[] ─► reduceEvents ─► State ────┘
```

**This does not work against the Cloud projection as it exists today.** The
projection is lossy in four ways that the original spec missed; each is a
confirmed gap, not a Phase 0 question:

1. **Turn events are not projected.** `CloudTranscriptItem` rows are written
   only for `item_started`/`item_completed`. `turn_started`/`turn_ended`
   produce no row, so the reducer cannot rebuild `TurnRecord.stopReason`,
   `completedAt`, or `fileBadges`, and `isStreaming` never clears from a turn.
2. **`item_completed` must carry full content.** `item_delta` events are
   stripped (live-only), so a streamed item's final `contentParts` exist on the
   wire only if the runtime emits them complete on `item_completed`. This must
   be guaranteed, not assumed.
3. **Pending prompts are not projected.** Reducer `pendingPrompts` come from
   `pending_prompt_*` events, which the projection never persists.
4. **`payload` is not a ready envelope.** `CloudTranscriptItem.payload` is the
   sanitized inner event content; `seq`/`turnId`/`itemId` live in row columns.
   The Web adapter must reconstruct `SessionEventEnvelope{seq,turnId,itemId,event}`
   from columns + `payload`, and sort by `firstSeq` (the live upsert preserves
   arrival order, not seq order).

Gaps 1–3 require server changes — owned here as **Phase 0.5**
([§10](#10-migration-phases)). Gap 4 is Web adapter work. After Phase 0.5 the
convergence holds.

## 5. Architecture: presentational core + transport controllers

Four layers. The middle two are shared; the outer two are per-client.

| Layer | Location | Owns | Must NOT contain |
| --- | --- | --- | --- |
| Pure chat logic | `packages/product-model/src/chats/**` | view models, row/display-block builders, the dock-slot arbiter, tool-output parsers, the transport-neutral `envelope → TranscriptState` helper, the stream-batch scheduler | React, stores, transport, DOM APIs |
| Presentational chat UI | `packages/product-ui/src/chat/**` | transcript rows, tool-call rows, content renderers, composer surface, dock, cards | stores, desktop/web hooks, `lib/access`, Tauri, react-router, react-query, analytics calls |
| Desktop controller | `desktop/src/components/workspace/chat/**` | wires AnyHarness store/hooks/access into the shared UI | shared visual rows/cards |
| Web controller | `web/src/components/chat/**` + `web/src/lib/access/cloud/**` | wires Cloud live-stream + command queue into the shared UI | shared visual rows/cards |

**Stripping coupling is mechanical.** Every desktop-only import in a moved
component (`@/stores/**`, `@/hooks/**`, `@/lib/access/**`, Tauri, react-router,
`useQueryClient`, analytics calls, `lib/infra/measurement`) becomes a **prop**,
a **callback**, or — only for a small, named set of deep values such as an
open-target resolver — a **context value**. Context is not a general escape
hatch; if a component still needs real orchestration, that orchestration stays
in the client controller.

**Telemetry masking is markup, not a hook.** `data-telemetry-mask` and
Sentry-replay masking attributes are mandated on transcript/composer content
(`chat-composer.md`, `telemetry.md`). They **stay baked into the shared JSX** —
the "no telemetry" rule above forbids analytics *calls*, not masking
*attributes*. Dropping them is a privacy regression.

Each client keeps its own store (Desktop's Zustand transcript store; a small
Web store running `reduceEvents`). The per-animation-frame batch/flush policy
is **not** reinvented per client — it is owned by the shared stream-batch
scheduler ([§9](#9-target-file-layout)). Stream subscription and abort-safe
history paging stay per-controller because they are transport-specific.

## 6. The chat surface contract

Phase 0 finalizes exact props. Illustrative shapes:

```ts
// packages/product-ui/src/chat/transcript/ChatTranscriptView.tsx
interface ChatTranscriptViewProps {
  transcript: TranscriptState;          // from @anyharness/sdk
  pendingPrompts: PendingPromptEntry[]; // controller-owned (Web sources from command status)
  selection: TranscriptSelectionView;
  onOpenFile(target: FileOpenTarget): void;
  onOpenSubagentSession(sessionId: string): void;
  onCopyItem(itemId: string): void;
  onEditQueuedPrompt?(promptId: string): void;
}
```

The composer dock is the contract's hardest part. Its slots hold the densest
components in the surface (approval cards, todo tracker, attached
workspace/runtime panels, delegated-work control, mobility footer). They are
passed as **data, never as pre-rendered nodes** — pre-rendered nodes would
force Web to rebuild every one of them, which is the exact duplication this spec
exists to remove.

```ts
// packages/product-model/src/chats/composer/resolve-dock-slots.ts  (pure)
function resolveComposerDockSlots(inputs: ComposerDockInputs): ComposerDockView;

interface ComposerDockView {
  outbound: OutboundPromptView[];
  active:                               // precedence arbitrated here, once
    | ApprovalCardView | UserInputCardView | McpElicitationView
    | TodoTrackerView | null;
  attached: AttachedPanelView[];
  footer: MobilityFooterView | null;
}

// packages/product-ui/src/chat/composer/ChatComposer.tsx
interface ChatComposerProps {
  draft: ComposerDraft;
  onDraftChange(next: ComposerDraft): void;
  capabilities: PromptCapabilities;
  controls: ComposerControlsView;       // models / modes / config as view data
  attachments: AttachmentView;
  dock: ComposerDockView;               // resolved data, not nodes
  canSubmit: boolean;
  isSubmitting: boolean;
  isRunning: boolean;
  onSubmit(prompt: SubmittedPrompt): void;
  onCancel(): void;
  onResolveInteraction(decision: InteractionDecision): void;
}
```

Moving `useComposerDockSlots` precedence into the pure `resolveComposerDockSlots`
keeps both controllers feeding one arbiter and stops `ChatComposerProps` from
becoming a 40-field god-props object. The controller decides what `onSubmit` /
`onResolveInteraction` *do*: Desktop = direct runtime calls; Web =
`useEnqueueCloudCommand` with optimistic `pendingPrompts` from `useCommandStatus`.

## 7. Known fidelity gaps

After Phase 0.5, three differences remain. The contract absorbs each so the
shared components never branch on transport:

1. **No token streaming on Web.** Web sees an item appear (`item_started`
   patch) and complete (`item_completed` patch) — no token-granular growth. The
   shared components already handle non-streaming items; this is a Web
   `TranscriptState` that transitions started→completed. Token streaming on Web
   would require fanning out `item_delta` and is a non-goal.
2. **Raw tool I/O.** `rawInput`/`rawOutput` are stripped on the Cloud path;
   `contentParts` are preserved. Shared tool renderers prefer `contentParts` and
   degrade gracefully (summary, no raw dump). The parsers in
   `product-model/chats/tools/**` own that fallback.
3. **Async submission.** Submission is a callback; only the controller differs.

## 8. Component disposition

Initial classification (validate while migrating).

- **Leaf components — portable once their dependencies move.** Small JSX such
  as `AssistantMessage`, `UserMessage`, `TranscriptTurnRow`,
  `ChatComposerDock`, `ChatComposerSurface`, `ProposedPlanCard`, the pure
  `ApprovalCard` export, most pure tool-call rows. These are **not** "props in,
  callbacks out" today — each imports desktop modules (`MarkdownRenderer`,
  `DebugProfiler`, `@/lib/domain/chat/**`). They become portable only after
  Phase 1 (view models move) and after their shared primitives move
  ([§9](#9-target-file-layout)). There is no "drop in as-is" set.
- **Split components.** `MessageList` → `ChatTranscriptView`;
  `TranscriptItemBlock`, `TranscriptToolCallItemBlock` (store/cowork/workspace
  hooks → props/context); `VirtualizedTranscriptRowList` (move
  `@tanstack/react-virtual` into the shared package); `ComposerCommandEditor`
  (slash-command menu injected).
- **Controller-only.** `ChatView`, `ChatInput` stay in `desktop/src/**` and
  shrink to wiring once the dock is data-driven (§6).

## 9. Target file layout

```text
packages/product-model/src/chats/
  transcript/
    envelope-to-state.ts          # transport-neutral SessionEventEnvelope[] -> TranscriptState
    stream-batcher.ts             # shared per-frame batch/flush scheduler (raf injected, pure)
    transcript-row-model.ts       # moved from desktop/src/lib/domain/chat/transcript/
    transcript-presentation.ts    # moved (buildTranscriptDisplayBlocks)
    transcript-rendering.ts       # moved
  composer/
    resolve-dock-slots.ts         # pure dock-slot arbiter (was useComposerDockSlots)
  tools/
    <tool>-presentation.ts        # moved pure tool-output parsers

packages/product-ui/src/chat/
  transcript/ ChatTranscriptView.tsx, TranscriptTurnRow.tsx, AssistantMessage.tsx, ...
  tool-calls/ <Tool>Row.tsx
  content/    PromptContentRenderer.tsx, ...
  composer/   ChatComposer.tsx, ChatComposerDock.tsx, ApprovalCard.tsx, ...

packages/ui/src/        # prerequisite moves
  content/MarkdownRenderer.tsx    # moved from desktop/src/components/ui/content/
  ...                             # debug-profiler shim (no-op default)
packages/design/        # load-bearing chat tokens move into the generated theme

web/src/lib/access/cloud/
  chat-transcript-adapter.ts      # transport-shaped: Cloud rows/patches -> SessionEventEnvelope[]
desktop/src/components/workspace/chat/  # AnyHarness controllers (ChatView, ChatInput, ...)
web/src/components/chat/                # Cloud controllers
```

The Cloud→`TranscriptState` adapter is **transport-shaped** (it knows cloud
`snapshot`/`patch`/`payload` semantics), so it lives in `web/src/lib/access/cloud/**`,
not `product-model`. It reconstructs `SessionEventEnvelope[]` from row columns +
`payload`, sorts by `firstSeq`, and calls the transport-neutral
`product-model` `envelope-to-state` helper.

`packages/product-ui` gains `@proliferate/product-model`, `@anyharness/sdk`, and
`@tanstack/react-virtual` as dependencies. The package's concrete subpath
exports mean an `auth`-only or `settings`-only consumer still tree-shakes chat
out of its bundle; the cost is install-time deps, accepted per
[§13](#13-open-decisions).

## 10. Migration phases

Phases 2–4 are **behavior-preserving for Desktop**. The user-visible Web change
lands in Phase 5. Phase 0.5 is a parallel server track that gates Phase 5.

- **Phase 0 — Spike & contract.** Prove a reconstructed `TranscriptState`
  renders through the existing Desktop `MessageList`. Output: finalized props
  contracts (§6) and a server sub-spec for Phase 0.5.
- **Phase 0.5 — Server projection extension** (parallel; gates Phase 5). Relay
  turn events into the projection, guarantee complete `contentParts` on
  `item_completed`, project pending prompts. Server work under
  `server/proliferate/server/cloud/events/**`.
- **Phase 1 — Shared foundations.** Move view models, the dock-slot arbiter,
  tool parsers, the transport-neutral `envelope-to-state` helper, and the
  stream-batch scheduler into `product-model/chats`. Promote load-bearing chat
  tokens into `packages/design`. Move `MarkdownRenderer` + a debug-profiler
  shim into `packages/ui`. Tests move with their code.
- **Phase 2 — Leaf components → `product-ui/chat`.** Desktop re-points imports.
- **Phase 3 — Split transcript.** Extract `ChatTranscriptView`; Desktop
  `MessageList` becomes a connected controller.
- **Phase 4 — Split composer.** Extract `ChatComposer` + data-driven dock;
  Desktop `ChatInput` becomes a connected controller.
- **Phase 5 — Web controllers.** Build the Cloud adapter
  (`web/src/lib/access/cloud/`) and the Web chat controllers feeding the shared
  components. Land **behind a feature flag**; the old `ChatScreen` stays until
  the new path is validated.
- **Phase 6 — Cleanup.** Remove the flag and dead Web primitives, update the
  boundary allowlist, update `chat-transcript.md` / `chat-composer.md` paths,
  set this spec authoritative.

Per-phase owners and effort estimates are filled in with the team before
Phase 1 starts.

## 11. Cross-cutting concerns

- **Theming tokens.** `--text-chat`, `--text-chat--line-height`, and
  `--edge-fade-distance` are load-bearing values declared only in
  `desktop/src/index.css` `@theme` — not in `packages/design` and not in
  `web/src/index.css`. Shared components would render with wrong line-height on
  Web (the scroll-bump `chat-transcript.md` warns about). Phase 1 promotes
  these into `packages/design`; `chat-transcript.md`'s pinned-value table is
  updated to point at the shared token source.
- **Telemetry & privacy.** Masking attributes stay in shared JSX (§5).
  `trackProductEvent` analytics calls stay in controllers. Error boundaries are
  a controller responsibility (`telemetry.md` exempts them from the no-telemetry
  rule).
- **Stream-batch invariant.** Owned by `product-model/.../stream-batcher.ts`;
  `chat-transcript.md` is updated to name that file as the invariant owner for
  both clients.
- **Copy.** Shared components take controller-variable copy as props; truly
  static structural microcopy inlines. Authored chat copy that must be shared
  moves into `product-model/chats` presentation helpers, not `desktop/src/copy`.
- **Tests.** Component tests move with their components into `product-ui` per
  phase; `product-ui`'s vitest/jsdom setup must cover them. Web has zero chat
  tests and no e2e harness today — Phase 5 adds at least one Web acceptance
  test and the spec flags the missing harness.
- **Playground.** `ChatPlaygroundPage` stays desktop-only dev but renders the
  **shared** components, becoming the visual harness for both clients. Fixture
  ownership stays in `desktop/src/config/playground.ts` / `__fixtures__`.

## 12. CI, boundaries, verification

- `scripts/check_frontend_boundaries.py` is a ratchet; shared chat code must
  not regress it.
- Each Desktop-facing phase (1–4) is verified behavior-preserving by walking
  every `ChatPlaygroundPage` scenario and re-checking the `chat-transcript.md`
  layout-invariant table — not by `tsc` alone.
- Phase 5 ships behind a feature flag with the old `ChatScreen` as rollback.
- Per change: `pnpm --dir desktop exec tsc --noEmit`, the focused transcript /
  reducer / row-model tests, and the playground walkthrough.

## 13. Open decisions

Resolved: shared components live in `packages/product-ui/chat/**`; the server
projection extension is owned here as Phase 0.5; mobile is out of scope.

Still open:

1. **Token streaming on Web** — accept snapshot-grained (`started`/`completed`)
   for v1, or fan out `item_delta` later. Recommended: accept for v1.
2. **Raw tool I/O on Web** — accept graceful degradation, or change the server
   retention policy to keep raw bodies. Recommended: degrade for v1.
3. **Phase 0.5 projection shape** — whether turn data becomes a new
   `CloudTurnProjection` table or folds into the session projection. Decided by
   the Phase 0 server sub-spec.
