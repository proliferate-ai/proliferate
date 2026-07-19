import { AnyHarnessClient } from "@anyharness/sdk";

export interface AnyHarnessClientConnection {
  runtimeUrl: string;
  authToken?: string | null;
  /** Context-owned transport override for deterministic, no-network hosts. */
  fetch?: typeof globalThis.fetch;
}

const clientCache = new Map<string, AnyHarnessClient>();

export function getAnyHarnessClient(
  connection: AnyHarnessClientConnection,
): AnyHarnessClient {
  const runtimeUrl = connection.runtimeUrl.trim();
  if (!runtimeUrl) {
    throw new Error("AnyHarness runtime URL is required.");
  }

  if (connection.fetch) {
    return new AnyHarnessClient({
      baseUrl: runtimeUrl,
      authToken: connection.authToken ?? undefined,
      fetch: connection.fetch,
    });
  }

  const cacheKey = `${runtimeUrl}::${connection.authToken ?? ""}`;
  const cached = clientCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const client = new AnyHarnessClient({
    baseUrl: runtimeUrl,
    authToken: connection.authToken ?? undefined,
  });
  clientCache.set(cacheKey, client);
  return client;
}
