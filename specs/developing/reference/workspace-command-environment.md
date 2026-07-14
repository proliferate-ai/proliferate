# Workspace Command Environment

Status: current AnyHarness workspace environment reference.

AnyHarness assembles the environment for commands that run in a selected
workspace. Ordinary variables use this precedence, from lower to higher:

```text
<runtime-home>/secrets/global.env
  < <workspace>/.proliferate/env/workspace.env
  < <workspace>/.proliferate/env/session.env
  < AnyHarness-owned PROLIFERATE_* metadata
```

Later user layers override earlier ordinary variables. Any user-supplied key
whose name begins with `PROLIFERATE_` is ignored; user files and command
overrides cannot replace AnyHarness-owned metadata.

## Always-Injected Metadata

```text
PROLIFERATE_WORKSPACE_ID
PROLIFERATE_WORKSPACE_KIND
PROLIFERATE_WORKSPACE_DIR
PROLIFERATE_REPO_ROOT_ID
PROLIFERATE_REPO_DIR
PROLIFERATE_RUNTIME_HOME
PROLIFERATE_REPO_NAME
```

`PROLIFERATE_REPO_NAME` uses recorded remote repository metadata when
available and otherwise uses the source-repository directory name.

## Conditional Metadata

AnyHarness adds:

- `PROLIFERATE_BRANCH` when the workspace has a known, non-detached branch;
- `PROLIFERATE_BASE_REF` when the caller supplies a base ref;
- `PROLIFERATE_GIT_PROVIDER`, `PROLIFERATE_GIT_OWNER`, and
  `PROLIFERATE_GIT_REPO` when the corresponding remote metadata is recorded;
  and
- `PROLIFERATE_WORKTREE_DIR` only for a worktree workspace.

## Consumers and Safety

The merged workspace environment reaches process runs, terminals and setup
commands, and live agent launches. A later command-specific ordinary-variable
override can refine a terminal command's environment, but it still cannot
replace `PROLIFERATE_*` metadata.

The three user environment files may contain credentials. They are execution
inputs, not safe agent-context documentation: do not paste their contents into
prompts, docs, logs, issues, or support artifacts.

Commands can use the owned paths through normal shell expansion:

```sh
cd "${PROLIFERATE_WORKTREE_DIR:-$PROLIFERATE_WORKSPACE_DIR}" && make dev
```
