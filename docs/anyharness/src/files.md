# Files

`anyharness-lib/src/files/**` owns safe workspace-relative file browsing and
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

- `anyharness/crates/anyharness-lib/src/files/types.rs`
- `anyharness/crates/anyharness-lib/src/files/service.rs`
- `anyharness/crates/anyharness-lib/src/files/safety.rs`

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

Every operation begins with `resolve_safe_path(...)`
(`anyharness/crates/anyharness-lib/src/files/safety.rs`).

That path-safety layer rejects:

- absolute paths
- `..` traversal
- invalid path prefixes
- `.git` access
- resolved paths that escape the workspace via canonicalization or symlinks

This is the main security boundary for the files subsystem.

### Listing

`WorkspaceFilesService::list_entries(...)`
(`anyharness/crates/anyharness-lib/src/files/service.rs`):

1. resolves a safe directory path
2. reads directory entries
3. hides `.git`
4. classifies entries as file / directory / symlink
5. adds lightweight metadata
6. sorts directories first, then files alphabetically

### Reading

`read_file(...)`
(`anyharness/crates/anyharness-lib/src/files/service.rs`):

1. resolves a safe file path
2. verifies the target exists and is not a directory
3. enforces a text-file size limit
4. sniffs text vs binary
5. returns:
   - text content when safe and small enough
   - metadata-only results for binary or oversized files
6. computes a version token for optimistic writes

### Writing

`write_file(...)`
(`anyharness/crates/anyharness-lib/src/files/service.rs`):

1. resolves a safe path
2. rejects directory targets
3. checks the expected version token if the file already exists
4. writes to a temp file
5. renames atomically into place
6. returns the new version token and metadata

### Creating

`create_entry(...)`
(`anyharness/crates/anyharness-lib/src/files/service.rs`) is create-only.
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

### Renaming

`rename_entry(...)` is exposed as `PATCH
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

`delete_entry(...)` is exposed as `DELETE
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
