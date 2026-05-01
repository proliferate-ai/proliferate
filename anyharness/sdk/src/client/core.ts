import type { ProblemDetails } from "../types/runtime.js";
import { AgentsClient } from "./agents.js";
import { CoworkClient } from "./cowork.js";
import { FilesClient } from "./files.js";
import { GitClient } from "./git.js";
import { ModelRegistriesClient } from "./model-registries.js";
import { MobilityClient } from "./mobility.js";
import { PlansClient } from "./plans.js";
import { ProcessesClient } from "./processes.js";
import { ProvidersClient } from "./providers.js";
import { PullRequestsClient } from "./pull-requests.js";
import { RepoRootsClient } from "./repo-roots.js";
import { ReplayClient } from "./replay.js";
import { ReviewsClient } from "./reviews.js";
import { RuntimeClient } from "./runtime.js";
import { SessionsClient } from "./sessions.js";
import { TerminalsClient } from "./terminals.js";
import { WorktreesClient } from "./worktrees.js";
import { WorkspacesClient } from "./workspaces.js";

export interface AnyHarnessClientOptions {
  baseUrl: string;
  authToken?: string;
  fetch?: typeof globalThis.fetch;
}

export type AnyHarnessMeasurementOperationId = `mop_${string}`;

export interface AnyHarnessRequestOptions {
  headers?: HeadersInit;
  signal?: AbortSignal;
  measurementOperationId?: AnyHarnessMeasurementOperationId;
  timingCategory?: AnyHarnessTimingCategory;
  timingScope?: AnyHarnessTimingScope;
}

export type AnyHarnessTimingCategory =
  | "workspace.get"
  | "workspace.list"
  | "workspace.detect_setup"
  | "workspace.display_name.update"
  | "workspace.session_launch"
  | "workspace.setup_status"
  | "workspace.setup_rerun"
  | "workspace.setup_start"
  | "workspace.retire.preflight"
  | "workspace.retire"
  | "workspace.retire.cleanup_retry"
  | "workspace.purge.preflight"
  | "workspace.purge"
  | "workspace.purge.retry"
  | "worktree.inventory"
  | "worktree.orphan.prune"
  | "worktree.retention_policy.get"
  | "worktree.retention_policy.update"
  | "worktree.retention.run"
  | "repo_root.list"
  | "session.get"
  | "session.list"
  | "session.events.list"
  | "session.resume"
  | "session.title.update"
  | "session.stream"
  | "file.list"
  | "file.search"
  | "file.read"
  | "file.stat"
  | "git.status";

export interface AnyHarnessTimingScope {
  runtimeUrlHash?: string;
}

export type AnyHarnessTimingEvent =
  | {
      type: "request";
      category: AnyHarnessTimingCategory;
      method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
      status: number | "network_error" | "aborted";
      durationMs: number;
      measurementOperationId?: AnyHarnessMeasurementOperationId;
      runtimeUrlHash?: string;
    }
  | {
      type: "stream";
      category: "session.stream";
      phase:
        | "connect"
        | "first_event"
        | "event"
        | "close"
        | "abort"
        | "network_error";
      durationMs?: number;
      eventCount?: number;
      maxInterArrivalGapMs?: number;
      malformedEventCount?: number;
      measurementOperationId?: AnyHarnessMeasurementOperationId;
      runtimeUrlHash?: string;
    };

export type AnyHarnessTimingObserver = (event: AnyHarnessTimingEvent) => void;

const anyHarnessTimingObservers = new Set<AnyHarnessTimingObserver>();

export function setAnyHarnessTimingObserver(
  observer: AnyHarnessTimingObserver | null,
): () => void {
  if (!observer) {
    anyHarnessTimingObservers.clear();
    return () => undefined;
  }
  anyHarnessTimingObservers.add(observer);
  return () => {
    anyHarnessTimingObservers.delete(observer);
  };
}

export function emitAnyHarnessTimingEvent(event: AnyHarnessTimingEvent): void {
  for (const observer of [...anyHarnessTimingObservers]) {
    observer(event);
  }
}

