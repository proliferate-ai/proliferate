import { AnyHarnessClient } from "@anyharness/sdk";

export interface AnyHarnessClientConnection {
  runtimeUrl: string;
  authToken?: string | null;
}

const clientCache = new Map<string, AnyHarnessClient>();

export function getAnyHarnessClient(
  connection: AnyHarnessClientConnection,
): AnyHarnessClient {
  const runtimeUrl = connection.runtimeUrl.trim();
  if (!runtimeUrl) {
    throw new Error("AnyHarness runtime URL is required.");
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
