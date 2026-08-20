# Chat Transcript

Read this doc when a change touches session streams, transcript replay,
transcript row models, pending/outbox prompt rows, long-history loading, or
chat transcript rendering performance.

In-app find (Cmd+F) over transcript prose is documented separately in
[`../../../features/content-search.md`](../../../features/content-search.md).

## Stream And Transcript Rules

- SSE events should be batched into at most one Zustand store write per
  animation frame during normal streaming. The shared scheduler owner is
  `apps/packages/product-client/src/domain/chats/transcript/stream-batcher.ts`;
  ProductClient's session-stream lifecycle injects the timing/runtime hooks
  around it for both Desktop and Web.
- Do not reintroduce per-event store patches for the live stream path.
- Any deliberate stream close, detach, prune, or reconnect path must flush
  pending batched stream events before discarding the current handle.
- Never clear `sseHandle` before queued envelopes have a chance to apply.
- Transcript reducers must preserve structural sharing and must not mutate
  prior transcript state, turns, items, or content-part arrays in place.
- Long transcripts must stay virtualized on the normal render path.
- Avoid whole-transcript maps, full-store subscriptions, or new object/array
  props that invalidate memoized row rendering on every stream event.
- Older-history loading must be bounded and retry-safe: use event/turn limits,
  keep requests abortable, key top-of-scroll prefetches by the oldest loaded
  sequence, and do not spin forever when a page returns no new rows.

### Embedded Non-Active Transcripts

The Agents right-pane detail renders a child transcript without making that
child the active main chat. It must reuse the mapped ProductClient session's
existing directory entry, transcript store, history hydration, transcript row
model, and send-or-queue intent path. Do not create a pane-specific transcript
cache or reducer, and do not write the child's ID into the main
`activeSessionId` as a rendering shortcut.

A non-Closed detail explicitly requests an arbitrary-session stream through the
shared stream lifecycle. The pane releases only the handle it opened; it must
not tear down a pre-existing handle or one owned by hot-session ingestion.
Closed detail hydrates persisted history read-only and opens no stream. The
embedded `MessageList` uses the same transcript-session target resolver as the
main transcript so cowork, linked-child, and ordinary-session navigation keeps
its existing workspace semantics.

This embedded transcript opts out of transcript content search
(`contentSearchEnabled={false}`). It must not register or paint matches for the
workspace Cmd+F surface while the active main transcript remains the search
owner.

Before merging transcript or stream-runtime changes, run focused coverage for
stream flushing, session runtime/history loading, transcript row modeling, SDK
transcript reducer immutability, plus:

```bash
pnpm --filter @proliferate/product-client typecheck
```

## Tool Result Rendering

Tool call rows should prefer product-specific renderers before the generic JSON
result row. The generic renderer is the fallback for unknown tools, malformed
payloads, and tool results that have no durable product display contract.

Product-specific result rendering must stay split by ownership:

```text
apps/packages/product-client/src/domain/chats/tools/<tool>-presentation.ts
  pure parser and display model for raw tool input/output

apps/packages/product-client/src/components/workspace/chat/tool-calls/<Tool>Row.tsx
  visual row/details rendering for that display model

apps/packages/product-client/src/components/workspace/chat/transcript/TranscriptToolCallItemBlock.tsx
  routing only; no product-specific parsing beyond choosing the row
```

`proliferate_skills` is a product MCP and has a transcript renderer:

```text
mcp__proliferate_skills__list_available_skills
  show listed skills as rows with skill id, description, required MCPs, and
  resource count

mcp__proliferate_skills__activate_skill
  show the activated skill as a card and render instructions as markdown

mcp__proliferate_skills__get_skill_resource
  show the loaded resource as markdown when the content type is markdown,
  otherwise as preformatted text
```

Do not render successful skills MCP results as raw JSON in the normal transcript
path.

## Markdown File Mentions And Code Blocks

Committed user-message prose renders through the shared `MarkdownBody` GFM
surface rather than as plain pre-wrapped text. Bold, italic, lists, links, and
other supported Markdown therefore render after submission. Raw HTML remains
text and unsafe URL protocols remain blocked. Product-client injects the same
workspace-aware link renderer used by assistant prose, so serialized workspace
file links continue to open in the file viewer while external links retain the
shared web-link presentation. User prose opts into transcript content-search
painting and removes only the outer first/last Markdown margins so the existing
message-bubble rhythm remains authoritative.

Assistant markdown renders file references as clickable file mentions and code
blocks as bordered highlighted cards. Ownership is split by package law:

```text
apps/packages/product-client/src/components/workspace/chat/transcript/MarkdownBody.tsx
  presentational markdown renderer; permissive urlTransform (blocks only
  javascript:/data:/vbscript:); injection props renderLink, renderInlineCode,
  renderCodeBlock; owns the code-block shell styling

apps/packages/product-client/src/components/workspace/chat/transcript/transcript-markdown.tsx
  ProductClient renderers injected at TranscriptItemBlock, ClaudePlanCard, and
  ConnectedProposedPlanItem: only workspace file references render FilePathLink
  mentions; external/web link hrefs defer to MarkdownBody's default anchor
  (ProviderLinkMention); fenced mermaid renders as a diagram when the fence is
  complete and mermaid can draw it, otherwise shiki-highlighted HTML in the
  shell; other fenced languages stay on that highlighted shell

apps/packages/product-client/src/components/workspace/chat/transcript/ProviderLinkMention.tsx
  shared inline provider-icon link mention + URL/host classification
  (isExternalHttpLink, linkHost); rendered by MarkdownBody's default anchor, so
  every surface (web + cloud chat included) gets icon links

apps/packages/product-client/src/lib/domain/chat/transcript/file-link-markdown.ts
  the one transcript scanner: complete balanced inline links, code/image
  context, escape counting, CommonMark title grammar, eligible local-path
  grammar, the pure render-copy repair, and streaming-tail stabilization
  (markdown-code-context.ts holds the code mask it builds on)

apps/packages/product-client/src/lib/domain/files/path-detection.ts
  pure path heuristics (looksLikePath, looksLikeFileReferenceHref,
  splitPathLineSuffix); move to product-client/src/domain/files only when
  Mobile also needs the same rule

apps/packages/product-client/src/lib/domain/files/path-references.ts
  the shared reference resolution seam, including the one raw-reference
  decode (decodeFileReferenceSpaces) that every mention and card goes through

anyharness .../domains/sessions/response_formatting.rs
  the prompt-side instruction (FILE_REFERENCE_INSTRUCTIONS) requiring markdown
  file links with the complete workspace-root path, never abbreviated
```

