# Shared Chat UI Spec

Status: proposed migration spec. Not yet authoritative — see
[Open Decisions](#11-open-decisions). Once accepted, the chat-area parts of
`docs/frontend/specs/chat-transcript.md` and `docs/frontend/specs/chat-composer.md`
should be updated to point file paths at the shared package.

Read this before extracting chat components into shared packages or before
building the Web chat surface.

## 1. Goal

Render the chat transcript and the chat composer with **the same React
components** on Desktop and Web. Today Desktop has a rich chat surface
(~141 files, ~18k lines under `desktop/src/components/workspace/chat/`) and Web
has a hand-rolled placeholder (`web/src/components/chat/screen/ChatScreen.tsx`,
~256 lines) that renders transcript items as flat `role + text` cards.

This is the flagship instance of an existing repo rule
(`docs/frontend/guides/components.md`):

> Web product surfaces should be controllers over `packages/product-ui/**`.
> Desktop keeps the controller: stores, hooks, AnyHarness/Tauri/cloud access,
> navigation, and workflow callbacks stay in `desktop/src/**`.

The chat surface is the largest surface still violating that rule. The same
presentational-core + transport-controller pattern this spec defines for chat
applies to any other surface later.

## 2. Background: two transports, one UI

The two clients reach a running agent session through different transports.

**Desktop → AnyHarness direct.** Desktop tails the runtime session SSE stream
(`item_started` / `item_delta` / `item_completed` / `interaction_requested` …),
folds the envelopes through the SDK reducer
(`anyharness/sdk/src/reducer/transcript.ts`) into a rich `TranscriptState`, and
sends prompts straight to the runtime.

**Web → Cloud projection.** The Rust `proliferate-worker` tails the *same* SSE
and POSTs envelopes to the control plane, which projects them into
`CloudSessionProjection` / `CloudTranscriptItem` / `CloudPendingInteraction`
rows. Web reads them via `useSessionLive` / `useWorkspaceLive`
(`cloud/sdk-react/`) and sends prompts by enqueuing an async `send_prompt`
cloud command.

| | Desktop (AnyHarness) | Web (Cloud) |
| --- | --- | --- |
| Transcript model | `TranscriptState` (reducer-built) | `CloudTranscriptItem[]` (projection rows) |
| Stream events | `snapshot` + per-event SSE | `snapshot` / `patch` / `command_status` / `heartbeat` |
| Streaming granularity | token-by-token deltas | 2 snapshots/item (`started`, `completed`) |
| Send a prompt | direct runtime call | enqueue cloud command, poll status |
| Resolve approval/input | direct runtime call | cloud command |

The key enabling fact: `CloudTranscriptItem` has a `payload` field, and
`payload` is the **full AnyHarness event envelope** — the complete
`TranscriptItemPayload`, including `contentParts` — not just the flat
`text`/`title`/`kind` columns. The current Web `ChatScreen` simply ignores
`payload`. See `server/proliferate/server/cloud/events/domain/payload_policy.py`.

## 3. The convergence model

`@anyharness/sdk` is framework-free and dependency-free: it exports the
`TranscriptState`/`TranscriptItem`/`ContentPart` types and the **pure** reducer
(`createTranscriptState`, `reduceEvent`, `reduceEvents`). Using those is not
"constructing an SDK client" — it is types plus pure functions, so shared
packages may depend on `@anyharness/sdk` without violating the access rules.

That makes the reducer the **universal adapter**. Both transports converge on
`TranscriptState`:

```text
Desktop:  AnyHarness SSE ─────────────────────► reduceEvent ─► TranscriptState ─┐
                                                                                ├─► shared chat UI
Web:      Cloud snapshot/patch ─► payload[] ──► reduceEvents ─► TranscriptState ─┘
```

The shared chat components consume `TranscriptState` (and the pure view models
derived from it). They never know which transport produced it.

## 4. Architecture: presentational core + transport controllers

Four layers. The middle two are shared; the outer two are per-client.

| Layer | Location | Owns | Must NOT contain |
| --- | --- | --- | --- |
| Pure chat logic | `packages/product-model/src/chats/**` | view models, transcript row/display-block builders, tool-output parsers, the Cloud→`TranscriptState` adapter | React, stores, access, transport |
| Presentational chat UI | `packages/product-ui/src/chat/**` | transcript rows, tool-call rows, content renderers, composer surface, approval/input cards | stores, desktop/web hooks, `lib/access`, Tauri, react-router, react-query, telemetry |
| Desktop controller | `desktop/src/components/workspace/chat/**` | wires AnyHarness store/hooks/access into the shared UI | shared visual rows/cards |
| Web controller | `web/src/components/chat/**` | wires Cloud live-stream + command queue into the shared UI | shared visual rows/cards |

**Stripping coupling is mechanical.** Every component moved into
`packages/product-ui/src/chat/**` must have each desktop-only import
(`@/stores/**`, `@/hooks/**`, `@/lib/access/**`, Tauri, react-router,
`useQueryClient`, `lib/infra/measurement`) converted to one of:

1. a **prop** (data the controller computes), or
2. a **callback** (an action the controller performs), or
3. a **context value** supplied by the client's controller (use sparingly,
   only for values threaded deep, e.g. an open-target resolver).

