import type { ProliferateCloudClient, ProliferateRequestJsonInput } from "./core.js";

type LegacyOpenApiOptions = {
  params?: {
    path?: Record<string, string | number | boolean>;
    query?: Record<string, string | number | boolean | null | undefined>;
    header?: Record<string, string | number | boolean | null | undefined>;
  };
  body?: unknown;
  signal?: AbortSignal;
};

type LegacyOpenApiResult = Promise<{ data: any }>;

export function legacyOpenApiClient(client: ProliferateCloudClient): {
  GET(path: string, options?: LegacyOpenApiOptions): LegacyOpenApiResult;
  POST(path: string, options?: LegacyOpenApiOptions): LegacyOpenApiResult;
  PUT(path: string, options?: LegacyOpenApiOptions): LegacyOpenApiResult;
  PATCH(path: string, options?: LegacyOpenApiOptions): LegacyOpenApiResult;
  DELETE(path: string, options?: LegacyOpenApiOptions): LegacyOpenApiResult;
} {
  const request = async (
    method: ProliferateRequestJsonInput["method"],
    path: string,
    options?: LegacyOpenApiOptions,
  ): LegacyOpenApiResult => ({
    data: await client.requestJson({
      method,
      path,
      pathParams: options?.params?.path,
      query: options?.params?.query,
      headers: options?.params?.header,
      body: options?.body,
      signal: options?.signal,
    }),
  });

  return {
    GET: (path, options) => request("GET", path, options),
    POST: (path, options) => request("POST", path, options),
    PUT: (path, options) => request("PUT", path, options),
    PATCH: (path, options) => request("PATCH", path, options),
    DELETE: (path, options) => request("DELETE", path, options),
  };
}