`transcript-markdown.tsx`'s `renderTranscriptLink`/`renderTranscriptInlineCode`
pair is injected across every current transcript-owned Markdown surface, with
the injection matched to whether the surface's text is assistant/skill-authored
or user-authored. Assistant/skill-authored bodies wire both renderers, so
path-like inline code becomes a file reference the same as an explicit link.
User-authored bodies wire `renderLink` only, so a link a user actually typed
still opens the file but a backticked path a user typed stays inert code —
never reinterpreted without a separate product decision:

```text
apps/packages/product-client/src/components/workspace/chat/tool-calls/SkillsToolResultRow.tsx
  assistant/skill-authored — instructions and resource-body MarkdownBody
  calls wire both renderLink and renderInlineCode

apps/packages/product-client/src/components/workspace/chat/transcript/TranscriptAgentGroupBlock.tsx
  assistant-authored — the delegated-agent result MarkdownBody wires both
  renderLink and renderInlineCode

apps/packages/product-client/src/components/workspace/chat/tool-calls/cowork/CoworkCodingToolLedger.tsx
  user-authored — the disclosed coding prompt wires renderLink only

apps/packages/product-client/src/components/workspace/activity/background-pane/BackgroundSubagentView.tsx
  user-authored — the "Initial prompt" panel wires renderLink only;
  SubagentLaunchLedger no longer owns any prompt Markdown

apps/packages/product-client/src/components/workspace/chat/content/PromptContentRenderer.tsx
  user-authored precedent the matrix above follows — wires renderLink only
```

Rules:

- Detection happens at render time from raw markdown; do not store parsed file
  references in transcript items.
- File-read and file-change callers keep raw wire paths separate from structured
  workspace-path metadata. Any structured string, including empty or
  whitespace, is supplied and authoritative; `null`/`undefined` alone permits
  raw classification. Human-readable labels may fall back to a nonblank raw
  path without changing that access decision.
- Streaming file-change identity uses only the raw `path` and `newPath`
  channels. A later supplied `workspacePath` or `newWorkspacePath` string is
  merged verbatim, so structured refinement—including an invalid blank
  value—updates one logical part instead of splitting it.
- A leading `~/` is an external Desktop file reference, not a workspace-relative
  path. Resolve it through the Desktop host's home-directory bridge before
  classifying or opening it; Web keeps the reference unavailable. Hidden path
  segments such as `~/.config` follow the same rule as any other home-relative
  path. A rejected home lookup remains unavailable and never substitutes
  `/tmp` for inspection, target discovery, open, or reveal.
- Once the assistant reveal frontier settles, the final unique Markdown file
  reference also renders as a compact end-resource card after prose. Its
  default subtitle identifies `Document · MD`; hover/focus changes that
  subtitle to `Open preview`. It remains completion chrome: never expose it
  while transport text is still buffered or its final opacity is settling. Its
  trigger consumes the file-reference action's `canOpenPrimary` capability and
  stays disabled, with a guarded handler, until that capability is true. It
  forwards the resource's raw path through the same canonical locator hook and
  never opens an optimistic preview before exact access settles.
- While prose is streaming, a trailing incomplete local-file link is closed
  only in the Markdown render copy so its file mention appears as soon as the
  destination begins. Never persist the synthetic delimiter or expose the raw
  partial absolute destination while waiting for the real closing delimiter.
  A tail is stabilized only when it is unambiguous: outside code and image
  syntax, on an explicit local-path prefix, with no open title, no unmatched
  nested parenthesis, and no line break.
- An explicit local-file Markdown link whose destination carries literal
  U+0020 spaces is repaired in the render copy: the destination is wrapped in
  angle brackets and only its literal spaces become `%20`, with a valid
  complete title moved outside the wrapper. Anything ambiguous, malformed,
  multiline, already wrapped, image-shaped, or non-local is left byte-identical
  rather than partially repaired. The repair is pure and idempotent, and the
  stored transcript, stream buffer, search source, clipboard source, and
  persisted history keep the original bytes.
- Eligible local syntax is `/` (not `//`), `~/`, `./`, `../`, or an exact
  drive root of one ASCII letter plus `:` plus one slash. Every URI scheme is
  excluded, `file:` included, because a scheme is an authority grant rather
  than path syntax. Glob metacharacters disqualify a destination; `?` and `#`
  are literal path characters in this grammar and are never treated as query
  or fragment delimiters.
- Both transformations run only for `surface="message"`, and stabilization
  additionally only while `isStreaming`. A `surface="file-content"` body runs
  neither: a Markdown file viewer shows the file's own bytes and must never
  silently rewrite them.
