import { ExternalLink } from "#product/primitives/icons/core";
import { useWorkspaceShellActions } from "#product/components/workspace/shell/providers/WorkspaceShellActionsContext";
import { ComposerControlButton } from "#product/primitives/patterns/ComposerControlButton";

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
