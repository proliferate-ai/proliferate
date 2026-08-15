import { ExternalLink } from "#product/primitives/icons/core";
import { useWorkspaceShellActions } from "#product/hooks/workspaces/workflows/use-workspace-shell-actions";
import { ComposerControlButton } from "#product/primitives/patterns/composer/ComposerControlButton";

export function WorkspaceOpenInWebFooterControl() {
  const shellActions = useWorkspaceShellActions();
  const actions = shellActions?.workspaceWebActions;
  if (!actions) {
    return null;
  }

  const { disabled, openCurrentWorkspaceInWeb, title, url } = actions;

  return (
    <ComposerControlButton
      icon={<ExternalLink className="icon-control" />}
      label="Open in web"
      detail={!url ? "Sync first" : null}
      disabled={disabled}
      onClick={openCurrentWorkspaceInWeb}
      title={title}
      className="shrink-0"
    />
  );
}
