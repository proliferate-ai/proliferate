import { getAnyHarnessClient, type AnyHarnessClientConnection } from "@anyharness/sdk-react";

type AnyHarnessClient = ReturnType<typeof getAnyHarnessClient>;
type ListModelRegistriesOptions =
  Parameters<AnyHarnessClient["modelRegistries"]["list"]>[0];

export function listModelRegistries(
  connection: AnyHarnessClientConnection,
  options?: ListModelRegistriesOptions,
) {
  return getAnyHarnessClient(connection).modelRegistries.list(options);
}
