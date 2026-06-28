import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
} from "react";
import {
  useIntegrationToolMetadata,
} from "@proliferate/cloud-sdk-react";
import type { IntegrationToolMetadata } from "@proliferate/cloud-sdk";
import { integrationToolDisplayNameFromMetadata } from "@/lib/domain/chat/integration-tool-call-presentation";
import { useAuthStore } from "@/stores/auth/auth-store";

export interface IntegrationToolCallPresentation {
  gatewayToolName: string;
  providerDisplayName: string;
  iconId: string | null;
  toolDisplayName: string;
}

const EMPTY_TOOL_PRESENTATION = new Map<string, IntegrationToolCallPresentation>();

const IntegrationToolMetadataContext =
  createContext<ReadonlyMap<string, IntegrationToolCallPresentation>>(EMPTY_TOOL_PRESENTATION);

export function IntegrationToolMetadataProvider({ children }: { children: ReactNode }) {
  const authStatus = useAuthStore((state) => state.status);
  const metadata = useIntegrationToolMetadata(authStatus === "authenticated");

  const toolsByGatewayName = useMemo(() => {
    if (!metadata.data?.length) {
      return EMPTY_TOOL_PRESENTATION;
    }

    const next = new Map<string, IntegrationToolCallPresentation>();
    for (const provider of metadata.data) {
      addProviderTools(next, provider);
    }
    return next;
  }, [metadata.data]);

  return (
    <IntegrationToolMetadataContext.Provider value={toolsByGatewayName}>
      {children}
    </IntegrationToolMetadataContext.Provider>
  );
}

export function useIntegrationToolCallPresentation(
  gatewayToolName: string | null | undefined,
): IntegrationToolCallPresentation | null {
  const toolsByGatewayName = useContext(IntegrationToolMetadataContext);
  if (!gatewayToolName) {
    return null;
  }
  return toolsByGatewayName.get(gatewayToolName) ?? null;
}

function addProviderTools(
  target: Map<string, IntegrationToolCallPresentation>,
  provider: IntegrationToolMetadata,
) {
  for (const tool of provider.tools) {
    target.set(tool.gatewayToolName, {
      gatewayToolName: tool.gatewayToolName,
      providerDisplayName: provider.displayName,
      iconId: provider.iconId,
      toolDisplayName: integrationToolDisplayNameFromMetadata(tool),
    });
  }
}
