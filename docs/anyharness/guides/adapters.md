# AnyHarness Adapters

Status: authoritative for local workspace/machine capability adapters.

Adapter code lives under `anyharness-lib/src/adapters/**`.

## Purpose

Adapters perform focused operations against a local workspace or machine. They
know how to do an operation. Domains decide when and why that operation is
allowed.

Adapters are not product domains. They should be usable from tests or scripts
with explicit inputs such as a workspace root, path, command, timeout, or git
ref. They should not need `AppState`, stores, HTTP request context, or session
runtime state.

## Boundary Rules

Adapters may:

- call filesystem, process, git, and shell APIs
- parse command output
- enforce local safety checks such as path containment and timeout limits
- expose narrow capability functions
- define capability-specific result/error types

Adapters must not:

- own durable product rows
- import domain services, domain stores, API handlers, or live actors
- decide session, workspace, mobility, review, or cowork lifecycle policy
- import contract request/response types as their internal model
- map errors to HTTP responses

If an endpoint exposes an adapter operation directly, the API layer still owns
transport mapping and authentication. Workspace lifecycle policy belongs in the
owning domain before the adapter is called.

## Default Shape

Small adapters may start as a single file:

```text
adapters/<capability>.rs
```

Promote to a folder when there are multiple operation families, shared
capability types, command fixtures, or tests that naturally group together:

```text
adapters/<capability>/
  mod.rs
  model.rs        # capability-owned types only
  error.rs        # typed adapter errors
  <operation>.rs  # focused operation family
```

`mod.rs` should declare the module surface and lightly re-export owned types.
It should not hold the implementation once the adapter is promoted.

## Capability Shapes

### Files

```text
adapters/files/
  mod.rs
  model.rs
  error.rs
  paths.rs        # normalize and validate workspace-relative paths
  read.rs
  write.rs
  list.rs
  metadata.rs
```

Files adapter code owns local file mechanics: workspace-relative path
normalization, containment checks, reads, writes, listings, and metadata.

It does not decide whether a workspace may be modified, whether a file should
appear in transcript context, or whether an operation belongs to a review flow.

### Git

```text
adapters/git/
  mod.rs
  model.rs
  error.rs
  command.rs      # command execution wrapper and env setup
  status.rs
  diff.rs
  branches.rs
  search.rs
```

Git adapter code owns invoking git, parsing git output, and returning typed git
results.

It does not decide whether dirty git status blocks workspace retirement, how
mobility archives interpret deltas, or whether a review should include a diff.

### Hosting

```text
adapters/hosting/
  mod.rs
  model.rs
  error.rs
  github.rs       # provider-specific command/API mechanics
  pull_requests.rs
```

Hosting adapter code owns provider command/API mechanics such as GitHub CLI
wrappers and pull-request metadata lookup.

It does not decide workspace lifecycle, billing, authorization, or product
presentation.

### Processes

```text
adapters/processes/
  mod.rs
  model.rs
  error.rs
  runner.rs
  environment.rs
  output.rs
```

Processes adapter code owns local command execution mechanics: args, working
directory, environment, timeouts, output capture, and exit status mapping.

It does not decide which product workflow should run a command or how command
results should affect durable session/workspace state.

## Inputs And Outputs

Adapter inputs should be explicit and already resolved.

Prefer:

```text
workspace_root: PathBuf
relative_path: WorkspaceRelativePath
timeout: Duration
command: Vec<String>
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
- output could not be parsed

Domains translate adapter failures into product decisions when needed. API code
translates final errors into wire responses.

## Growth Rules

Split an adapter before it becomes a mixed capability bucket.

Promote an operation into its own file when it has:

- its own parser
- its own safety rules
- its own command shape
- its own fixture set
- more than one public function

Do not split by HTTP route. Split by local capability concern.

## Testing

Adapter tests should use temp directories, fixture command output, or narrow
command wrappers. They should not require an AnyHarness `AppState`, live
session manager, or SQLite store.

For git/process/hosting command wrappers, prefer testing parser behavior and
command construction separately from process execution.

## Examples

`adapters/git` can parse git status and diff output.

`domains/workspaces` decides whether git status blocks retiring a workspace.

`domains/mobility` decides how git deltas affect a mobility archive.

`adapters/files` can reject `../secret.txt` as a path escape.

`domains/sessions` decides whether an accepted file becomes prompt context.
