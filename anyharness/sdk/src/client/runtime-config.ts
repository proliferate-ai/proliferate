import type {
  ApplyRuntimeConfigRequest,
  ApplyRuntimeConfigResponse,
  RuntimeConfigStatusResponse,
} from "../types/runtime-config.js";
import type { AnyHarnessRequestOptions, AnyHarnessTransport } from "./core.js";

export class RuntimeConfigClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  async getStatus(
    options?: AnyHarnessRequestOptions,
  ): Promise<RuntimeConfigStatusResponse> {
    return this.transport.get<RuntimeConfigStatusResponse>(
      "/v1/runtime-config",
      options,
    );
  }

  async apply(
    input: ApplyRuntimeConfigRequest,
    options?: AnyHarnessRequestOptions,
  ): Promise<ApplyRuntimeConfigResponse> {
    return this.transport.put<ApplyRuntimeConfigResponse>(
      "/v1/runtime-config",
      input,
      options,
    );
  }
}
