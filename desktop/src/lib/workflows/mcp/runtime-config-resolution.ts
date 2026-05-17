import { AnyHarnessError } from "@anyharness/sdk";
import type {
  AnyHarnessClientConnection,
  AnyHarnessResolvedConnection,
} from "@anyharness/sdk-react";
import {
  fulfillRuntimeConfigResolutionRequest,
  listRuntimeConfigResolutionRequests,
} from "@/lib/access/anyharness/runtime-config";

type RuntimeConfigConnection = AnyHarnessClientConnection | AnyHarnessResolvedConnection;

export function isRuntimeConfigResolutionError(error: unknown): boolean {
  return error instanceof AnyHarnessError
    && error.problem.code === "RUNTIME_CONFIG_RESOLUTION_REQUIRED"
    && error.problem.runtimeConfigResolution != null;
}

export async function retryAfterRuntimeConfigResolution<T>(
  connection: RuntimeConfigConnection,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isRuntimeConfigResolutionError(error)) {
      throw error;
    }
    await fulfillEmptyRuntimeConfigRequests(connection);
    return operation();
  }
}

async function fulfillEmptyRuntimeConfigRequests(connection: RuntimeConfigConnection) {
  const requests = await listRuntimeConfigResolutionRequests(connection);
  for (const request of requests) {
    if ((request.artifacts?.length ?? 0) > 0 || (request.credentialRefs?.length ?? 0) > 0) {
      continue;
    }
    await fulfillRuntimeConfigResolutionRequest(connection, request.requestId, {
      artifacts: [],
      credentials: [],
    });
  }
}
