import { createContext, type ReactNode, useContext } from "react";
import type { AnyHarnessClientConnection } from "../lib/client-cache.js";

interface AnyHarnessRuntimeContextValue {
  runtimeUrl: string | null;
  authToken?: string | null;
}

const AnyHarnessRuntimeContext = createContext<AnyHarnessRuntimeContextValue | null>(null);

export function AnyHarnessRuntime({
  runtimeUrl,
  authToken,
  children,
}: AnyHarnessRuntimeContextValue & { children: ReactNode }) {
  return (
    <AnyHarnessRuntimeContext.Provider value={{ runtimeUrl, authToken }}>
      {children}
    </AnyHarnessRuntimeContext.Provider>
  );
}

export function useAnyHarnessRuntimeContext(): AnyHarnessRuntimeContextValue {
  const context = useContext(AnyHarnessRuntimeContext);
  if (!context) {
    throw new Error("AnyHarnessRuntime provider is required.");
  }
  return context;
}

export function resolveRuntimeConnection(
  context: AnyHarnessRuntimeContextValue,
): AnyHarnessClientConnection {
  const runtimeUrl = context.runtimeUrl?.trim() ?? "";
  if (!runtimeUrl) {
    throw new Error("AnyHarness runtime URL is required.");
  }
  return {
    runtimeUrl,
    authToken: context.authToken ?? undefined,
  };
}