- A raw file reference gets exactly one decode on its way to the canonical
  locator: trim once, replace `%20` case-insensitively once, do not trim
  again, then split the terminal `:line[:column]`. Nothing else is decoded, so
  `%2F`, `%5C`, `%2E%2E`, `%00`, `%23`, `+`, and `%2520` stay literal and no
  encoding can manufacture a separator or traversal. The accepted tradeoff is
  that a real filename containing the literal characters `%20` resolves as a
  space-bearing name. An authoritative structured `workspacePath` skips this
  decode entirely and stays byte-identical.
- Syntax repair and href detection grant no filesystem authority. Every
  accepted reference still enters the canonical locator, which is what rejects
  a repaired `../My Notes.md` as traversal and decides whether a drive-root
  reference resolves at all.
- The end-resource card reads the same settled repaired copy, the same
  complete-balanced-link scan, and the same raw-reference decoder as the
  inline mentions, so prose and card can never name different documents. It
  never sees a synthetic streaming closure.
- Mention labels display the workspace-relative path plus a `(line N)` suffix;
  raw absolute hrefs must not be shown as label text.
- External/web link hrefs render as a shared inline provider-icon mention
  (`ProviderLinkMention`): a GitHub brand SVG for github hosts, otherwise the
  site's own favicon — `https://<host>/favicon.ico`, falling back to the root
  domain's favicon, then no icon. It is `MarkdownBody`'s default anchor, so every
  surface gets it (web + cloud chat included); URL detection
  (`isExternalHttpLink`) runs before file-path detection so a real path is never
  mistaken for a link. Favicon requests go to the linked site itself (no
  third-party favicon service), so no list of linked hosts leaks anywhere. The
  provider mention and the file-path mention share one inline-mention treatment
  (semantic blue link color, no underline at rest, and a dashed underline on
  hover); this only renders because the global `a` reset lives in
  `@layer base` (see the frontend styling guide) — unlayered, it would strip the
  anchor's color/underline.
- Web falls back to unhighlighted (identically styled) code blocks; shiki stays
  out of the web bundle.
- Completed fenced `mermaid` blocks render as diagrams through `MermaidDiagram`,
  dispatched from `renderTranscriptCodeBlock` and `renderDesktopCodeBlock`.
  Incomplete streaming mermaid fences and invalid or unsupported syntax stay on
  `CodeBlock`. A closed mermaid fence keeps its diagram while a later mermaid
  fence is still open, including when both blocks have the same source. Copy
  always writes the original mermaid source, not SVG.
- Diagram SVG is sanitized with DOMPurify's SVG profile (`USE_PROFILES` svg and
  svgFilters, `FORBID_TAGS` `script` and `foreignObject`) plus the transcript
  URL policy that blocks `javascript:`, `data:`, and `vbscript:`. Mermaid is
  initialized only by one module-level renderer, with `startOnLoad: false`,
  `securityLevel: "strict"`, `htmlLabels: false`, and
  `suppressErrorRendering: true`. Parse and render failures stay on `CodeBlock`
  and are not reported to Sentry or diagnostics. Observability delta: none.

## Contextual Assistant-Text Actions

A non-empty native text selection wholly contained by one assistant prose
block opens the selected-response action menu. The transcript selection hook
owns detection and dismissal; the menu owns only presentation and keyboard
navigation.

Transcript-wide selection uses the same native selection surface. When the
active chat surface owns the command, primary Select All (`Cmd+A` on macOS,
`Ctrl+A` elsewhere) must create a visible, non-collapsed range across every
rendered transcript row whether the command arrives from a WebView keydown or
the Desktop native Edit menu. It must not require an earlier pointer selection.
Transcript prose keeps the WebView's native selection paint; the chat surface
must not replace it with the text-entry/editor selection token.
Composer text entries, terminal zones, and browser zones keep command ownership.
Copying an exact transcript-root selection serializes the complete loaded
semantic transcript so DOM virtualization cannot truncate the clipboard text.

Rules:

- Preserve native selection and copy behavior. Assistant prose may be selected
  across inline links and code. Transcript controls marked as ignored chrome,
  user prompts, tool rows, and selections spanning multiple assistant responses
  do not qualify.
- Pointer selection opens the menu after pointer-up. Keyboard selection opens
  it after the browser's `selectionchange`; Context Menu or Shift+F10 moves
  focus into its roving menu items without changing the selected text.
- The menu uses the native range rectangle as a virtual anchor and collision
  handling keeps it in the viewport. Scrolling updates the anchor while any of
  the selection remains visible and dismisses the menu after it leaves the
  viewport.
- Clearing the selection, clicking outside, Escape, or choosing an action
  dismisses the menu. Escape restores transcript focus; pointer dismissal does
  not steal focus.
- `Add to chat` attaches the exact selected text to the current workspace
  composer and focuses the editor. `More details` sends a quoted follow-up to
  the current chat. `Ask in side chat` starts a separate normal chat tab with
  the current launch identity. Both immediate-send actions preserve any draft
  already in the composer and surface the existing availability reason when a
  send is blocked.

The selected text is serialized as one quoted context section. Transport text,
prompt blocks, and optimistic content are parallel representations of that one
prompt, not separate context inserts.

## Delegated-Work Receipts

Agent creation, lifecycle changes, messages, and completion notifications are
durable transcript events. They render as Agent Operations product receipts,
not as raw MCP mechanics or ordinary user-message bubbles.

The pure Workspace MCP parser owns the wire-to-presentation boundary:

