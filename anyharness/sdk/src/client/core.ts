import type { ProblemDetails } from "../types/runtime.js";
import { AgentsClient } from "./agents.js";
import { CoworkClient } from "./cowork.js";
import { FilesClient } from "./files.js";
import { GitClient } from "./git.js";
import { ModelRegistriesClient } from "./model-registries.js";
import { ProcessesClient } from "./processes.js";
import { ProvidersClient } from "./providers.js";
import { PullRequestsClient } from "./pull-requests.js";
import { RepoRootsClient } from "./repo-roots.js";
import { RuntimeClient } from "./runtime.js";
import { SessionsClient } from "./sessions.js";
import { TerminalsClient } from "./terminals.js";
import { WorkspacesClient } from "./workspaces.js";

export interface AnyHarnessClientOptions {
  baseUrl: string;
  authToken?: string;
  fetch?: typeof globalThis.fetch;
}

export interface AnyHarnessRequestOptions {
  headers?: HeadersInit;
}

export class AnyHarnessError extends Error {
  constructor(
    public readonly problem: ProblemDetails,
    cause?: unknown,
  ) {
    super(problem.detail ?? problem.title);
    this.name = "AnyHarnessError";
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

export class AnyHarnessTransport {
  readonly baseUrl: string;
  readonly authToken?: string;
  readonly fetch: typeof globalThis.fetch;

  constructor(options: AnyHarnessClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.authToken = options.authToken;
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async get<T>(path: string, options?: AnyHarnessRequestOptions): Promise<T> {
    const res = await this.fetch(`${this.baseUrl}${path}`, {
      method: "GET",
      headers: this.buildHeaders({ accept: "application/json" }, options),
    });
    return this.handleResponse<T>(res);
  }

  async post<T>(path: string, body: unknown, options?: AnyHarnessRequestOptions): Promise<T> {
    const res = await this.fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.buildHeaders({
        "content-type": "application/json",
        accept: "application/json",
      }, options),
      body: JSON.stringify(body),
    });
    return this.handleResponse<T>(res);
  }

  async put<T>(path: string, body: unknown, options?: AnyHarnessRequestOptions): Promise<T> {
    const res = await this.fetch(`${this.baseUrl}${path}`, {
      method: "PUT",
      headers: this.buildHeaders({
        "content-type": "application/json",
        accept: "application/json",
      }, options),
      body: JSON.stringify(body),
    });
    return this.handleResponse<T>(res);
  }

  async patch<T>(path: string, body: unknown, options?: AnyHarnessRequestOptions): Promise<T> {
    const res = await this.fetch(`${this.baseUrl}${path}`, {
      method: "PATCH",
      headers: this.buildHeaders({
        "content-type": "application/json",
        accept: "application/json",
      }, options),
      body: JSON.stringify(body),
    });
    return this.handleResponse<T>(res);
  }

  async delete(path: string, options?: AnyHarnessRequestOptions): Promise<void> {
    const res = await this.fetch(`${this.baseUrl}${path}`, {
      method: "DELETE",
      headers: this.buildHeaders({ accept: "application/json" }, options),
    });
    if (!res.ok) {
      throw new AnyHarnessError(await toProblemDetails(res));
    }
  }

  async deleteJson<T>(path: string, options?: AnyHarnessRequestOptions): Promise<T> {
    const res = await this.fetch(`${this.baseUrl}${path}`, {
      method: "DELETE",
      headers: this.buildHeaders({ accept: "application/json" }, options),
    });
    return this.handleResponse<T>(res);
  }

  private async handleResponse<T>(res: Response): Promise<T> {
    if (!res.ok) {
      throw new AnyHarnessError(await toProblemDetails(res));
    }
    return (await res.json()) as T;
  }

  private buildHeaders(headers: HeadersInit, options?: AnyHarnessRequestOptions): Headers {
    const next = new Headers(headers);
    if (options?.headers) {
      const extraHeaders = new Headers(options.headers);
      extraHeaders.forEach((value, key) => {
        next.set(key, value);
      });
    }
    if (this.authToken) {
      next.set("authorization", `Bearer ${this.authToken}`);
    }
    return next;
  }
}

export class AnyHarnessClient {
  readonly runtime: RuntimeClient;
  readonly agents: AgentsClient;
  readonly modelRegistries: ModelRegistriesClient;
  readonly providers: ProvidersClient;
  readonly repoRoots: RepoRootsClient;
  readonly workspaces: WorkspacesClient;
  readonly cowork: CoworkClient;
  readonly files: FilesClient;
  readonly sessions: SessionsClient;
  readonly git: GitClient;
  readonly pullRequests: PullRequestsClient;
  readonly terminals: TerminalsClient;
  readonly processes: ProcessesClient;

  constructor(options: AnyHarnessClientOptions) {
    const transport = new AnyHarnessTransport(options);
    this.runtime = new RuntimeClient(transport);
    this.agents = new AgentsClient(transport);
    this.modelRegistries = new ModelRegistriesClient(transport);
    this.providers = new ProvidersClient(transport);
    this.repoRoots = new RepoRootsClient(transport);
    this.workspaces = new WorkspacesClient(transport);
    this.cowork = new CoworkClient(transport);
    this.files = new FilesClient(transport);
    this.sessions = new SessionsClient(transport);
    this.git = new GitClient(transport);
    this.pullRequests = new PullRequestsClient(transport);
    this.terminals = new TerminalsClient(transport);
    this.processes = new ProcessesClient(transport);
  }
}

async function toProblemDetails(res: Response): Promise<ProblemDetails> {
  try {
    return (await res.json()) as ProblemDetails;
  } catch {
    return {
      type: "about:blank",
      title: res.statusText || "Request failed",
      status: res.status,
    };
  }
}
