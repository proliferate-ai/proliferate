import { useWorkspaceRemoteAccessActions } from "@/hooks/workspaces/workflows/use-workspace-remote-access-actions";
import { Globe, Spinner } from "@/components/ui/icons";
import { ComposerControlButton } from "./ComposerControlButton";

export function WorkspaceRemoteAccessFooterControl() {
  const remoteAccess = useWorkspaceRemoteAccessActions();

  return (
    <ComposerControlButton
      icon={remoteAccess.isPending ? <Spinner className="size-3.5" /> : <Globe className="size-3.5" />}
      label={remoteAccess.label}
      tone={remoteAccess.isEnabled ? "info" : "neutral"}
      active={remoteAccess.isEnabled}
      disabled={remoteAccess.disabled}
      onClick={remoteAccess.handleClick}
      title={remoteAccess.title}
    />
  );
}
