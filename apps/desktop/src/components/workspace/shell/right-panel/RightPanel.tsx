import {
  memo,
  type Dispatch,
  type SetStateAction,
} from "react";
import { RightPanelFrame } from "@/components/workspace/shell/right-panel/RightPanelFrame";
import {
  useRightPanelController,
  type RightPanelTerminalActivationRequest,
} from "@/hooks/workspaces/facade/use-right-panel-controller";
import type { RightPanelWorkspaceState } from "@/lib/domain/workspaces/shell/right-panel-model";

interface RightPanelProps {
  workspaceId: string | null;
  workspaceUiKey: string | null;
  isWorkspaceReady: boolean;
  isOpen: boolean;
  shouldKeepContentVisible?: boolean;
  isCloudWorkspaceSelected: boolean;
  state: RightPanelWorkspaceState;
  repoSettingsHref: string;
  onStateChange: Dispatch<SetStateAction<RightPanelWorkspaceState>>;
  terminalActivationRequest: RightPanelTerminalActivationRequest | null;
  focusRequestToken?: number;
  nativeOverlaysHidden?: boolean;
  onOpenPanel: () => void;
  onTogglePanel: () => void;
  onTerminalActivationRequestHandled: (request: RightPanelTerminalActivationRequest) => void;
}

export const RightPanel = memo(function RightPanel(props: RightPanelProps) {
  const frameProps = useRightPanelController(props);
  return <RightPanelFrame {...frameProps} />;
});
