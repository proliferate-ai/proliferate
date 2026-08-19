# Workspace Files

This doc covers the desktop workspace Files, file viewer, Changes, and
all-changes review surfaces.

## Product Boundary

Files is filesystem navigation from file-viewing surfaces:

- open file viewer targets from chat links, command-palette results, git rows,
  the file viewer browser overlay, and the file viewer search modal
- browse directories from the overlay attached to file/diff viewing surfaces
- search workspace files from the command palette or the file-viewer-local
  search modal

Files is not a standalone durable right-panel tool. The old Files pane/tab must
not be rendered in the shared right-panel header.

Changes is changed-file workflow:

- render one flat review document: per-file sections with sticky headers,
  expanded by default, no card grid and no staged/unstaged section boxes
- one target dropdown picks what the review diffs against — working tree
  (composite), branch vs base, or last turn; staged/unstaged are no longer
  top-level filters (they survive as internal data modes)
- every file header always shows real +N/−N counts (the runtime returns
  numstat with the changed-file list); status letters are gone — quiet word
  chips mark `deleted`/`renamed`/`copied`/`binary`, and a `staged` chip
  disambiguates a partially staged file that appears twice in the composite
  view
- header carries the aggregate counts, a jump-to-file menu, collapse-all,
  a branch line (`current → base` in branch mode), and a Commit-or-push
  split button that opens the shared publish dialog
- per-row stage/unstage buttons are removed — staging decisions live in the
  commit flow (hunk-level stage/unstage pills on working-tree diffs remain)
- open per-file diff viewer targets
- open an all-changes review target
- review the latest completed turn as a transcript-backed file filter over
  current git diffs

In the review document, unchanged diff lines sit on the plain pane background
(only +/− rows are tinted) and hunk-gap separators render as slim inset
strips with rounded ends — both scoped by `[data-git-review-document]` in
design `product.css`.

Commit, publish, and pull-request dialogs may summarize change counts and
staging state, but they do not duplicate the changed-file roster. Detailed
paths and diff review remain in Changes, reached through Review changes.
They share one compact source-control modal with an internal Commit, Publish,
and Pull request switcher. Switching intent keeps the current drafts while the
modal is open; closing and reopening starts with clean drafts.

Scratch is local workspace notes:

- store one plain Markdown scratch pad per workspace in Proliferate app data
- keep scratch content out of the workspace repository
- render as the default right-panel tool without forcing the panel open

The durable right-panel tool id remains `git`; “Changes” is a display label.

## Viewer Targets

Center tabs use `ViewerTarget`, owned by
`apps/packages/product-client/src/lib/domain/workspaces/viewer/viewer-target.ts`.

Supported targets:

- `file`: editable/readable file view
- `fileDiff`: one file diff for `unstaged`, `staged`, or `branch`
- `allChanges`: a scoped multi-file review view
- `promptAttachment`: an ephemeral read-only image or text-resource preview
  originating from a composer draft or submitted session prompt

Shell-tab keys are `viewer:<base64url-json>`. The encoded payload is canonical:
optional fields normalize to `null`, refs are trimmed, and UTF-8 paths are
encoded through the shared base64url helper. Legacy persisted `file:<path>`
keys are read as file viewer targets and written back as `viewer:*`.

`promptAttachment` identity includes its `draft` or `session` origin,
attachment id, display name, MIME type, optional size, image/text-resource
kind, and upload/paste source. Draft targets may include an in-memory object
URL and must not include a session id. Session targets never include an object
URL; they resolve the attachment through the existing session resource access
path and may temporarily have no usable session id while queued or optimistic
identity is incomplete, in which case the viewer shows an unavailable state.

Prompt-attachment targets are session-local UI state and are never persisted.
Shell-tab seeding and right-panel preference sanitization discard them on
write and restore. Draft object URLs must never be copied into durable state,
logs, workspace files, or submitted session targets. Their lifetime is owned
by
`apps/packages/product-client/src/hooks/chat/ui/use-prompt-attachments.ts`:
removal, submission, scope
change, and unmount first remove every matching viewer target and materialized
right-panel header through
`apps/packages/product-client/src/hooks/chat/workflows/use-prompt-attachment-preview-actions.ts`,
then revoke
each owned URL exactly once. Closing the viewer alone leaves the draft and its
URL intact. Submitted attachment blobs and derived object URLs remain owned by
`apps/packages/product-client/src/hooks/access/anyharness/sessions/use-prompt-attachment-url.ts`;
draft and
session text reads, cancellation, and identity reset are owned by
`apps/packages/product-client/src/hooks/access/prompt-attachments/use-prompt-attachment-text.ts`.
The read-only presentation surface is
`apps/packages/product-client/src/components/workspace/files/PromptAttachmentViewer.tsx`.

`working_tree_composite` is UI-only. It is never passed to git diff queries.
It renders separate unstaged and staged sections, and rows open `fileDiff`
targets with the concrete section scope.

`last_turn` is also UI-only. It belongs to the right-sidebar Changes pane and
filters current git diffs to files reported by top-level `file_change` transcript
parts in the active session's latest completed turn. It uses the runtime
`base_worktree` diff scope internally, but `base_worktree` is not a center
viewer target scope.

## State Ownership

Remote filesystem and git data belongs to SDK-react/TanStack Query:

- directory listings
- file reads/stat/search
- git status
- branch changed files
- diff bodies

Zustand stores only local UI/editor state:

- `workspace-viewer-tabs-store.ts`: open targets, active target, per-target
  mode/layout
- `workspace-file-tree-ui-store.ts`: expanded folders, selected folder,
  create draft
- `workspace-file-buffers-store.ts`: local editable drafts, base version token,
  save/conflict state
