# AnyHarness Adapters

Status: authoritative for local workspace/machine capability adapters.

Adapter code lives under `anyharness-lib/src/adapters/**`.

## Purpose

Adapters perform focused operations against a local workspace or machine. They
know how to do an operation. Domains decide when and why that operation is
allowed.

Adapters are not product domains. They should be usable from tests or scripts
with explicit inputs such as a workspace root, path, command, timeout, git ref,
or provider CLI arguments. They should not need `AppState`, stores, HTTP
request context, or session runtime state.

The adapter mental model:

```text
domains   decide product policy
api       maps transport/auth/errors
live      owns currently running resources
adapters  perform local capabilities
```

Example:

```text
domains/workspaces
  decides whether dirty git status blocks archiving/deleting/migration

adapters/git
  reports git status/diff/branch facts
```

Another:

```text
api/http/files
  authenticates, resolves workspace, maps request/response

adapters/files
  resolves safe paths, reads/writes/lists/stat files
```

## Boundary Rules

Adapters may:

- call filesystem, process, git, provider CLI, and shell APIs
- parse command output
- enforce local safety checks such as path containment and timeout limits
- expose narrow capability functions
- define capability-specific input/output/error types

Adapters must not:

- own durable product rows
- import `AppState`
- import API handlers/auth/request context
- import live actors/managers/handles
- import domain services or domain stores
- decide session, workspace, mobility, review, cowork, or billing policy
- import contract request/response types as their internal model
- map errors to HTTP responses

If an endpoint exposes an adapter operation directly, the API layer still owns
transport mapping and authentication. Workspace lifecycle policy belongs in the
owning domain before the adapter is called.

## Default Shape

Adapters should use a consistent folder grammar:

```text
adapters/<capability>/
  mod.rs
  types.rs
  executor.rs      # optional
  service.rs       # optional, rare
  operations/
    <operation>.rs
```

The real adapter logic belongs in `operations/**`.

### `mod.rs`

`mod.rs` declares the module surface. It should be boring.

It may:

- declare child modules
- expose the intended public surface
- keep implementation modules private when possible

It should not:

- hold implementation logic
- grow parsers or command execution helpers
- become a convenience barrel for unrelated capabilities

Example:

```rust
pub mod types;

mod executor;

pub mod operations {
    pub mod diff;
    pub mod status;
    pub mod branches;
}
```

### `types.rs`

`types.rs` is the adapter-owned vocabulary.

It is imported by operation files and by callers that need adapter result/input
types.

Put shared adapter shapes here:

- operation inputs
- operation outputs
- local adapter errors
- small enums used by multiple operations
- typed local capability facts

Examples:

```text
GitStatusSnapshot
GitChangedFile
GitDiffScope
GitDiffResult
GitBranch
CommitError
PushError

WorkspaceFileKind
WorkspaceFileEntry
ListWorkspaceFilesResult
ReadWorkspaceFileResult
WriteWorkspaceFileResult
FileAdapterError

RunProcessRequest
RunProcessResult
ProcessServiceError

PullRequestState
PullRequestSummary
CreatePullRequestResult
HostingServiceError
```

Do not put these in `types.rs`:

- `WorkspaceRecord`
- `SessionRecord`
- HTTP contract request/response types
- `ProblemDetails`
- `AppState`
- live process/PTY/browser handles
- parser scratch state used by only one operation
- mutable caches

Rule of thumb:

```text
If two operation files, or one operation plus a caller, need the same shape,
put it in types.rs.

If only one operation uses a helper shape internally,
keep it inside that operation file.
```

### `executor.rs`

`executor.rs` is optional.

Use it when an adapter repeatedly invokes one low-level mechanism:

- `git`
- `gh`
- a subprocess runner
- a provider CLI
- a shared shell command wrapper

It sits below operations:

```text
operation -> executor -> local tool/mechanism
```

`executor.rs` responsibilities:

- invoke the local tool/mechanism
- apply shared command environment/cwd/timeout behavior
- return stdout/stderr/status in a narrow adapter-owned shape
- expose small helpers such as `run_git`, `run_gh`, or `run_process_with_timeout`

`executor.rs` non-responsibilities:

- no product policy
- no API mapping
- no domain/store access
- no operation-specific business meaning
- no broad orchestration across unrelated operations

If a concrete name is clearer than `executor.rs`, prefer the concrete name:

```text
git/
  executor.rs      # okay: shared git command runner

hosting/
  gh_cli.rs        # often clearer than executor.rs

processes/
  runner.rs        # often clearer than executor.rs
```

### `operations/`

`operations/**` is the normal implementation home.

Split operations by local capability family, not by HTTP route and not by
product workflow.

Examples:

```text
adapters/git/operations/
  status.rs
  diff.rs
  branches.rs
  commit.rs
  push.rs
  file_search.rs

adapters/files/operations/
  list.rs
  read.rs
  write.rs
  create.rs
  rename.rs
  delete.rs
  stat.rs

adapters/hosting/operations/
  current_pr.rs
  create_pr.rs

adapters/processes/operations/
  run.rs
  output.rs
  environment.rs
```

Operation files may use `types.rs`, safety helpers, parser helpers, and
`executor.rs`.

Operation files should not import `api/**`, `app/**`, `live/**`, or domain
services/stores.

The operation file can be the public adapter API. Callers may call:

```rust
crate::adapters::git::operations::diff::diff_for_path(...)
crate::adapters::git::operations::branches::list_branches(...)
```

This is acceptable. Do not add `service.rs` solely to avoid this path.

### `service.rs`

`service.rs` is optional and rare.

Use it only when it earns its keep through real shared state, configuration, or
composition.

Good reasons to add `service.rs`:

