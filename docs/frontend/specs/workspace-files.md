# Workspace Files

This doc covers the desktop workspace Files, file viewer, Changes, and
all-changes review surfaces.

## Product Boundary

Files is filesystem navigation:

- browse directories
- search files
- create files and folders
- rename and delete files and folders from the file tree context menu
- open file viewer targets

Changes is changed-file workflow:

- summarize unstaged, staged, and branch changes
- open per-file diff viewer targets
- open an all-changes review target

The durable right-panel tool id remains `git`; “Changes” is a display label.

## Viewer Targets

Center tabs use `ViewerTarget`, owned by
`desktop/src/lib/domain/workspaces/viewer-target.ts`.

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

## File Viewing

`.md` and `.mdx` files default to rendered mode. Other text files default to
edit mode. User mode choices persist for the open target until that target is
closed.

The file viewer frame owns the path header, copy path, save/reload actions,
dirty/conflict states, and binary/too-large placeholders. Cmd/Ctrl+S saves the
active file target only.

## Diff Viewing

Diff parsing and pure helpers live under `lib/**`; async highlighting belongs
in hooks. Component renderers live under `components/ui/content/diff/**`.

Split/unified layout is per viewer target. All-changes rows include section
scope in their viewed-state key so a partially staged file can be viewed
separately in the staged and unstaged sections.