If a moved component still needs real orchestration, that orchestration stays
in the client controller — the shared component only receives its result.

Each client keeps its own state container. Desktop keeps its Zustand transcript
store (`desktop/src/stores/sessions/session-transcript-store.ts`). Web builds an
equivalent small store/hook that runs `reduceEvents` over cloud payloads. The
shared components are store-agnostic by construction.

## 5. The chat surface contract

Phase 0 finalizes the exact props. Illustrative shapes:

```ts
// packages/product-ui/src/chat/transcript/ChatTranscriptView.tsx
interface ChatTranscriptViewProps {
  transcript: TranscriptState;          // from @anyharness/sdk
  pendingPrompts: PendingPromptEntry[]; // optimistic outbound rows
  selection: TranscriptSelectionView;   // value + callbacks
  onOpenFile(target: FileOpenTarget): void;
  onOpenSubagentSession(sessionId: string): void;
  onOpenArtifact(ref: ArtifactRef): void;
  onCopyItem(itemId: string): void;
  onEditQueuedPrompt?(promptId: string): void;
  onCancelQueuedPrompt?(promptId: string): void;
}
```

```ts
// packages/product-ui/src/chat/composer/ChatComposer.tsx
interface ChatComposerProps {
  draft: ComposerDraft;
  onDraftChange(next: ComposerDraft): void;
  capabilities: PromptCapabilities;
  controls: ComposerControlsView;       // models / modes / config as view data
  attachments: AttachmentView;          // value + add/remove callbacks
  dockSlots: ComposerDockSlots;         // outbound / active / attached / footer nodes
  pendingInteraction: PendingInteractionView | null;
  canSubmit: boolean;
  isSubmitting: boolean;
  isRunning: boolean;
  onSubmit(prompt: SubmittedPrompt): void;
  onCancel(): void;
  onResolveInteraction(decision: InteractionDecision): void;
}
```

The controller decides what `onSubmit` / `onResolveInteraction` *do*:

- Desktop: direct AnyHarness prompt / interaction-resolve calls.
- Web: `useEnqueueCloudCommand` (`send_prompt` / interaction-resolve commands),
  with optimistic `pendingPrompts` driven off `useCommandStatus`.

The shared `ChatComposer` does not care which.

## 6. Known fidelity gaps and how the contract absorbs them

The Cloud projection drops three things
(`server/.../events/domain/payload_policy.py`). The UI contract absorbs each so
the shared components do not branch on transport:

1. **Streaming deltas.** `item_delta` & friends are live-only — never durable,
   never fanned out. Web sees `item_started` then `item_completed`: two
   snapshots, no token-by-token growth. The shared components already handle
   `isStreaming` and non-streaming items, so this is a Web-side `TranscriptState`
   that simply transitions started→completed. The streaming-handoff layout
   invariant in `chat-transcript.md` still holds structurally. Token streaming
   on Web is **out of scope** here; it would require the server to fan out
   deltas (separate workstream).
2. **Raw tool I/O.** `rawInput`/`rawOutput` are stripped on the Cloud path;
   `contentParts` are preserved. Shared tool renderers must prefer
   `contentParts` and degrade gracefully (summary, no raw dump) when raw bodies
   are absent. The tool-output parsers in `product-model/chats/tools/**` own
   that fallback.
3. **Async submission.** Submission is a callback (Section 5); only the
   controller differs. `pendingPrompts` is a view input, so Web can source it
   from command status while Desktop sources it from the reducer.

Pending interactions are **not** a gap: `CloudPendingInteraction.payload`
carries the full interaction envelope, so Web can reconstruct `PendingInteraction`
and drive the same approval/input/elicitation cards.

## 7. Component disposition

Initial classification (validate while migrating). Counts are subfolders of
`desktop/src/components/workspace/chat/`.

- **Port as-is** (already presentational; props in, callbacks out):
  `AssistantMessage`, `UserMessage`, `TranscriptTurnRow`, `TranscriptTurnChrome`,
  `TurnItemSequence`, `VirtualTranscriptRowList`, `FullTranscriptRowList`,
  `ProposedPlanCard`, `ChatComposerDock`, `ChatComposerSurface`, the pure
  `ApprovalCard` export, and most pure tool-call rows.
- **Split** (extract a presentational core; leave a desktop connected wrapper):
  `MessageList` → `ChatTranscriptView`; `TranscriptItemBlock`,
  `TranscriptToolCallItemBlock` (drop `useSessionDirectoryStore` / cowork /
  workspace hooks to props/context); `VirtualizedTranscriptRowList` (move
  `@tanstack/react-virtual` into the shared package; stub the debug profiler);
  `ComposerCommandEditor` (inject the slash-command menu).
- **Controller-only** (stay in `desktop/src/**`, become thin):
  `ChatView`, `ChatInput` — they keep the hook wiring and render the shared
  `ChatTranscriptView` / `ChatComposer`.

