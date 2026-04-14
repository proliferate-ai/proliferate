import { createContext, type ReactNode, useContext } from "react";

export interface AnyHarnessResolvedConnection {
  runtimeUrl: string;
  authToken?: string;
  anyharnessWorkspaceId: string;
}

export interface AnyHarnessWorkspaceContextValue {
  workspaceId: string | null;
  resolveConnection: (workspaceId: string) => Promise<AnyHarnessResolvedConnection>;
}

const AnyHarnessWorkspaceContext = createContext<AnyHarnessWorkspaceContextValue | null>(null);

export function AnyHarnessWorkspace({
  workspaceId,
  resolveConnection,
  children,
}: AnyHarnessWorkspaceContextValue & { children: ReactNode }) {
  return (
    <AnyHarnessWorkspaceContext.Provider value={{ workspaceId, resolveConnection }}>
      {children}
    </AnyHarnessWorkspaceContext.Provider>
  );
}

export function useAnyHarnessWorkspaceContext(): AnyHarnessWorkspaceContextValue {
  const context = useContext(AnyHarnessWorkspaceContext);
  if (!context) {
    throw new Error("AnyHarnessWorkspace provider is required.");
  }
  return context;
}

export async function resolveWorkspaceConnectionFromContext(
  context: AnyHarnessWorkspaceContextValue,
  workspaceIdOverride?: string | null,
): Promise<{ workspaceId: string; connection: AnyHarnessResolvedConnection }> {
  const workspaceId = workspaceIdOverride ?? context.workspaceId;
  if (!workspaceId) {
    throw new Error("No workspace selected.");
  }

  const connection = await context.resolveConnection(workspaceId);
  const runtimeUrl = connection.runtimeUrl.trim();
  const anyharnessWorkspaceId = connection.anyharnessWorkspaceId.trim();
  if (!runtimeUrl) {
    throw new Error("AnyHarness runtime URL is required.");
  }
  if (!anyharnessWorkspaceId) {
    throw new Error("AnyHarness workspace ID is required.");
  }

  return {
    workspaceId,
    connection: {
      runtimeUrl,
      authToken: connection.authToken,
      anyharnessWorkspaceId,
    },
  };
}
