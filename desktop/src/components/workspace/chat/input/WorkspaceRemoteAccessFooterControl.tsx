import { Globe, Spinner } from "@/components/ui/icons";
import { useWorkspaceRemoteAccessActions } from "@/hooks/workspaces/remote-access/use-workspace-remote-access-actions";
import { ComposerControlButton } from "./ComposerControlButton";

export function WorkspaceRemoteAccessFooterControl() {
  const { disabled, handleClick, isEnabled, isPending, label, title } =
    useWorkspaceRemoteAccessActions();

  return (
    <ComposerControlButton
      icon={isPending ? <Spinner className="size-3.5" /> : <Globe className="size-3.5" />}
      label={isPending ? "Updating access" : label}
      tone={isEnabled ? "info" : "neutral"}
      active={isEnabled}
      disabled={disabled}
      onClick={handleClick}
      title={title}
      className="shrink-0"
    />
  );
}
