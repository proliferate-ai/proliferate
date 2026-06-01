import { useMemo } from "react";
import type {
  CloudAgentCatalogResponse,
  CloudSessionProjection,
} from "@proliferate/cloud-sdk";
import {
  getLiveConfigControlValue,
  readSessionLiveConfig,
  resolveCloudLaunchSelection,
  type CloudLaunchComposerSelection,
} from "@proliferate/product-domain/chats/cloud/composer-controls";

export function useWebCloudLaunchSelection(input: {
  session: CloudSessionProjection | null;
  agentCatalog: CloudAgentCatalogResponse | undefined;
  workspaceLaunchableAgentKinds: readonly string[];
  launchSelection: CloudLaunchComposerSelection;
}) {
  const {
    session,
    agentCatalog,
    workspaceLaunchableAgentKinds,
    launchSelection,
  } = input;
  const liveConfig = readSessionLiveConfig(session);
  const resolvedLaunchSelection = useMemo(
    () => resolveCloudLaunchSelection({
      catalog: agentCatalog,
      launchableAgentKinds: workspaceLaunchableAgentKinds,
      selection: launchSelection,
    }),
    [agentCatalog, launchSelection, workspaceLaunchableAgentKinds],
  );
  const sessionModelId = session && liveConfig ? getLiveConfigControlValue(liveConfig, "model") : null;

  return {
    liveConfig,
    resolvedLaunchSelection,
    sessionModelId,
  };
}
