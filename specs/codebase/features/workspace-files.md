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

- summarize unstaged, staged, and branch changes
- open per-file diff viewer targets
- open an all-changes review target
- review the latest completed turn as a transcript-backed file filter over
  current git diffs

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
`apps/desktop/src/lib/domain/workspaces/viewer-target.ts`.

Supported targets:

- `file`: editable/readable file view
- `fileDiff`: one file diff for `unstaged`, `staged`, or `branch`
- `allChanges`: a scoped multi-file review view

Shell-tab keys are `viewer:<base64url-json>`. The encoded payload is canonical:
optional fields normalize to `null`, refs are trimmed, and UTF-8 paths are
encoded through the shared base64url helper. Legacy persisted `file:<path>`
keys are read as file viewer targets and written back as `viewer:*`.

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

## Right Panel Tools

The durable Scratch tool id is `scratch`. New right-panel state defaults to
Scratch first, followed by Changes and cloud Settings when available.
Persisted selections should be normalized without opening the panel
automatically.

Workspace companion tools should use the shared pane primitives under
`components/workspace/pane/**` for fixed-height headers, icon buttons, and
options menus. Editable Scratch text uses the same source-view typography tokens
as file and diff views. Shiki remains owned by shared Markdown/code renderers;
the editable Scratch textarea is not syntax-highlighted.

## File Viewing

`.md` and `.mdx` files default to rendered mode. Other text files default to
edit mode. User mode choices persist for the open target until that target is
closed.

The file viewer frame owns the path header, copy path, save/reload actions,
dirty/conflict states, and binary/too-large placeholders. Cmd/Ctrl+S saves the
active file target only.

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
