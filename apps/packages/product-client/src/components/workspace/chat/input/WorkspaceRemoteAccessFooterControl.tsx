import { Smartphone } from "#product/primitives/icons/platform";
import { Spinner } from "#product/primitives/Spinner";
import { useWorkspaceShellActions } from "#product/components/workspace/shell/providers/WorkspaceShellActionsContext";
import { ComposerControlButton } from "#product/primitives/patterns/composer/ComposerControlButton";

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
      icon={isPending ? <Spinner className="icon-control" /> : <Smartphone className="icon-control" />}
      label={isPending ? "Updating access" : label}
      active={isEnabled}
      disabled={disabled}
      onClick={handleClick}
      title={title}
      className="shrink-0"
    />
  );
}
