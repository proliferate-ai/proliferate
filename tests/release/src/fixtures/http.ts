/**
 * Minimal fetch wrapper for the identity fixture. Deliberately dependency-free
 * (no SDK import) because this module talks to the raw server HTTP contract
 * documented in server/proliferate/auth and server/proliferate/server/organizations,
 * the same way a first-party client would before the SDK generates bindings
 * for these routes.
 */

export interface ApiClientOptions {
  baseUrl: string;
  bearerToken?: string;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(method: string, path: string, status: number, body: unknown) {
    super(`${method} ${path} -> ${status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
    this.name = "ApiRequestError";
    this.status = status;
    this.body = body;
  }
}

export class ApiClient {
  private readonly baseUrl: string;
  private bearerToken: string | undefined;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.bearerToken = options.bearerToken;
  }

  withBearerToken(token: string): ApiClient {
    return new ApiClient({ baseUrl: this.baseUrl, bearerToken: token });
  }

  async post<TResponse>(path: string, body: unknown): Promise<TResponse> {
    return this.request<TResponse>("POST", path, body);
  }

  async get<TResponse>(path: string): Promise<TResponse> {
    return this.request<TResponse>("GET", path);
  }

  async delete<TResponse>(path: string): Promise<TResponse> {
    return this.request<TResponse>("DELETE", path);
  }

  private async request<TResponse>(method: string, path: string, body?: unknown): Promise<TResponse> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.bearerToken) {
      headers.authorization = `Bearer ${this.bearerToken}`;
    }
    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const parsed = text.length > 0 ? safeJsonParse(text) : undefined;
    if (!response.ok) {
      throw new ApiRequestError(method, path, response.status, parsed ?? text);
    }
    return parsed as TResponse;
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
