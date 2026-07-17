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
  /** Backoff between transient-GET retries; defaults to `GET_RETRY_DELAY_MS`. Tests pass 0. */
  retryDelayMs?: number;
}

/**
 * Transient HTTP statuses a *just-booted* self-host stack can return to the
 * first request(s) after `/health` first flips 2xx: Caddy proxies a 502/503/504
 * for the brief window while the api container finishes coming up behind it.
 * `waitForHealth` returns on the FIRST healthy probe, so the very next request
 * can still race this window. We retry these — and transport-level network
 * errors — on idempotent GETs only.
 */
const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);
/** Bounded so a genuinely wedged stack still fails fast rather than hanging the cell. */
const GET_RETRY_MAX_ATTEMPTS = 6;
const GET_RETRY_DELAY_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  readonly baseUrl: string;
  private bearerToken: string | undefined;
  private readonly retryDelayMs: number;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.bearerToken = options.bearerToken;
    this.retryDelayMs = options.retryDelayMs ?? GET_RETRY_DELAY_MS;
  }

  withBearerToken(token: string): ApiClient {
    return new ApiClient({ baseUrl: this.baseUrl, bearerToken: token, retryDelayMs: this.retryDelayMs });
  }

  async post<TResponse>(path: string, body: unknown): Promise<TResponse> {
    return this.request<TResponse>("POST", path, body);
  }

  async put<TResponse>(path: string, body: unknown): Promise<TResponse> {
    return this.request<TResponse>("PUT", path, body);
  }

  async patch<TResponse>(path: string, body: unknown): Promise<TResponse> {
    return this.request<TResponse>("PATCH", path, body);
  }

  /**
   * GET is idempotent, so we retry it across the just-booted-stack transient
   * window (see `TRANSIENT_STATUSES`). This is the readiness guard the self-host
   * install/claim path (`GET /v1/organizations`) needs but lacked: unlike
   * `SELFHOST-INSTALL-1`, whose analogous GET is fronted by a second bounded
   * `waitForHealth` after a restart, the claim's first authenticated GET fires
   * immediately after a single `/health` 2xx and had no cushion for a Caddy→api
   * 502. Non-idempotent verbs (POST /setup, etc.) are deliberately NOT retried.
   */
  async get<TResponse>(path: string): Promise<TResponse> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= GET_RETRY_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.request<TResponse>("GET", path);
      } catch (error) {
        const retriable =
          (error instanceof ApiRequestError && TRANSIENT_STATUSES.has(error.status)) ||
          !(error instanceof ApiRequestError); // transport/network error (fetch threw)
        if (!retriable || attempt === GET_RETRY_MAX_ATTEMPTS) {
          throw error;
        }
        lastError = error;
        await sleep(this.retryDelayMs);
      }
    }
    // Unreachable: the loop either returns or throws, but satisfies the type.
    throw lastError;
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