export function withTimingCategory(
  options: AnyHarnessRequestOptions | undefined,
  category: AnyHarnessTimingCategory,
): AnyHarnessRequestOptions {
  return {
    ...options,
    timingCategory: category,
  };
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
    return this.request<T>("GET", path, undefined, options, {
      accept: "application/json",
    });
  }

  async getBlob(path: string, options?: AnyHarnessRequestOptions): Promise<Blob> {
    const res = await this.fetchWithTiming("GET", path, undefined, options, {});
    if (!res.ok) {
      throw new AnyHarnessError(await toProblemDetails(res));
    }
    return res.blob();
  }

  async post<T>(path: string, body: unknown, options?: AnyHarnessRequestOptions): Promise<T> {
    return this.request<T>("POST", path, body, options, {
        "content-type": "application/json",
        accept: "application/json",
    });
  }

  async put<T>(path: string, body: unknown, options?: AnyHarnessRequestOptions): Promise<T> {
    return this.request<T>("PUT", path, body, options, {
        "content-type": "application/json",
        accept: "application/json",
    });
  }

  async patch<T>(path: string, body: unknown, options?: AnyHarnessRequestOptions): Promise<T> {
    return this.request<T>("PATCH", path, body, options, {
        "content-type": "application/json",
        accept: "application/json",
    });
  }

  async delete(path: string, options?: AnyHarnessRequestOptions): Promise<void> {
    const res = await this.fetchWithTiming("DELETE", path, undefined, options, {
      accept: "application/json",
    });
    if (!res.ok) {
      throw new AnyHarnessError(await toProblemDetails(res));
    }
  }

  async deleteJson<T>(path: string, options?: AnyHarnessRequestOptions): Promise<T> {
    const res = await this.fetchWithTiming("DELETE", path, undefined, options, {
      accept: "application/json",
    });
    return this.handleResponse<T>(res);
  }

  private async request<T>(
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    path: string,
    body: unknown,
    options: AnyHarnessRequestOptions | undefined,
    headers: HeadersInit,
  ): Promise<T> {
    const res = await this.fetchWithTiming(method, path, body, options, headers);
    return this.handleResponse<T>(res);
  }

  private async fetchWithTiming(
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    path: string,
    body: unknown,
    options: AnyHarnessRequestOptions | undefined,
    headers: HeadersInit,
  ): Promise<Response> {
    const startedAt = timingNow();
    try {
      const res = await this.fetch(`${this.baseUrl}${path}`, {
        method,
        headers: this.buildHeaders(headers, options),
        signal: options?.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      this.emitRequestTiming(method, options, res.status, timingNow() - startedAt);
      return res;
    } catch (error) {
      this.emitRequestTiming(
        method,
        options,
        isAbortError(error) ? "aborted" : "network_error",
        timingNow() - startedAt,
      );
      throw error;
    }
  }

  private emitRequestTiming(
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    options: AnyHarnessRequestOptions | undefined,
    status: number | "network_error" | "aborted",
    durationMs: number,
  ): void {
    if (!options?.timingCategory) {
      return;
    }
    emitAnyHarnessTimingEvent({
      type: "request",
      category: options.timingCategory,
      method,
      status,
      durationMs,
      measurementOperationId: options.measurementOperationId,
      runtimeUrlHash: options.timingScope?.runtimeUrlHash ?? hashTimingScope(this.baseUrl),
    });
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

function timingNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function hashTimingScope(value: string): string {
  // Stable grouping hash only; this is not anonymization or a privacy boundary.
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `scope_${(hash >>> 0).toString(36)}`;
}

export class AnyHarnessClient {
  readonly runtime: RuntimeClient;
  readonly agents: AgentsClient;
  readonly modelRegistries: ModelRegistriesClient;
  readonly mobility: MobilityClient;
  readonly plans: PlansClient;
  readonly providers: ProvidersClient;
  readonly repoRoots: RepoRootsClient;
  readonly replay: ReplayClient;
  readonly reviews: ReviewsClient;
  readonly workspaces: WorkspacesClient;
  readonly worktrees: WorktreesClient;
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
    this.mobility = new MobilityClient(transport);
    this.plans = new PlansClient(transport);
    this.providers = new ProvidersClient(transport);
    this.repoRoots = new RepoRootsClient(transport);
    this.replay = new ReplayClient(transport);
    this.reviews = new ReviewsClient(transport);
    this.workspaces = new WorkspacesClient(transport);
    this.worktrees = new WorktreesClient(transport);
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
