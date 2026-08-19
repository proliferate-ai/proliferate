# Files

`anyharness-lib/src/adapters/files/**` owns safe workspace-relative file browsing and
file entry operations.

## Core Concepts

The files area is intentionally narrow.

It owns:

- safe path resolution inside a workspace
- directory listing
- text-file reads
- create-only file and directory operations
- rename and delete file or directory operations
- version-token-based writes
- lightweight file metadata

It does not own editor state, watchers, or workspace identity.

## Core Models

Core model and service files:

- `anyharness/crates/anyharness-lib/src/adapters/files/types.rs`
- `anyharness/crates/anyharness-lib/src/adapters/files/service.rs`
- `anyharness/crates/anyharness-lib/src/adapters/files/safety.rs`
- `anyharness/crates/anyharness-lib/src/adapters/files/operations/**`

The files types are transport-friendly internal results:

- `WorkspaceFileEntry`
- `ListWorkspaceFilesResult`
- `ReadWorkspaceFileResult`
- `CreateWorkspaceFileEntryResult`
- `RenameWorkspaceFileEntryResult`
- `DeleteWorkspaceFileEntryResult`
- `WriteWorkspaceFileResult`
- `StatWorkspaceFileResult`

These models describe filesystem state from the runtime’s perspective, not the
full contract layer.

## Main Flow

### Path Safety

Every operation begins with the path-safety layer in
`anyharness/crates/anyharness-lib/src/adapters/files/safety.rs`.

Use `resolve_safe_path(...)` for operations that need the resolved target path,
such as list, read, write, and stat. This resolver canonicalizes an existing
target and follows the final component when it exists. Create uses entry
resolution so a dangling final symlink is occupied rather than absent.

Use `resolve_safe_entry_path(...)` for entry mutations that operate on the
entry itself, such as rename and delete. This resolver validates and
canonicalizes parents without following the final component, so deleting or
renaming a symlink affects the symlink entry rather than its target.

Both resolvers reject:

- absolute paths
- `..` traversal
- invalid path prefixes
- `.git` access
- resolved paths that escape the workspace via canonicalization or symlinks

Canonical containment is checked before canonical `.git` components. The
`.git` scan is scoped to the path relative to the canonical workspace root, so
an escaping target remains `PATH_OUTSIDE_WORKSPACE` even if its outside path
contains `.git`, and a `.git` component above the workspace root does not
poison contained paths.

An empty relative path is the workspace root. Stat and list accept it; read and
compatibility write reject it as `NOT_A_FILE`; create, rename, and delete reject
it through their existing request-validation codes.

This is the main security boundary for the files subsystem. Canonicalization
establishes containment at validation time. Another same-user process that can
mutate the workspace can still race a component between validation and the
filesystem operation. Descriptor-relative traversal and no-follow handles are
a separate hardening concern; this surface does not claim that stronger
guarantee.

### Filesystem error authority

Filesystem errors are classified once and remain distinct through the HTTP
boundary:

| Filesystem outcome | Service result | HTTP problem |
| --- | --- | --- |
| Missing target, including a dangling final symlink | `NotFound` | `404 FILE_NOT_FOUND` |
| Intermediate component is not a directory | `NotADirectory` | `400 NOT_A_DIRECTORY` |
| Permission denied | `PermissionDenied` | `403 FILE_PERMISSION_DENIED` |
| Canonical target outside the workspace | `OutsideWorkspace` | `400 PATH_OUTSIDE_WORKSPACE` |
| Absolute, traversal, invalid, or `.git` path | safety refusal | `400 INVALID_FILE_PATH` |
| Unexpected I/O | bounded `Io` | generic `500` |

Unexpected-I/O responses and diagnostics use fixed summaries. Raw relative
paths, canonical paths, target paths, and operating-system error strings are
not logged or returned for that branch.

### Listing

`WorkspaceFilesService::list_entries(...)` delegates to
`anyharness/crates/anyharness-lib/src/adapters/files/operations/list.rs`:

1. resolves a safe directory path
2. reads directory entries
3. hides `.git`
4. classifies entries as file / directory / symlink
5. adds lightweight metadata
6. sorts directories first, then files alphabetically

Parent listing describes each entry itself. A symlink row is always
`symlink`; it does not follow the target to populate kind, child state, size,
text state, or target timestamps. Directly listing a contained directory
symlink follows its target but keeps the requested link path in
`directoryPath` and every returned child path.

### Reading

`read_file(...)` delegates to
`anyharness/crates/anyharness-lib/src/adapters/files/operations/read.rs`:

1. resolves a safe file path
2. verifies the target exists and is not a directory
3. enforces a text-file size limit
4. sniffs text vs binary
5. returns:
   - text content when safe and small enough
   - metadata-only results for binary or oversized files
6. computes a version token for optimistic writes

