import { ExternalLink } from "@proliferate/ui/icons";
import { useWorkspaceShellActions } from "@/components/workspace/shell/providers/WorkspaceShellActionsContext";
import { ComposerControlButton } from "@proliferate/ui/primitives/ComposerControlButton";

export function WorkspaceOpenInWebFooterControl() {
  const shellActions = useWorkspaceShellActions();
  const actions = shellActions?.workspaceWebActions;
  if (!actions) {
    return null;
  }

  const { disabled, openCurrentWorkspaceInWeb, title, url } = actions;

  return (
    <ComposerControlButton
      icon={<ExternalLink className="size-3.5" />}
      label="Open in web"
      detail={!url ? "Sync first" : null}
      disabled={disabled}
      onClick={openCurrentWorkspaceInWeb}
      title={title}
      className="shrink-0"
    />
  );
}
