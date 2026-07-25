import { Smartphone } from "@proliferate/ui/icons";
import { useWorkspaceShellActions } from "@/components/workspace/shell/providers/WorkspaceShellActionsContext";
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
      icon={<Smartphone className="size-3.5" />}
      label={label}
      active={isEnabled}
      disabled={disabled}
      aria-busy={isPending}
      onClick={handleClick}
      title={title}
      className="shrink-0"
    />
  );
}