Shared dependencies the chat components rely on (markdown renderer, chat icons)
must already live in `packages/ui/**` or move there before/with Phase 2.

## 8. Target file layout

```text
packages/product-model/src/chats/
  transcript/
    cloud-transcript-adapter.ts   # CloudTranscriptItem[] + patches -> TranscriptState
    transcript-row-model.ts       # moved from desktop/src/lib/domain/chat/transcript/
    transcript-presentation.ts    # moved (buildTranscriptDisplayBlocks)
    transcript-rendering.ts       # moved
  tools/
    <tool>-presentation.ts        # moved pure tool-output parsers
  model.ts presentation.ts claiming.ts   # already present

packages/product-ui/src/chat/
  transcript/ ChatTranscriptView.tsx, TranscriptTurnRow.tsx, AssistantMessage.tsx, ...
  tool-calls/ <Tool>Row.tsx
  content/    PromptContentRenderer.tsx, ...
  composer/   ChatComposer.tsx, ChatComposerDock.tsx, ApprovalCard.tsx, ...
  ChatPreviewSurface.tsx ClaimBanner.tsx   # already present

desktop/src/components/workspace/chat/
  ChatView.tsx                    # controller (AnyHarness)
  ChatTranscriptController.tsx ChatComposerController.tsx

web/src/components/chat/
  screen/ChatScreen.tsx           # controller (Cloud)
  ChatTranscriptController.tsx ChatComposerController.tsx
```

`packages/product-ui` gains `@proliferate/product-model` and `@anyharness/sdk`
(types + pure reducer) as dependencies. Web gains `@anyharness/sdk`. All exports
stay concrete subpaths (`@proliferate/product-ui/chat/...`), no barrels.

## 9. Migration phases

Phases 1–4 are **behavior-preserving for Desktop**. The user-visible Web change
lands in Phase 5. Prefer one bounded area per PR; phases 1–4 can be a PR stack.

- **Phase 0 — Spike & contract.** Prove `CloudTranscriptItem.payload[]` →
  `reduceEvents` → `TranscriptState` renders through the existing Desktop
  `MessageList`. Output: the finalized `ChatTranscriptView` / `ChatComposer`
  prop contracts, and a precise list of which events the Cloud projection must
  relay for acceptable fidelity (turn boundaries, interactions). Throwaway code;
  the contract is the artifact.
- **Phase 1 — View models → `product-model/chats`.** Move the pure row model,
  display-block builder, rendering helpers, tool-output parsers; add
  `cloud-transcript-adapter.ts`. Move tests. Desktop re-points imports.
- **Phase 2 — Pure components → `product-ui/chat`.** Move the "port as-is"
  list; move any required shared primitives to `packages/ui` first. Desktop
  re-points imports.
- **Phase 3 — Split transcript.** Extract `ChatTranscriptView`; Desktop
  `MessageList` becomes `ChatTranscriptController`. Strip stores/hooks to
  props/context.
- **Phase 4 — Split composer.** Extract `ChatComposer`; Desktop `ChatInput`
  becomes `ChatComposerController`.
- **Phase 5 — Web controllers.** Build `web/src/components/chat/**`: a
  cloud-live-stream controller that produces `TranscriptState`, and a
  command-queue submit controller, both feeding the shared components. Replace
  the hand-rolled rendering in `ChatScreen.tsx`.
- **Phase 6 — Cleanup.** Remove dead Web primitives, update the boundary
  allowlist, update `chat-transcript.md` / `chat-composer.md` paths, set this
  spec to authoritative.

## 10. CI, boundaries, verification

- `scripts/check_frontend_boundaries.py` is a ratchet; its allowlist is
  currently tiny. Shared chat code must not regress it, and Web controllers
  must follow the controller pattern.
- The dev playground (`desktop/src/pages/ChatPlaygroundPage.tsx`) renders the
  composer/transcript from fixtures. As components move, the playground should
  render the **shared** components — it then doubles as the shared-component
  visual harness for both clients.
- Per change: `pnpm --dir desktop exec tsc --noEmit`, the focused transcript /
  reducer / row-model tests listed in `chat-transcript.md`, and (Phase 5)
  connect Web to a workspace, render a real transcript, send a prompt.

## 11. Open decisions

1. **Token streaming on Web** — accept snapshot-grained (`started`/`completed`)
   for v1, or invest in server delta fan-out? Recommended: accept for v1.
2. **Raw tool I/O on Web** — accept graceful degradation, or change the server
   retention policy to keep raw bodies? Recommended: degrade for v1.
3. **Package home** — `packages/product-ui/chat/**` (doc-compliant, chosen
   above) vs a dedicated `packages/chat-ui` for the ~18k-line surface. A new
   package needs human sign-off and a `docs/frontend/README.md` update.
4. **Turn-boundary fidelity** — confirm in Phase 0 whether the Cloud projection
   relays enough (turn events / `stopReason` / file badges) or whether the
   server projection must be extended.