```text
apps/packages/product-client/src/domain/chats/tools/agent-operations-tool-presentation.ts
  exact mcp__proliferate_workspace__<tool> classification and typed receipt projection

apps/packages/product-client/src/domain/chats/tools/agent-operations-tool-wire.ts
  flat native-call and provider-neutral MCP-envelope normalization

apps/packages/product-client/src/components/workspace/chat/tool-calls/AgentOperationsToolActionRow.tsx
  compact mutation receipts and expandable raw details

apps/packages/product-client/src/components/workspace/chat/transcript/AgentMessageReceipt.tsx
  shared left/right agent-message grammar
```

Workspace reads (`whoami`, list/get/options calls, and `get_task_output`) remain
generic foldable work. A structured-only read result is formatted into the
existing expandable generic result row with the Proliferate mark; malformed or
absent output keeps the non-expandable Proliferate-mark fallback. Workspace
reads that name one durable `agentId` (`get_agent`, configuration options, and
task output) keep the same foldable row but replace the product mark with that
agent's Solid Seal. Workspace
mutations (`create_workspace`, agent create,
configure, resume, message, interrupt, Close, Open, and Promote) bypass generic
history folding so their receipts remain visible after turn completion. The
MCP parser consumes direct `AgentView` lifecycle outputs, the configure
`{agent, applyState}` wrapper, the send `{target, queueSeq, status}` wrapper,
and the workspace `{workspace, creationMode}` wrapper. It must not accept the
HTTP lifecycle `{agent, relationship}` envelope.

The presentation boundary accepts either the exact flat native name
`mcp__proliferate_workspace__<tool>` or the provider-neutral Codex MCP envelope
`{server, tool, arguments}` when `server` is `proliferate_workspace` or the
historical transport id `workspace`. It canonicalizes the latter's
`arguments` and `rawOutput.structuredContent` before presentation and strict
authority checks. This does not restore `mcp__workspace__*` as a native-name
alias.

Agent identity follows one rule on every surface: only a durable runtime
session ID mints the Solid Seal glyph. Existing-target mutations may use their
`agentId` input while running or failed because that field is the durable
address; a create call waits for its output `identity.sessionId`. Relationship,
tool-call, prompt, and ProductClient session IDs never mint a glyph. When a
directory entry maps a durable ID to a ProductClient client-session ID, the
durable ID continues to seed the glyph while navigation uses the mapped client
ID. Cross-workspace navigation also requires the directory or direct
`AgentView.workspace.workspaceId`; an unresolved location stays non-clickable.
An in-progress or failed create uses the Proliferate product mark because no
durable created-session identity exists. A successful create replaces that
product-level attribution with the returned agent's Solid Seal.

Creation grouping belongs in the transcript presentation layer:

```text
apps/packages/product-client/src/domain/chats/transcript/transcript-presentation.ts
  buildTranscriptDisplayBlocks
```

Rules:

- Group only adjacent `create_agent` calls whose input `kind` is `subagent`.
  Ordinary-agent creation and every send, lifecycle, read, search, and generic
  tool call terminate the run.
- The run key is its first tool item ID. Appending a settled creation therefore
  adds a chip without remounting the existing run.
- Each settled durable identity is a 28px chip containing a 16px Solid Seal.
  The line ends with the quiet phrase `started working`. A failed create may
  show its real task text in a neutral failure capsule but must not invent a
  glyph. An in-progress or failed create with no authoritative output identity
  uses the Proliferate product mark and never mints a provisional identity. The
  trailing phrase is also the accessible disclosure for each
  create call's distinguishable structured result or failure detail.
- Each newly settled live chip receives one 280ms opacity-and-scale pop keyed
  by its tool item ID. Existing chips never remount, and hydrated, revisited,
  virtualized, or reduced-motion presentations stay static.
- A chip opens the returned session only when its workspace/session target is
  authoritative. Replayed creation runs remain visible outside completed work
  history.

Communication receipts:

- Outgoing `send_message` renders on the left as identity chip then the quiet
  verb `messaged`. Agent create/configure/resume/interrupt/Close/Open/Promote
  use the same chip-first grammar (`created`, `configured`, `resumed`, and so
  on). Running and failed rows use truthful progressive/failure verbs rather
  than success copy.
- Incoming `agentSession`, `subagentWake`, and `linkWake` prompts render on the
  right as one receipt and never as a user bubble. The exact message is
  available on mouse hover and keyboard focus, including when identity is not
  yet resolved. Unresolved labels are width-bounded and truncate without
  removing that exact-message disclosure.
- Wake identity and outcome come only from
`linkCompletionsByCompletionId`. Missing completion projection renders a
  neutral `updated` receipt with no glyph and never claims success. Resolved
  outcomes use `finished`, `failed`, or `cancelled`. The composer queue
  subscribes to this structurally shared index directly rather than to the
  full active transcript, so unrelated stream batches do not invalidate it.
- Directory relationship metadata determines whether a resolved incoming
  source opens as generic, linked-child, or cowork. Relationship hints and
  open actions use the mapped ProductClient session ID, never the durable glyph
  seed when those IDs differ.
- In the selected workspace, authoritative subagent creation chips, Agent
  Operations receipts, incoming agent-origin receipts, and pending
  `From subagents` glyphs open the child's Agents-pane detail without selecting
  a chat tab. A receipt whose current relationship is ordinary/promoted,
  cowork, review, or another non-subagent relationship keeps its existing
  transcript/session navigation.
  Historical subagent provenance is not enough to override a conflicting live
  relationship.
- Close preserves the same glyph and dims that glyph to 45% opacity only after
  a successful/actually closed result. Open and Promote restore/reuse the same
  durable identity; a failed Close is not dimmed.
