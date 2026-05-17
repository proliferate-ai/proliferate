import type {
  RuntimeConfigPrefetchRequest,
  RuntimeConfigPrefetchResponse,
  RuntimeResolutionFulfillRequest,
  RuntimeResolutionRequest,
  TargetRuntimeConfigApplyResponse,
  TargetRuntimeConfigRefreshRequest,
  TargetRuntimeConfigResponse,
} from "@anyharness/sdk";
import {
  getAnyHarnessClient,
  type AnyHarnessClientConnection,
  type AnyHarnessResolvedConnection,
} from "@anyharness/sdk-react";

type RuntimeConfigConnection = AnyHarnessClientConnection | AnyHarnessResolvedConnection;

export function getRuntimeConfig(
  connection: RuntimeConfigConnection,
): Promise<TargetRuntimeConfigResponse> {
  return getAnyHarnessClient(connection).runtimeConfig.get();
}

export function putRuntimeConfig(
  connection: RuntimeConfigConnection,
  request: TargetRuntimeConfigRefreshRequest,
): Promise<TargetRuntimeConfigApplyResponse> {
  return getAnyHarnessClient(connection).runtimeConfig.put(request);
}

export function prefetchRuntimeConfig(
  connection: RuntimeConfigConnection,
  request: RuntimeConfigPrefetchRequest,
): Promise<RuntimeConfigPrefetchResponse> {
  return getAnyHarnessClient(connection).runtimeConfig.prefetch(request);
}

export function listRuntimeConfigResolutionRequests(
  connection: RuntimeConfigConnection,
): Promise<RuntimeResolutionRequest[]> {
  return getAnyHarnessClient(connection).runtimeConfig.listResolutionRequests();
}

export function fulfillRuntimeConfigResolutionRequest(
  connection: RuntimeConfigConnection,
  requestId: string,
  request: RuntimeResolutionFulfillRequest,
): Promise<RuntimeResolutionRequest> {
  return getAnyHarnessClient(connection).runtimeConfig.fulfillResolutionRequest(
    requestId,
    request,
  );
}
