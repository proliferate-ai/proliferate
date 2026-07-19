import { createContext, type ReactNode, useContext } from "react";
import type { AnyHarnessClientConnection } from "../lib/client-cache.js";

export interface AnyHarnessRuntimeContextValue {
  runtimeUrl: string | null;
  authToken?: string | null;
  /** Context-owned transport override; omitted by normal runtime hosts. */
  fetch?: typeof globalThis.fetch;
  /** Resolve a fresh connection when the runtime bearer credential rotates. */
  resolveConnection?: () => Promise<AnyHarnessClientConnection>;
  /**
   * Stable identity boundary for cached AnyHarness data, such as an API
   * deployment and authenticated actor. Falls back to runtimeUrl while
   * callers migrate to an explicit scope.
   */
  cacheScopeKey?: string | null;
}

const AnyHarnessRuntimeContext = createContext<AnyHarnessRuntimeContextValue | null>(null);

export function AnyHarnessRuntime({
  runtimeUrl,
  authToken,
  fetch,
  resolveConnection,
  cacheScopeKey,
  children,
}: AnyHarnessRuntimeContextValue & { children: ReactNode }) {
  return (
    <AnyHarnessRuntimeContext.Provider value={{
      runtimeUrl,
      authToken,
      fetch,
      resolveConnection,
      cacheScopeKey,
    }}>
      {children}
    </AnyHarnessRuntimeContext.Provider>
  );
}

export function resolveRuntimeCacheScopeKey(
  context: AnyHarnessRuntimeContextValue,
): string {
  return context.cacheScopeKey?.trim() || context.runtimeUrl?.trim() || "";
}

export function useAnyHarnessRuntimeContext(): AnyHarnessRuntimeContextValue {
  const context = useContext(AnyHarnessRuntimeContext);
  if (!context) {
    throw new Error("AnyHarnessRuntime provider is required.");
  }
  return context;
}

export function useAnyHarnessCacheScopeKey(): string {
  return resolveRuntimeCacheScopeKey(useAnyHarnessRuntimeContext());
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
    ...(context.fetch ? { fetch: context.fetch } : {}),
  };
}

export function resolveRuntimeConnectionFromContext(
  context: AnyHarnessRuntimeContextValue,
): Promise<AnyHarnessClientConnection> {
  return context.resolveConnection
    ? context.resolveConnection()
    : Promise.resolve(resolveRuntimeConnection(context));
}
