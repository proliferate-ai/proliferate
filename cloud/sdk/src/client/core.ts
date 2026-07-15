import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "../generated/openapi.js";

export type { Middleware };

export type ProliferateOpenApiClient = ReturnType<typeof createClient<paths>>;

export interface ProliferateRequestJsonInput {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  pathParams?: Record<string, string | number | boolean>;
  query?: Record<string, string | number | boolean | null | undefined>;
  headers?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  signal?: AbortSignal;
}

export interface ProliferateStreamRequestInput {
  url: string;
  headers?: HeadersInit;
  signal?: AbortSignal;
}

export interface ProliferateRequestFormInput {
  method: "POST" | "PUT" | "PATCH";
  path: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  formData: FormData;
  signal?: AbortSignal;
}

export interface ProliferateCloudClient extends ProliferateOpenApiClient {
  readonly baseUrl: string;
  requestJson<TResponse>(input: ProliferateRequestJsonInput): Promise<TResponse>;
  requestForm<TResponse>(input: ProliferateRequestFormInput): Promise<TResponse>;
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

interface MiddlewareCallbackBase {
  schemaPath: string;
  params: Record<string, never>;
  id: string | undefined;
  options: Record<string, never>;
}

export class ProliferateClientError extends Error {
  status: number;
  code: string | null;
  /**
   * The structured error body's extra fields beyond `code`/`message` (e.g. a
   * 409's `harnesses` list). Empty for string/opaque error bodies.
   */
  details: Record<string, unknown>;

  constructor(
    message: string,
    status: number,
    code: string | null = null,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ProliferateClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function createProliferateErrorMiddleware(): Middleware {
  return {
    async onResponse({ response }) {
      if (!response.ok) {
        let payload:
          | {
              detail?:
                | ({ code?: string; message?: string } & Record<string, unknown>)
                | string;
            }
          | undefined;
        try {
          payload = await response.clone().json() as typeof payload;
        } catch {
          // Fall through to status text.
        }
        const detail = payload?.detail;
        if (detail && typeof detail === "object") {
          const { code, message, ...rest } = detail;
          throw new ProliferateClientError(
            message ?? response.statusText ?? "Request failed",
            response.status,
            code ?? null,
            rest,
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
  const middlewares = [createProliferateErrorMiddleware(), ...(options.middleware ?? [])];
  for (const middleware of middlewares) {
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
  extended.requestForm = async function requestForm<TResponse>(
    input: ProliferateRequestFormInput,
  ): Promise<TResponse> {
    const response = await executeFormRequest({
      baseUrl,
      input,
      middlewares,
    });
    return await response.json() as TResponse;
  };
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
        headers?: Record<string, string | number | boolean | null | undefined>;
        signal?: AbortSignal;
      },
    ) => Promise<{ data?: unknown }>)(input.path, {
      params: {
        path: input.pathParams,
        query: input.query,
      },
      headers: input.headers,
      body: input.body,
      signal: input.signal,
    });
    return response.data as TResponse;
  };
  return extended;
}

async function executeFormRequest(input: {
  baseUrl: string;
  input: ProliferateRequestFormInput;
  middlewares: Middleware[];
}): Promise<Response> {
  const { baseUrl, input: requestInput, middlewares } = input;
  let request = new Request(buildProliferateUrl(baseUrl, requestInput.path, requestInput.query), {
    method: requestInput.method,
    body: requestInput.formData,
    headers: {
      accept: "application/json",
    },
    signal: requestInput.signal,
  });
  const callbackInput: MiddlewareCallbackBase = {
    schemaPath: requestInput.path,
    params: {},
    id: undefined,
    options: {},
  };

  for (const middleware of middlewares) {
    const result = await middleware.onRequest?.(({
      ...callbackInput,
      request,
    }) as never);
    if (result instanceof Response) {
      return await applyResponseMiddlewares({
        request,
        response: result,
        callbackInput,
        middlewares,
      });
    }
    if (result instanceof Request) {
      request = result;
    }
  }

  let response: Response;
  try {
    response = await fetch(request.clone());
  } catch (error) {
    response = await applyErrorMiddlewares({
      request,
      error,
      callbackInput,
      middlewares,
    });
  }
  return await applyResponseMiddlewares({
    request,
    response,
    callbackInput,
    middlewares,
  });
}

async function applyErrorMiddlewares(input: {
  request: Request;
  error: unknown;
  callbackInput: MiddlewareCallbackBase;
  middlewares: Middleware[];
}): Promise<Response> {
  let error = input.error;
  for (let index = input.middlewares.length - 1; index >= 0; index -= 1) {
    const result = await input.middlewares[index]?.onError?.(({
      ...input.callbackInput,
      request: input.request,
      error,
    }) as never);
    if (result instanceof Response) {
      return result;
    }
    if (result instanceof Error) {
      error = result;
    }
  }
  throw error;
}

async function applyResponseMiddlewares(input: {
  request: Request;
  response: Response;
  callbackInput: MiddlewareCallbackBase;
  middlewares: Middleware[];
}): Promise<Response> {
  let response = input.response;
  for (let index = input.middlewares.length - 1; index >= 0; index -= 1) {
    const result = await input.middlewares[index]?.onResponse?.(({
      ...input.callbackInput,
      request: input.request,
      response,
    }) as never);
    if (result instanceof Response) {
      response = result;
    }
  }
  return response;
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
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/+$/u, "");
  const requestPath = path.replace(/^\/+/u, "");
  url.pathname = [basePath, requestPath].filter(Boolean).join("/");
  url.search = "";
  url.hash = "";
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== null && value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}
