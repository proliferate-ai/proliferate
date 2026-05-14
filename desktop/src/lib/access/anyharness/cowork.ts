import { getAnyHarnessClient, type AnyHarnessResolvedConnection } from "@anyharness/sdk-react";

type AnyHarnessClient = ReturnType<typeof getAnyHarnessClient>;
type GetManagedWorkspacesOptions =
  Parameters<AnyHarnessClient["cowork"]["getManagedWorkspaces"]>[1];

export function getCoworkManagedWorkspaces(
  connection: AnyHarnessResolvedConnection,
  sessionId: string,
  options?: GetManagedWorkspacesOptions,
) {
  return getAnyHarnessClient(connection).cowork.getManagedWorkspaces(sessionId, options);
}
