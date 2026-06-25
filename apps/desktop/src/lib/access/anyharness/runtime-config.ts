import type {
  ApplyAgentAuthConfigRequest,
  ApplyRuntimeConfigRequest,
} from "@anyharness/sdk";
import {
  getAnyHarnessClient,
  type AnyHarnessClientConnection,
  type AnyHarnessResolvedConnection,
} from "@anyharness/sdk-react";

type RuntimeConfigConnection = AnyHarnessClientConnection | AnyHarnessResolvedConnection;
type AnyHarnessClient = ReturnType<typeof getAnyHarnessClient>;
type ApplyRuntimeConfigOptions = Parameters<AnyHarnessClient["runtimeConfig"]["apply"]>[1];

export type AnyHarnessRuntimeConfigConnection = RuntimeConfigConnection;

export function applyRuntimeConfig(
  connection: RuntimeConfigConnection,
  request: ApplyRuntimeConfigRequest,
  options?: ApplyRuntimeConfigOptions,
) {
  return getAnyHarnessClient(connection).runtimeConfig.apply(request, options);
}

export function applyAgentAuthConfig(
  connection: RuntimeConfigConnection,
  request: ApplyAgentAuthConfigRequest,
  options?: ApplyRuntimeConfigOptions,
) {
  return getAnyHarnessClient(connection).agents.applyAuthConfig(request, options);
}