- A successful Promote result records root authority for both the durable
  runtime ID and its mapped ProductClient session ID. Receipt replay, directory
  relationship hints, roster refreshes, and header hierarchy refreshes must not
  resurrect that session as an Agents-pane child; the Promote receipt and later
  opens route to the ordinary session.
- Compact rows keep detailed structured output inspectable through their own
  quiet verb or operation mark. They do not add a second generic tool glyph.
- `create_workspace` uses a one-line Proliferate-mark receipt and a lower-case
  provenance phrase such as `worktree from main`. Opaque repository IDs are
  never shown as labels. Its Open action passes the returned `WorkspaceView`
  as `knownWorkspace`, because the collections cache may not contain a newly
  created workspace yet.

Pending agent-origin prompts are hidden from the ordinary editable queue and
reduced to one final `From subagents` aggregate after user/review rows. The
aggregate shows one deterministic 14px glyph per resolved durable sender in a
20px overlapping shell, the total update count, and no edit/delete/reorder
controls. Unresolved wake prompts count toward the total without creating a
glyph. An authoritative same-workspace subagent glyph opens the Agents-pane
detail; a promoted or otherwise non-subagent target uses its current session
route. Reordering replaces only eligible runtime-owned plain-message slots;
review, local-outbox, and hidden-agent slots retain their exact positions in
both optimistic rendering and the compare-and-swap payload. A pending glyph
is clickable only when directory metadata supplies an authoritative workspace,
and navigation uses its mapped client-session ID.

`mcp__proliferate_workspace__*` is the only native-name Product MCP input to
these Agent Operations renderers; the trusted Codex transport envelope above
canonicalizes to that namespace. Removed `mcp__subagents__*` names have no
compatibility classification or navigation fallback, and
`mcp__workspace__*` is not a native-name alias. Unrecognized historical tool
records use generic tool rendering.

Native harness subagents use the same durable item stream as the parent turn:

- The native `Agent`/`Task` spawn operation is one stable tool item from start
  through completion or failure. It remains visible while running and after
  replay.
- Child events carry `parentToolCallId = <native spawn tool id>` and render
  inside that parent in runtime sequence order. Claude currently supplies child
  prose, reasoning, and tools; Codex currently supplies collaboration lifecycle
  and activity tools, not the child thread's full prose/reasoning stream.
- Provider adapters emit `_meta.anyharness.parentToolCallId`. The sink accepts
  Claude's older `_meta.claudeCode.parentToolUseId` only as a compatibility
  fallback, after the provider-neutral field.
- Session activity roster upserts are summary state, not transcript content.
  They must never synthesize a second copy of native subagent work.
- Live stream application deduplicates by durable sequence and orders batches
  before reduction. Persisted replay consumes the same normalized item events,
  so identity, nesting, ordering, and terminal status must match.
- Missing or ambiguous parent identity is not inferred. Such events stay at the
  root rather than being attached to a guessed child group.

## Layout Invariants

Some layout dimensions are load-bearing. They are tuned together so specific
UI transitions stay visually smooth. Changing one without the others can
reintroduce scroll/layout bumps.

### Spacing Rhythm

Sibling spacing inside a turn comes solely from the shared turn-container
`gap-4` (16px conversation-item rhythm), and turn rows are
separated by `TurnShell`'s `pt-2 pb-2` (`pt-0` for the first row). Pending
prompt rows use the same shared gap so materialization is layout-stable. Blocks
must not carry external vertical padding of their own
(`TranscriptActivityBlock` is a zero-padding marker wrapper), and spacing must
not vary with streaming state: a turn completing is a zero-delta layout change
for everything already rendered.

Completed tool/reasoning history uses one left-aligned disclosure labelled
`Worked for {duration}`. Its expanded ledger remains underneath that row, and a
single full-width `border-border` hairline separates the work block from the
final answer. Do not render centered labels with rules on both sides, a
separate `Final message` separator, or hairlines between assistant prose
items. Top-level prose and activity blocks inside the expanded history restore
the same `gap-4` conversation-item rhythm; the tighter `gap-1` (4px) grouped
rhythm is reserved for detail rows within one expanded activity. The reveal
gap between the `Worked for…` disclosure and its body is also 4px (`mt-1`). If
the user stopped the turn, the same disclosure is labelled
`You stopped after {duration}` instead; do not add a duplicate stopped footer
beneath it. A stopped turn with no completed-history disclosure may use the
standalone notice as a fallback.

While work is live, the collapsed activity header represents exactly one
current action and its matching icon (`Reading file.ts`, `Running command`,
`Searching files`, and so on). It must never turn completed ledger history into
a cumulative live status such as `Running 4 commands`; prior work stays
available only inside the disclosure. A trailing exploration batch retains
that one live header between adjacent completed search/read events while the
turn remains in progress. Prose, a different trailing block, or turn completion
ends the phase immediately; a generic tail status must not flash between those
events.

