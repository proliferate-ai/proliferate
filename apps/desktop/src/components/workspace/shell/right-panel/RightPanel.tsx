import {
  memo,
  type Dispatch,
  type SetStateAction,
} from "react";
import { RightPanelFrame } from "#product/components/workspace/shell/right-panel/RightPanelFrame";
import {
  useRightPanelController,
  type RightPanelTerminalActivationRequest,
} from "#product/hooks/workspaces/facade/use-right-panel-controller";
import type { RightPanelWorkspaceState } from "#product/lib/domain/workspaces/shell/right-panel-model";

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
  onTogglePanel: () => void;
  onTerminalActivationRequestHandled: (request: RightPanelTerminalActivationRequest) => void;
}

export const RightPanel = memo(function RightPanel(props: RightPanelProps) {
  const frameProps = useRightPanelController(props);
  return <RightPanelFrame {...frameProps} />;
});