- the adapter owns shared state or cache
- the adapter owns shared configuration/defaults
- the adapter has a stateful object used by callers
- one public adapter method composes several operations into one capability
- keeping a stable facade materially reduces call-site churn

Bad reasons to add `service.rs`:

- it only forwards `Service::diff()` to `operations::diff::diff()`
- it exists because every adapter "should have a service"
- it becomes a 1,000-line implementation bucket
- it hides operation ownership instead of clarifying it

Allowed:

```text
service.rs
  owns FileSearchCache and delegates search work
  owns default timeout/config for process runner
  composes check_gh_installed + check_gh_auth + create_pr
```

Avoid:

```text
service.rs
  contains parsers
  contains all git operations
  contains product workflow rules
  contains HTTP error mapping
```

If a service exists, keep the direction clear:

```text
caller -> service.rs -> operations -> executor/local tool
```

Do not let operation files depend on `service.rs`.

## Capability Shapes

### Files

Target:

```text
adapters/files/
  mod.rs
  types.rs
  safety.rs
  operations/
    list.rs
    read.rs
    write.rs
    create.rs
    rename.rs
    delete.rs
    stat.rs
```

Files adapter code owns local file mechanics:

- workspace-relative path normalization
- containment checks
- file reads
- file writes
- directory listings
- create/rename/delete mechanics
- metadata/stat reads
- text/binary checks
- content version tokens

Files adapter code does not decide:

- whether a workspace may be modified
- whether a file should appear in transcript context
- whether an operation belongs to a review flow
- how API errors are rendered

### Git

Target:

```text
adapters/git/
  mod.rs
  types.rs
  executor.rs
  operations/
    status.rs
    diff.rs
    branches.rs
    commit.rs
    push.rs
    file_search.rs
```

Git adapter code owns:

- invoking git
- parsing git output
- status snapshots
- diffs
- branch/default/base logic
- staging/unstaging/committing
- pushing current branch
- repo file search mechanics

Git adapter code does not decide:

- whether dirty status blocks workspace retirement
- how mobility archives interpret deltas
- whether a review should include a diff
- when a cowork workspace should autosave as product policy

Watch for product-flavored names in git adapter operations. If an operation is
truly product-specific, move policy to a domain and keep only raw git mechanics
in the adapter.

### Hosting

Target:

```text
adapters/hosting/
  mod.rs
  types.rs
  gh_cli.rs
  operations/
    current_pr.rs
    create_pr.rs
```

Hosting adapter code owns provider command/API mechanics such as GitHub CLI
wrappers and pull-request metadata lookup.

Hosting adapter code does not decide:

- workspace lifecycle
- billing
- authorization
- product presentation
- release policy

### Processes

Target:

```text
adapters/processes/
  mod.rs
  types.rs
  runner.rs
  operations/
    run.rs
    environment.rs
    output.rs
```

Processes adapter code owns local command execution mechanics:

- args
- working directory
- environment
- timeouts
- output capture/truncation
- exit status mapping

Processes adapter code does not decide:

- which product workflow should run a command
- how command results affect durable session/workspace state
- whether command output should be shown in a UI

## Inputs And Outputs

Adapter inputs should be explicit and already resolved.

Prefer:

```text
workspace_root: PathBuf
relative_path: WorkspaceRelativePath
timeout: Duration
command: Vec<String>
base_ref: String
```

Avoid:

```text
workspace_id
session_id
AppState
Store
ContractRequest
```

If an adapter needs a workspace root, a domain or API caller resolves the
workspace first and passes the root in. The adapter does not query durable
workspace state.

Adapter outputs should be typed capability results, not HTTP responses and not
product presentation models.

## Error Ownership

Adapter errors should describe local capability failures:

- path escapes workspace root
- file not found
- git command failed
- process timed out
- provider CLI missing
- provider CLI not authenticated
- output could not be parsed

Domains translate adapter failures into product decisions when needed. API code
translates final errors into wire responses.

Avoid putting HTTP concepts on adapter errors:

```text
status_code()
problem_code()
```

Those mappings belong in API error translation. If a transitional adapter
already exposes those helpers, avoid spreading the pattern.

## Growth Rules

Split an adapter before it becomes a mixed capability bucket.

Promote implementation into a new `operations/<name>.rs` file when it has:

- its own parser
- its own safety rules
- its own command shape
- its own fixture set
- more than one public function

Do not split by HTTP route. Split by local capability concern.

Do not create vague files:

```text
helpers.rs
utils.rs
misc.rs
common.rs
operations/workspace.rs
operations/review.rs
```

Prefer specific names:

```text
safety.rs
parser.rs
executor.rs
gh_cli.rs
operations/diff.rs
operations/branches.rs
operations/create_pr.rs
operations/output.rs
```

## Testing

Adapter tests should use temp directories, fixture command output, or narrow
command wrappers. They should not require an AnyHarness `AppState`, live
session manager, or SQLite store.

For git/process/hosting command wrappers, prefer testing parser behavior and
command construction separately from process execution.

Operations with complex parsers may keep tests beside the operation:

```text
operations/diff.rs
operations/diff_tests.rs
```

or in a nested test module when small.

## Migration Checklist

When cleaning up an adapter:

1. Identify the local capability.
2. Move shared adapter vocabulary into `types.rs`.
3. Move implementation into `operations/**`.
4. Add `executor.rs`, `gh_cli.rs`, or `runner.rs` only if there is repeated
   low-level tool invocation logic.
5. Keep or add `service.rs` only if it has real state/config/composition value.
6. Move HTTP mapping out to API.
7. Move product policy out to domains.
8. Keep callers pointed at operation files unless a service facade is earned.