Completed activity headers use short, count-free verb phrases such as
`Edited files, read files, ran a command`; exact counts stay in the expanded
ledger. One representative phrase summarizes exploration work so mixed
read/search/list/fetch batches stay concise. The dominant semantic icon follows
an `edit > search/list > read/fetch > command` hierarchy (so a mixed
search/read row may say `Read files` while using the search glyph). Semantic
icons and labels share the same 60%-foreground ink, and the icon box scales
with transcript text instead of using a fixed pixel size. The disclosure
chevron remains layout-reserved but hidden until hover/focus or expansion.
Clicking the completed activity summary, including a summary containing edits,
toggles its ledger; the summary does not route to the Changes pane.
Every row revealed inside an activity ledger repeats its own semantic glyph
(including mixed parsed shell operations), at the same text-relative size and
inherited ink as its label. Completed command details use `Ran …`; only the
active command uses `Running …`. A read target with missing nullable workspace
metadata is classified from its raw path against the current workspace root.
An openable file target uses the semantic blue link color even though the
surrounding activity row is muted: a workspace file opens in the viewer, while
an external Desktop file uses the configured external target. It remains
pointer- and keyboard-activatable while retrying path resolution or a failed
external launch. A read target with no available primary action remains muted
plain text without link or file-menu semantics rather than a disabled control.
An edit detail shows one pen glyph followed by an inherited-color,
dotted-underlined filename, not a second file-type glyph.
When a transcript patch is available, clicking the edit row outside its
filename toggles the inline diff. Clicking either the filename or the trailing
open-file arrow opens the file without changing the row's expanded state. The
row retains the file-reference context menu. Edit
counts remain neutral beside the filename until row hover or focus within the
row gives additions and deletions their semantic colors.

The completed-turn changed-files card uses one aggregate header and flat file
rows. Multi-file cards show the first three paths, then a `Show N more files`
row; each path splits muted directories from the foreground basename and keeps
its `+`/`-` totals right-aligned. Do not add a per-file disclosure chevron or a
second visible disclosure control: clicking the file row itself toggles its
inline diff, while the trailing arrow opens that file without toggling. The
aggregate `Edited N files` header opens Changes and immediately swaps aggregate
stats for `Review changes` on hover/focus. File headers retain the shared diff
line-wrap context menu. Aggregate and file-row stats use the semantic dark-theme
green/red tokens (`#40c977` and `#fa423e`) and roll changed digits over 300ms
with the standard enter curve; reduced-motion users receive no digit transition.
Right-clicking a transcript file reference, edit filename, or diff line-wrap
trigger clears any WebKit contextual word selection synchronously in the
`contextmenu` handler before the replacement menu opens, since macOS WebKit
selects the word under the pointer inside its own context-menu path and
`preventDefault` cannot stop it. The clear only fires when both the
selection's anchor and focus nodes are contained by the right-clicked
element; a selection made elsewhere, or one with an endpoint outside that
element, is left untouched. This is chrome behavior; it does not apply to
selecting or right-clicking transcript prose or code-block text itself.

Single-file cards put the filename in the header and do not duplicate a file
row underneath. Expanded multi-file cards collapse through `Collapse files`.
The shell follows a restrained three-level surface hierarchy: its header
and show-more row share a low-contrast raised surface, the file rows use the
main transcript surface at partial opacity, and one standard hairline separates
the header from the rows. Do not substitute higher-contrast stacked bands.
Only the row under hover or keyboard focus gains the stronger list tint.
The header's 40px secondary tile uses the filled plus/minus file glyph at 24px,
matching the completed-diff summary rather than the pen glyph used by live edit
activity.

New activity blocks may use one compositor-only opacity/short horizontal
entrance. The motion is claimed once by stable item identity in the latest
in-progress turn. Hydrated history, completed-history expansion,
virtualization remounts, and session revisits must render statically, and
reduced-motion preferences disable the entrance.

### Stick-to-bottom engine

Bottom pinning is owned by one shared engine,
`apps/packages/product-client/src/hooks/chat/ui/use-transcript-stick-to-bottom.ts`,
consumed by both `FullTranscriptRowList` and `VirtualizedTranscriptRowList`. It
distinguishes user scrolls from its own programmatic snaps (`notifyProgrammaticScroll`
tags every `scrollTop`/`scrollToOffset` write the engine or its callers make) so
a streaming snap can never fight a user scrolling up. Intent to leave is detected
pre-emptively via passive `wheel`/`keydown`/`touch` listeners on the viewport,
flipping the pin state *before* the next snap layout effect reads it. Re-pinning
happens only when a user scroll lands within a tight bottom band
(`REPIN_BOTTOM_THRESHOLD_PX`), not the retired 96px `STICKY_BOTTOM_THRESHOLD_PX`
window — that loose window kept small upward scrolls "pinned" and let the snap
yank the user back.

Positive, direction-aware user intent also owns transcript rendering while the
gesture is active. A wheel, scroll key, touch move, or custom-thumb drag that
can actually move the viewport opens a 150ms priority window; a no-op gesture
at either scroll boundary does not. Opening the window synchronously cancels
the paced prose reveal frame, then renders from the last committed transcript
snapshot so stream batches, row derivation, Markdown work, and measurement do
not compete with native scroll paints. Unclassified native scroll events may
extend an already-open window for momentum, but cannot open one; tagged
programmatic follow and anchor writes never open or extend it. The newest
snapshot publishes after the final sample settles, and prose reveal resumes
from the exact visible prefix at its normal bounded rate rather than jumping to
the buffered target. Snapshot authority updates only after a committed layout,
so an interrupted concurrent render cannot leak state or scope into the hold.

While pinned, content growth re-sticks the viewport: the non-virtualized list
via a `ResizeObserver` on the scroll content plus a per-commit layout effect, the
virtualized list via measured `totalContentHeight`; both call the engine's
`scrollToBottom`, which writes `scrollTop = scrollHeight` (never
`virtualizer.scrollToIndex`, which bounces on unmeasured rows). On tab/window
re-show while pinned, a short pre-paint rAF "glue" loop holds the viewport at the
true bottom until row measurement settles, collapsing the resume backlog into one
jump instead of a visible crawl.