- `workspace-change-review-store.ts`: session-local viewed state for
  all-changes rows

Closing a viewer target deletes its mode/layout entries. File buffers are not a
server read cache; they exist only for local editing and conflict metadata.

Scratch content belongs to Tauri app-data access hooks. It is a local external
resource, not Zustand state and not an AnyHarness file resource.

## File Locator And Desktop-local Capabilities

Every rendered file reference is classified once as a workspace locator, a
Desktop locator, or an unavailable locator before any stat, search, home
lookup, inspection, target discovery, open, or reveal operation. A locator
never carries nullable workspace and absolute authorities at the same time.

Workspace filesystem provenance comes from the resolved runtime target:
`local` maps to `desktop-local`, while Cloud and SSH-target runtimes map to
`remote`. A successfully fetched cached Cloud gateway is also authoritative
remote evidence. Host surface, workspace-id spelling, inventory rows, and
equal-looking roots are not provenance. Resolution pending and rejection stay
explicit unknown states and never grant native access.

The single `WorkspacePathProvider` under `AnyHarnessWorkspace` resolves both
that provenance and the runtime-reported workspace root for the exact
materialized workspace id. Only a normalized supported absolute runtime root
is settled. Inventory and pending-entry paths may label the header, but they
must not construct filesystem capabilities.

Relative references and supplied valid workspace paths remain workspace
locators while provenance/root are pending. Workspace root is represented by
the empty runtime stat path and displayed/copied as `.` unless a proven local
companion exists. Absolute paths project into the workspace only against a
settled root. Paths outside it and home-relative paths become Desktop locators
only with settled `desktop-local` provenance and a Desktop files bridge.
Unsupported prefixes, NUL, and any `..` segment fail before all I/O. A supplied
structured workspace-path string is authoritative even when empty or
whitespace; only `null`/`undefined` permits raw-path classification.

Workspace access begins with exact stat, including `""` for root. Only the
typed AnyHarness `FILE_NOT_FOUND` for a non-root path offers one bounded fuzzy
activation: one no-retry basename search, one corrected stat, and no repeated
recovery after a terminal result. Exact/corrected directories do not become a
primary browse action in this slice. Unexpected symlink kinds are refused;
the runtime must report the safely resolved `file` or `directory` kind.

Values already routed to the Desktop filesystem pass through
`DesktopFilesBridge.inspectPath`; inspection itself does not establish local
provenance. Product state keeps `idle`, `pending`, `settled`, and `rejected`
distinct for each candidate revision. The render effect and an imperative
primary action share one attempt, a candidate change makes an older completion
stale, and a settled refusal or rejected transport is terminal for that
revision.

Only a settled `file` or `directory` result establishes a path kind and enables
matching open/reveal capabilities. Missing, invalid, denied, unsupported,
unexpected-I/O, malformed-payload, idle, pending, and rejected states keep the
kind null, expose no open targets, and cause every native handler to no-op after
rechecking current route, bridge, kind, and target membership. A nonempty
unavailable reference exposes exactly Copy path; an empty/whitespace reference
has no menu and no clipboard write. Copy handlers read the current locator at
invocation so captured callbacks cannot copy a later empty reference. Target
discovery takes `file | directory | null`; null
does not default to file or start discovery, while an imperative open supplies
the already-inspected kind explicitly.

Inspection refusal does not advertise or perform a retry. A native open or
reveal attempted after a settled file/directory may fail separately; only that
operation failure keeps retry copy, and retrying it reuses the settled
inspection.

## Right Panel Tools

The durable Scratch tool id is `scratch`. New right-panel state defaults to
Scratch first, followed by Changes and cloud Settings when available.
Persisted selections should be normalized without opening the panel
automatically.

Workspace companion tools should use the shared pane primitives under
`components/workspace/pane/**` for fixed-height headers, icon buttons, and
options menus. Editable Scratch text reads at the transcript message size
(`--text-message`, via the `--scratch-*` tokens), and the Scratch header title
and save status read at that same size. Shiki remains owned by shared
Markdown/code renderers; the editable Scratch editor is not syntax-highlighted.

## File Viewing

`.md` and `.mdx` files default to rendered mode. Other text files default to
edit mode. User mode choices persist for the open target until that target is
closed.

The file viewer frame owns the path header, copy path, save/reload actions,
dirty/conflict states, and binary/too-large placeholders. Cmd/Ctrl+S saves the
active file target only.

The viewer's action menu (copy content, copy path, word wrap, rich preview) is
OS-native in Desktop: the toolbar options button and a right-click in the
content area both open the host context menu via the shared native-menu bridge,
with the DOM popover kept as the browser/test fallback. Native menus carry no
checkmark state, so toggles read as "Enable/Disable …" verbs.

The file viewer may open a palette-style file search modal scoped to the
current viewer tab. It reuses the workspace file search API and command-palette
input/list primitives; global shortcut ownership remains with the workspace
command palette unless a dedicated binding is introduced later.

## Diff Viewing

Diff parsing and pure helpers live under `lib/**`; async highlighting belongs
in hooks. Component renderers live under `components/ui/content/diff/**`.

Split/unified layout is per viewer target. All-changes rows include section
scope in their viewed-state key so a partially staged file can be viewed
separately in the staged and unstaged sections.

The right-sidebar Last turn mode keeps transcript-derived touched-file metadata
separate from current git diff metadata. If a touched file has no current diff
against the selected base, the row remains visible but suppresses current
status/stat badges and renders a no-current-diff message.

Last-turn undo is transcript-backed and all-or-nothing. The UI only builds undo
requests from top-level visible `file_change` parts that include complete patch
data, and the runtime rejects unsafe paths, staged/partially staged affected
files, stale patches, and conflicted git operations before applying the reverse
patch.