### Writing

`write_file(...)` delegates to
`anyharness/crates/anyharness-lib/src/adapters/files/operations/write.rs`:

1. resolves a safe path
2. rejects directory targets
3. checks the expected version token if the file already exists
4. writes to a temp file
5. renames atomically into place
6. returns the new version token and metadata

Compatibility write still upserts an ordinary missing file. A dangling final
symlink is not an ordinary missing file: write returns `FILE_NOT_FOUND` and
preserves the link. Writing through a contained live file symlink replaces the
resolved target atomically and preserves the link entry.

### Creating

`create_entry(...)` delegates to
`anyharness/crates/anyharness-lib/src/adapters/files/operations/create.rs` and
is create-only.
It is exposed as `POST /v1/workspaces/{workspace_id}/files/entries`; the
existing `PUT /files/file` write surface keeps its compatibility upsert
behavior.

Create semantics:

1. resolves a safe path
2. rejects an empty path
3. rejects `content` for directory creation
4. requires the parent directory to already exist
5. requires the final path to not exist
6. creates files with race-safe create-new behavior
7. creates directories with single-directory `create_dir`
8. invalidates file search cache in the runtime layer
9. returns the created entry, plus read metadata/version for files

The final entry check uses symlink metadata. Contained live and dangling final
symlinks are occupied and return `FILE_ALREADY_EXISTS`; a live final symlink
whose target escapes the workspace or resolves into `.git` retains that safety
refusal instead.

### Renaming

`rename_entry(...)` delegates to
`anyharness/crates/anyharness-lib/src/adapters/files/operations/rename.rs` and
is exposed as `PATCH
/v1/workspaces/{workspace_id}/files/entries`.

Rename semantics:

1. resolves the source and destination paths safely
2. rejects an empty source or destination path
3. requires the source path to exist
4. requires the destination parent directory to already exist
5. requires the destination path to not exist
6. rejects moving a directory inside itself
7. rejects cowork artifact paths and their ancestors in the runtime layer
8. invalidates file search cache in the runtime layer
9. returns the old path and renamed entry metadata

### Deleting

`delete_entry(...)` delegates to
`anyharness/crates/anyharness-lib/src/adapters/files/operations/delete.rs` and
is exposed as `DELETE
/v1/workspaces/{workspace_id}/files/entries?path=...`.

Delete semantics:

1. resolves the path safely
2. rejects an empty path so callers cannot delete the workspace root
3. requires the path to exist
4. removes files and symlinks with `remove_file`
5. removes directories recursively with `remove_dir_all`
6. rejects cowork artifact paths and their ancestors in the runtime layer
7. invalidates file search cache in the runtime layer
8. returns the deleted path and entry kind

Rename and delete are entry operations. A final dangling, outside-target, or
`.git`-target symlink may be renamed or deleted because the link itself is the
target of the mutation. Traversal through that link remains refused.

### Stat and symlinks

Stat describes the resolved target. A contained file link reports `file`; a
contained directory link reports `directory`. A dangling final link is
missing, and an escaping or `.git` target is refused. The public response
schema therefore keeps `symlink` for parent-list entry identity while stat
uses the existing file/directory target kinds.

### Search

Workspace file search runs Git from the active workspace root with a pathspec
scoped to that root, even when the workspace is nested below a larger
repository. Results are workspace-relative. Every Git candidate passes through
the Files safe-target resolver and must resolve to a regular file. Contained
file symlinks retain their link path; directory, dangling, escaping, and
`.git`-target symlinks are omitted. A stale Git candidate beneath a
regular-file component is also omitted. Permission and unexpected-I/O outcomes
are propagated rather than converted to an empty result.

## Boundaries

### Files Owns

- workspace-relative path safety
- text/binary sniffing
- optimistic version tokens
- file read/write/list/stat behavior
- create-only file and directory behavior
- rename and delete file or directory behavior

### Files Does Not Own

- workspace lookup
- git semantics
- editor buffers
- diff generation
- long-lived file watching

## Important Invariants

- File access must remain inside the workspace.
- `.git` must stay hidden and inaccessible through this surface.
- Missing, wrong-kind, denied, and unexpected-I/O states must remain distinct.
- Search must not advertise a path that safe file operations refuse.
- Writes must stay atomic.
- Create-only operations must not create missing parents or overwrite existing
  entries.
- Rename operations must not create missing parents or overwrite existing
  entries.
- Delete operations must not allow deleting the workspace root.
- Version mismatches must reject stale writes rather than silently overwrite.
- Oversized or binary files should degrade to metadata, not crash reads.

## Extension Points

Add behavior here when it changes safe file semantics, for example:

- new metadata fields
- better text/binary detection
- additional optimistic-write rules

Do not add behavior here when it belongs to git, workspaces, or editor/runtime
state above this layer.
