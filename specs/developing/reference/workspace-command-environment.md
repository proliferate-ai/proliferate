# Workspace Command Environment

Workspace run commands execute inside the selected workspace. The desktop app
sets these environment variables before launching the command:

- `PROLIFERATE_WORKSPACE_DIR`: absolute path to the selected workspace.
- `PROLIFERATE_REPO_DIR`: absolute path to the source repo.
- `PROLIFERATE_WORKSPACE_KIND`: workspace type, such as `worktree` or `cloud`.
- `PROLIFERATE_BRANCH`: workspace branch when known.
- `PROLIFERATE_WORKTREE_DIR`: set for local worktree workspaces.

Use normal shell expansion in commands:

```sh
cd "$PROLIFERATE_WORKSPACE_DIR" && make dev
```

For commands that should prefer a worktree path when available:

```sh
cd "${PROLIFERATE_WORKTREE_DIR:-$PROLIFERATE_WORKSPACE_DIR}" && make dev
```
