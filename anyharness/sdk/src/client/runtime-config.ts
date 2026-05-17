import type {
  RuntimeConfigPrefetchRequest,
  RuntimeConfigPrefetchResponse,
  RuntimeResolutionFulfillRequest,
  RuntimeResolutionRejectRequest,
  RuntimeResolutionRequest,
  TargetRuntimeConfigApplyResponse,
  TargetRuntimeConfigRefreshRequest,
  TargetRuntimeConfigResponse,
} from "../types/runtime.js";
import type { AnyHarnessRequestOptions, AnyHarnessTransport } from "./core.js";

export class RuntimeConfigClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  async get(options?: AnyHarnessRequestOptions): Promise<TargetRuntimeConfigResponse> {
    return this.transport.get<TargetRuntimeConfigResponse>("/v1/runtime-config", options);
  }

  async put(
    request: TargetRuntimeConfigRefreshRequest,
    options?: AnyHarnessRequestOptions,
  ): Promise<TargetRuntimeConfigApplyResponse> {
    return this.transport.put<TargetRuntimeConfigApplyResponse>(
      "/v1/runtime-config",
      request,
      options,
    );
  }

  async prefetch(
    request: RuntimeConfigPrefetchRequest,
    options?: AnyHarnessRequestOptions,
  ): Promise<RuntimeConfigPrefetchResponse> {
    return this.transport.post<RuntimeConfigPrefetchResponse>(
      "/v1/runtime-config/prefetch",
      request,
      options,
    );
  }

  async listResolutionRequests(
    options?: AnyHarnessRequestOptions,
  ): Promise<RuntimeResolutionRequest[]> {
    return this.transport.get<RuntimeResolutionRequest[]>(
      "/v1/runtime-config/resolution-requests",
      options,
    );
  }

  async fulfillResolutionRequest(
    requestId: string,
    request: RuntimeResolutionFulfillRequest,
    options?: AnyHarnessRequestOptions,
  ): Promise<RuntimeResolutionRequest> {
    return this.transport.post<RuntimeResolutionRequest>(
      `/v1/runtime-config/resolution-requests/${encodeURIComponent(requestId)}/fulfill`,
      request,
      options,
    );
  }

  async rejectResolutionRequest(
    requestId: string,
    request: RuntimeResolutionRejectRequest,
    options?: AnyHarnessRequestOptions,
  ): Promise<void> {
    await this.transport.post(
      `/v1/runtime-config/resolution-requests/${encodeURIComponent(requestId)}/reject`,
      request,
      options,
    );
  }
}
