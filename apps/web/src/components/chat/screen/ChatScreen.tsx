import { useNavigate, useParams } from "react-router-dom";
import {
  AnyHarnessRuntime,
  AnyHarnessWorkspace,
} from "@anyharness/sdk-react";
import type { CloudWorkspaceDetail } from "@proliferate/cloud-sdk";
import {
  useCloudClient,
  useCloudWorkspaceSnapshot,
} from "@proliferate/cloud-sdk-react";
import { CloudChatSurface } from "@proliferate/product-ui/chat/CloudChatSurface";

import { routes } from "../../../config/routes";
import {
  useWebManagedSandboxChatScreen,
} from "../../../hooks/chat/facade/use-web-managed-sandbox-chat-screen";
import {
  isWebManagedSandboxWorkspace,
} from "../../../lib/access/anyharness/managed-sandbox-runtime";
import { useWebManagedSandboxWorkspaceConnection } from "../../../hooks/access/anyharness/use-web-managed-sandbox-workspace-connection";
import { useAuthToken } from "../../../providers/WebCloudProvider";
import { CloudChatMissingState } from "./CloudChatMissingState";
import { CloudChatWorkspaceLoadingState } from "./CloudChatWorkspaceLoadingState";

export function ChatScreen() {
  const navigate = useNavigate();
  const { workspaceId } = useParams();
  const workspaceQuery = useCloudWorkspaceSnapshot(workspaceId ?? null, Boolean(workspaceId));
  const workspace = workspaceQuery.data?.workspace ?? null;
  const client = useCloudClient();
  const { token } = useAuthToken();
  const resolveConnection = useWebManagedSandboxWorkspaceConnection(workspace);

  if (!workspaceId) {
    return (
      <CloudChatMissingState
        title="Workspace not found"
        onOpenHome={() => navigate(routes.home)}
      />
    );
  }

  if (workspaceQuery.isLoading && !workspace) {
    return <CloudChatWorkspaceLoadingState />;
  }

  if (workspaceQuery.error || !workspace) {
    return (
      <CloudChatMissingState
        title="Workspace not available"
        onOpenHome={() => navigate(routes.home)}
      />
    );
  }

  if (!isWebManagedSandboxWorkspace(workspace)) {
    return (
      <CloudChatMissingState
        title="Managed cloud workspace required"
        onOpenHome={() => navigate(routes.home)}
      />
    );
  }

  return (
    <AnyHarnessRuntime
      runtimeUrl={client.buildUrl("/v1/gateway/managed-sandbox/anyharness")}
      authToken={token ?? undefined}
    >
      <AnyHarnessWorkspace
        workspaceId={workspace.id}
        resolveConnection={resolveConnection}
      >
        <ManagedSandboxChatScreenContent workspace={workspace} />
      </AnyHarnessWorkspace>
    </AnyHarnessRuntime>
  );
}

function ManagedSandboxChatScreenContent({
  workspace,
}: {
  workspace: CloudWorkspaceDetail;
}) {
  const navigate = useNavigate();
  const screen = useWebManagedSandboxChatScreen({ workspace });

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
