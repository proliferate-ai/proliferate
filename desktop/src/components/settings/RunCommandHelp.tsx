interface RunCommandHelpProps {
  scope: string;
  className?: string;
}

export function RunCommandHelp({
  scope,
  className = "text-sm text-muted-foreground",
}: RunCommandHelpProps) {
  return (
    <p className={className}>
      Runs inside the {scope}. Available vars include <code>PROLIFERATE_WORKSPACE_DIR</code>,{" "}
      <code>PROLIFERATE_REPO_DIR</code>, <code>PROLIFERATE_WORKSPACE_KIND</code>, and{" "}
      <code>PROLIFERATE_BRANCH</code> when known. Worktree workspaces also set{" "}
      <code>PROLIFERATE_WORKTREE_DIR</code>. Reference them with shell expansion, for example{" "}
      <code>cd "$PROLIFERATE_WORKSPACE_DIR" && make dev</code>. For worktree-aware fallback, use{" "}
      <code>{'cd "${PROLIFERATE_WORKTREE_DIR:-$PROLIFERATE_WORKSPACE_DIR}" && make dev'}</code>.
    </p>
  );
}