Submitting a prompt is an explicit return-to-bottom intent. The engine itself
detects the submit through its `lastPromptSubmittedAtMs` option: the newest
creation stamp across the session's prompt outbox plus the session-level
optimistic prompt (`lastPromptSubmittedAtMs` in the intent selectors, wired
down from the transcript view model). Every prompt send enqueues an outbox
intent — including queue-placed sends, which never render as transcript rows —
so the stamp rises exactly once per send, and a monotonic increase re-pins,
snaps, and runs the same glue loop so the composer collapse and new-row
measurement settle land as one silent jump, even when the pin was silently
lost earlier. Entries leaving the outbox (materialization, delivery,
dismissal) can only lower the stamp and must not re-pin. Unlike the
scroll-to-bottom button, a submit does not consume the manual-only overlay
range: auto-follow keeps targeting the soft bottom above any dock-slot card
(a range the user already consumed stays consumed until they scroll away).
Interaction resolutions (answering an inline question or permission request)
are `resolve_interaction` intents, not sends, and do not re-pin today.

When the transcript is shorter than the viewport, both row-list paths
top-align the conversation (no `mt-auto` bottom anchor): a fresh conversation
reads from the top, and unused viewport height sits below it,
between the last row and the composer. Content grows downward until it fills
the viewport; only from that point on does the composer-relative frontier
contract above take over (pinning, re-stick, stable frontier coordinates).

When the user is unpinned, a completing turn that splits one row into
`completed-history` + `content` (a new, unmeasured row inserted above the anchor)
would bump the viewport as the 360px estimate corrects. The virtualized list
holds the anchored content with the measured `scrollHeight` delta in a
stability-gated loop; the non-virtualized list relies on native browser scroll
anchoring (`overflow-anchor`, left at its default) for the small seam.

An older-history prepend installs the same kind of anchor, but as a
non-cancelable owner: it holds the reading row's seat against upward intent and
against the frame scheduler draining. That seat is acknowledged, and the owner
released, only when a writer pass observes the seat held in a frame that saw no
native scroll activity. A seated read taken while a native scroll is still
delivering proves only the main-thread `scrollTop` at that callback — a wheel or
momentum continuation queued before the prepend can keep eroding the position
afterwards, and releasing on that read both stops the writer and drops the
protection that would have re-armed it, stranding the reader at the top. Erosion
is re-corrected through the same single writer; the retention is bounded by the
existing quiet-extension and absolute compensation deadlines, which release the
anchor regardless.

Cards mounted above the composer (permission/question panels, slash-command
trays, queued messages, goals, and similar dock slots) are overlays, not a
reason to reposition existing transcript pixels. Their measured height is the
`nonDisplacingBottomInsetPx` portion of the full bottom inset: it is rendered as
absolutely positioned overflow beyond the bottom-anchor frame, adding scroll
range without participating in its layout. The user can manually bring the
transcript end above the obstruction, but changes to that portion alone must
not trigger a pinned snap or a content `ResizeObserver`/visibility-glue snap.
Normal auto-follow targets the soft bottom before this range. Once the user
deliberately reaches the hard bottom, auto-follow preserves the consumed range;
if another card stacks, only its newly added height remains manual-only. If a
consumed overlay shrinks or disappears, the browser's upward clamp to the new
hard bottom is layout movement, not user intent, and must preserve the pinned
state. Composer-surface height remains structural and continues to re-stick
promptly when the input itself grows. A shrink of the derived structural
inset (the stable dock reserve minus the non-displacing offset-top share,
recomputed from fresh rects inside the ResizeObserver callback by the same
code path a measure commits, and compared against the widest of the last
committed structural inset and the last measure-read one — a measure whose
commit is still pending must be able to raise the shrink baseline but never
lower it) flushes the inset re-measure synchronously —
still pre-paint — instead of deferring a frame, so the collapse frame never
paints against the stale taller inset and then drops the whole transcript a
notch. This covers any structural collapse (submit, Escape-clear, deleting
across a line wrap), and only structural collapse: a queued send mounts its
outbound card in the very commit that collapses the surface, so the dock rect
can net-grow while the structural inset shrinks (sync flush), while a
dock-slot card dismissal shrinks the dock rect without touching the
structural inset (stays on the deferred path — that movement is the
non-displacing overlay share). Growth keeps the rAF-coalesced next-frame
path.

A send intent with `placement: "queue"` is represented by the composer's
outbound queue and must not also produce a transcript row. A queued send that
fails before dispatch remains eligible for transcript error presentation. A
`pending_prompts_reordered` event is a complete queue replacement, including
the same immutable runtime-owned sequence identities in their committed array
order; consumers must not treat it as an incremental move event. Sequence
numbers never change during reorder and are never reused for a later entry.

### Streaming Handoff

The transcript has two distinct bottom concepts:

1. The **frontier** is the final visible thing the agent is doing: `Thinking`,
   a live tool/action row, or streaming/final prose.
2. The **assistant footer** is a permanent `h-6` row below the last frontier.
   It is empty while the turn is live, swaps in place to copy/timestamp/goal
   controls when final prose exists, and stays empty for a tool-only, stopped,
   or errored completion.

The frontier must remain at one composer-relative coordinate through pending
prompt ownership, materialization, live tool work, streamed prose, and
completion. The footer belongs below it and must never cause final prose to
move upward when its controls appear.

