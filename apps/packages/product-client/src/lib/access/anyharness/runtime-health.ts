import type { AnyHarnessRequestOptions } from "@anyharness/sdk";
import { getAnyHarnessClient, type AnyHarnessClientConnection } from "@anyharness/sdk-react";

export function getRuntimeHealth(
  connection: AnyHarnessClientConnection,
  request?: AnyHarnessRequestOptions,
) {
  return getAnyHarnessClient(connection).runtime.getHealth(request);
}
