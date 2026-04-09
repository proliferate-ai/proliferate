# Files

`anyharness-lib/src/files/**` owns safe workspace-relative file browsing and
read/write operations.

## Core Concepts

The files area is intentionally narrow.

It owns:

- safe path resolution inside a workspace
- directory listing
- text-file reads
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

## Boundaries

### Files Owns

- workspace-relative path safety
- text/binary sniffing
- optimistic version tokens
- file read/write/list/stat behavior

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
- Version mismatches must reject stale writes rather than silently overwrite.
- Oversized or binary files should degrade to metadata, not crash reads.

## Extension Points

Add behavior here when it changes safe file semantics, for example:

- new metadata fields
- better text/binary detection
- additional optimistic-write rules

Do not add behavior here when it belongs to git, workspaces, or editor/runtime
state above this layer.
