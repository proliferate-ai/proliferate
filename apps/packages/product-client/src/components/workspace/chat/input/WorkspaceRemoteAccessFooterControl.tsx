import { Smartphone, Spinner } from "@proliferate/ui/icons";
import { useWorkspaceShellActions } from "#product/components/workspace/shell/providers/WorkspaceShellActionsContext";
import { ComposerControlButton } from "@proliferate/ui/primitives/ComposerControlButton";

export function WorkspaceRemoteAccessFooterControl() {
  const shellActions = useWorkspaceShellActions();
  const actions = shellActions?.workspaceRemoteAccessActions;
  if (!actions) {
    return null;
  }

  const { disabled, handleClick, isEnabled, isPending, label, title } =
    actions;

  return (
    <ComposerControlButton
      icon={isPending ? <Spinner className="icon-paired" /> : <Smartphone className="icon-paired" />}
      label={isPending ? "Updating access" : label}
      active={isEnabled}
      disabled={disabled}
      onClick={handleClick}
      title={title}
      className="shrink-0"
    />
  );
}
