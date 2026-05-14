import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "../generated/openapi.js";

export type { Middleware };

export type ProliferateOpenApiClient = ReturnType<typeof createClient<paths>>;

export interface ProliferateRequestJsonInput {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  pathParams?: Record<string, string | number | boolean>;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  signal?: AbortSignal;
}

export interface ProliferateStreamRequestInput {
  url: string;
  headers?: HeadersInit;
  signal?: AbortSignal;
}

export interface ProliferateCloudClient extends ProliferateOpenApiClient {
  readonly baseUrl: string;
  requestJson<TResponse>(input: ProliferateRequestJsonInput): Promise<TResponse>;
  streamRequest(input: ProliferateStreamRequestInput): Promise<Response>;
  buildUrl(
    path: string,
    query?: Record<string, string | number | boolean | null | undefined>,
  ): string;
}

export interface CreateProliferateClientOptions {
  baseUrl: string;
  middleware?: Middleware[];
  streamRequest?: (input: ProliferateStreamRequestInput) => Promise<Response>;
}

export class ProliferateClientError extends Error {
  status: number;
  code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "ProliferateClientError";
    this.status = status;
    this.code = code;
  }
}

export function createProliferateErrorMiddleware(): Middleware {
  return {
    async onResponse({ response }) {
      if (!response.ok) {
        let payload:
          | { detail?: { code?: string; message?: string } | string }
          | undefined;
        try {
          payload = await response.clone().json() as typeof payload;
        } catch {
          // Fall through to status text.
        }
        const detail = payload?.detail;
        if (detail && typeof detail === "object") {
          throw new ProliferateClientError(
            detail.message ?? response.statusText ?? "Request failed",
            response.status,
            detail.code ?? null,
          );
        }
        if (typeof detail === "string") {
          throw new ProliferateClientError(detail, response.status, null);
        }
        throw new ProliferateClientError(
          response.statusText || "Request failed",
          response.status,
          null,
        );
      }
      return response;
    },
  };
}

export function createProliferateClient(
  options: CreateProliferateClientOptions,
): ProliferateCloudClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const client = createClient<paths>({ baseUrl });
  client.use(createProliferateErrorMiddleware());
  for (const middleware of options.middleware ?? []) {
    client.use(middleware);
  }

  const extended = client as ProliferateCloudClient;
  Object.defineProperty(extended, "baseUrl", {
    value: baseUrl,
    enumerable: true,
  });
  extended.buildUrl = (path, query) => buildProliferateUrl(baseUrl, path, query);
  extended.streamRequest = options.streamRequest ?? ((input) =>
    fetch(input.url, {
      headers: input.headers,
      signal: input.signal,
    }));
  extended.requestJson = async function requestJson<TResponse>(
    input: ProliferateRequestJsonInput,
  ): Promise<TResponse> {
    const method = input.method;
    const response = await (client[method] as unknown as (
      path: string,
      options?: {
        params?: {
          path?: Record<string, string | number | boolean>;
          query?: Record<string, string | number | boolean | null | undefined>;
        };
        body?: unknown;
        signal?: AbortSignal;
      },
    ) => Promise<{ data?: unknown }>)(input.path, {
      params: {
        path: input.pathParams,
        query: input.query,
      },
      body: input.body,
      signal: input.signal,
    });
    return response.data as TResponse;
  };
  return extended;
}

let configuredClient: ProliferateCloudClient | null = null;
let configuredClientFactory: (() => ProliferateCloudClient) | null = null;

export function setProliferateClient(client: ProliferateCloudClient | null): void {
  configuredClient = client;
  configuredClientFactory = null;
}

export function setProliferateClientFactory(
  factory: (() => ProliferateCloudClient) | null,
): void {
  configuredClient = null;
  configuredClientFactory = factory;
}

export function resetProliferateClient(): void {
  configuredClient = null;
  configuredClientFactory = null;
}

export function getProliferateClient(): ProliferateCloudClient {
  if (configuredClient) {
    return configuredClient;
  }
  if (configuredClientFactory) {
    configuredClient = configuredClientFactory();
    return configuredClient;
  }
  throw new ProliferateClientError(
    "Proliferate Cloud client is not configured.",
    500,
    "cloud_client_unconfigured",
  );
}

function buildProliferateUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | boolean | null | undefined>,
): string {
  const url = new URL(path.startsWith("/") ? path : `/${path}`, `${baseUrl}/`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== null && value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}
