import { useNavigate } from "react-router-dom";
import { CloudChatSurface } from "@proliferate/product-ui/chat/CloudChatSurface";

import { routes } from "../../../config/routes";
import {
  useWebCloudChatScreen,
} from "../../../hooks/chat/facade/use-web-cloud-chat-screen";
import { CloudChatMissingState } from "./CloudChatMissingState";
import { CloudChatWorkspaceLoadingState } from "./CloudChatWorkspaceLoadingState";

export function ChatScreen() {
  const navigate = useNavigate();
  const screen = useWebCloudChatScreen();

  if (screen.kind === "missing") {
    return (
      <CloudChatMissingState
        title={screen.title}
        onOpenHome={() => navigate(routes.home)}
      />
    );
  }

  if (screen.kind === "workspace-loading") {
    return <CloudChatWorkspaceLoadingState />;
  }

  return <CloudChatSurface {...screen.surface} />;
}