| Piece | Location | Value |
| --- | --- | --- |
| Frontier sibling gap | `TURN_ITEM_GAP_CLASS` in `TranscriptTurnChrome.tsx` | `gap-4` (16px) |
| Pending/materialized working-status frame | `renderWorkingTrailingStatus` in `TranscriptTurnChrome.tsx` | `flex h-6 items-center` |
| Empty/completed assistant footer | `TurnAssistantActionRow` in `TranscriptTurnChrome.tsx` | `h-6` (24px) |
| Message/status line-height | `--text-message--line-height` (aliases the appearance chat scale) | Dynamic; `22px` by default |

Additional dependencies:

- Pending `TurnShell` rows must pass `showCopyButton` to `UserMessage`, or the
  pending bubble becomes shorter than the real row that replaces it.
- Pending and materialized working states use the exact same centered `h-6`
  frame. Do not wrap one path in an additional non-flex `h-6`; the indicator is
  taller than the slot and divergent overflow alignment creates a visible
  handoff nudge.
- The pre-workspace `ChatLaunchIntentPane` uses the same top-aligned
  `TurnShell` sequence, copyable user-message geometry, `gap-4` frontier, and
  empty footer as the projected pending row (its `pt-4` matches
  `TRANSCRIPT_TOP_PADDING_PX` so the handoff does not nudge). It also uses the transcript's
  stable structural inset and separate non-displacing overlay range, not the
  smaller auto-scroll inset. Launch -> pending -> materialized is an ownership
  handoff, not a layout transition.
- Pending and materialized `needs_input` markers share the same `h-6` frame.
- Retry/dismiss recovery controls on an uncertain pending send render above its
  frontier. The fixed assistant footer remains the last row.
- Prompt submit should clear the chat input before awaiting prompt delivery;
  otherwise the same message can appear in the composer and transcript at the
  same time.
- `latestStreamingAssistantProseRevision` controls whether the trailing
  status renders. Only prose that is *actively streaming* suppresses the
  indicator: while text streams, the growing prose is the placeholder. The
  moment transport prose completes with the turn still in progress (thinking
  or preparing a tool call), the trailing indicator becomes eligible only
  after the prose's visual reveal and final opacity settle complete.
  Never insert the generic working indicator into a quiet gap inside actively
  streaming prose; the answer retains frontier ownership until its prose item
  completes visually. A following thought or live tool/action row also remains
  withheld behind that visual frontier, then takes ownership when the reveal
  settles; transport arrival alone must not overlap it with buffered prose.
  Inferred silence alone never creates another frontier row.
  The indicator is a frontier row above the assistant footer; it must never
  occupy the footer itself.
- Streaming prose uses one paced, source-ordered reveal frontier. Completed
  words stay fully opaque; each recent word receives its own uniform opacity
  fade, and a later line must not render until the frontier reaches it. A later
  word begins fading before earlier word fades finish, rather than replacing
  or prematurely completing them. The reveal must not sweep a gradient through
  the individual letters of a word. Once a source prefix has settled, a
  transport pause, completion transition, or transcript-row remount must never
  place that prefix back into fresh fade spans; only newly revealed source may
  animate.
  Pace the frontier behind a small token reserve so
  transport batches do not read as alternating bursts and pauses, with a hard
  maximum of 360 source characters per second; accumulated ordinary batches
  must never trigger an adaptive catch-up jump. Initial live chunks, reconnect
  batches, and newly completed short answers all enter through the same capped
  frontier; a corrected stream rewinds to its shared source prefix before
  resuming at the cap. Presentation or virtual-row key changes may remount the
  prose component; retain a bounded item-level visible-prefix claim so the new
  instance begins at exactly the prior painted source length and continues at
  the cap. A remount must never replay from zero or expose the buffered suffix
  in one paint. Only hydrated history opts out and renders immediately. When
  transport streaming completes, continue draining any
  buffered suffix at the same capped speed. Then finish the newest word's fade
  and leave all prose fully opaque; never strand the last word halfway through
  its fade. Reveal commits are cadence-bounded (32ms) so Markdown parse,
  and reconciliation do not run on every display frame. After the 320ms
  final-opacity fade, retain the completed prose
  frontier for a 160ms quiet handoff before releasing a following thought,
  tool, or status row.
  Completion-only chrome (copy/timestamp, goal marker, stopped notice, and turn
  diff) stays hidden or reserved until that final opacity settle reports
  complete. Reduced-motion preferences render the complete available prefix
  without reveal motion.
- `TurnAssistantActionRow` renders its fixed footer when `reserveSlot` is true
  even before assistant prose exists. The latest materialized turn and pending
  prompt both reserve it; a completion without copyable prose keeps it reserved.
  The reserved frame remains `h-6`, but the row uses a `-mt-2.5` offset against
  the ordinary 16px transcript sibling gap, yielding a 6px visual gap
  between final content and assistant actions without changing handoff height.
- Completion-only surfaces such as file-diff and artifact cards mount before
  the frontier item. They may grow upward as data arrives, but must never be
  inserted between final prose and its fixed footer. When completed-history UI
  exists, those cards remain inside the work block and above its single
  hairline; the hairline still directly separates all work from final prose.
  Full-turn artifact cards render only in the split row that owns final prose.
- A completed turn presents its final assistant prose last even when tool or
  file-change receipts have a later runtime sequence. Those non-final roots
  belong to completed work history above the prose; arrival order must not put
  activity below the final frontier. Goal-boundary partitioning assigns final
  prose the latest non-final work seq for slicing so it stays in the last turn
  row without crossing a goal event that occurs after all turn work.

If you change any pinned value, update every file in the table at the same time
and verify the full sequence: submit -> immediate Thinking -> materialized
Thinking -> live command -> streamed final prose -> copy/timestamp. The
frontier must not move at any handoff.
