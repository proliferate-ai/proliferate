/**
 * LocalRuntimeWorldProvisioner — the tier-3 local-runtime world adapter.
 *
 * Implements the frozen `WorldProvisioner<LocalRuntimeWorldHandle>` contract
 * (tests/release/src/foundation/contracts/world.ts). It returns a typed ready
 * handle only after observing real readiness of every boundary the local
 * runtime owns (release-worlds-and-fixtures.md "Typed ready-world handles"):
 *
 *   - candidate server + Postgres (health-probed)
 *   - candidate AnyHarness (the desktop's browser-renderer runtime, reached on
 *     127.0.0.1 exactly as apps/desktop web-port mode does — probed via /v1/agents)
 *   - the qualification LiteLLM gateway (endpoint resolved from
 *     RELEASE_E2E_GATEWAY_BASE_URL or the server's own capabilities; identity
 *     recorded honestly, including when only a local gateway is available)
 *
 * The base handle exposes prepared capacity only; it never pre-completes the
 * LOCAL-2 behavior (actor enrollment, session, turn, spend correlation) — those
 * are scenario actions that return their own resource handles and ledger
 * entries. This world does NOT boot E2B or self-host EC2 (explicitly absent per
 * the world dependency matrix).
 *
 * Boot model: by default the provisioner REUSES an already-reachable candidate
 * stack (the profile booted with `make run PROFILE=tf-local`), matching how the
 * existing local-lane fixtures reach the runtime. When RELEASE_E2E_LOCAL_AUTO_BOOT=1
 * it spawns that boot command itself, registering the child process in the
 * cleanup ledger immediately on creation (before readiness) per the ledger rule.
 */

import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import type {
  LocalRuntimeWorldHandle,
  ReadinessObservation,
  WorldContext,
  WorldProvisioner,
} from "../../contracts/world.js";
import { WorldReadinessError } from "../../contracts/world.js";
import type { WorldId } from "../../contracts/identity.js";
import { ApiClient } from "../../../fixtures/http.js";
import { getGatewayCapabilities } from "./gateway.js";
import { DEFAULT_LOCAL_RUNTIME_URL } from "../../../config/env-manifest.js";

export const DEFAULT_LOCAL_SERVER_URL = "http://127.0.0.1:8086";
export const LOCAL_RUNTIME_PROFILE = "tf-local";

export interface LocalRuntimeProvisionerOptions {
  env?: NodeJS.ProcessEnv;
  /** Overall readiness deadline (ms) including any auto-boot wait. */
  readinessTimeoutMs?: number;
  /** Repo root used to spawn `make run PROFILE=...` when auto-booting. */
  repoRoot?: string;
}

interface ResolvedEndpoints {
  serverUrl: string;
  runtimeUrl: string;
  databaseUrl: string | undefined;
  gatewayBaseUrl: string | undefined;
}

export class LocalRuntimeWorldProvisioner
  implements WorldProvisioner<LocalRuntimeWorldHandle>
{
  readonly world: WorldId = "local-runtime";

  private readonly options: LocalRuntimeProvisionerOptions;

  constructor(options: LocalRuntimeProvisionerOptions = {}) {
    this.options = options;
  }

  async prepare(ctx: WorldContext): Promise<LocalRuntimeWorldHandle> {
    const env = this.options.env ?? process.env;
    const endpoints = resolveEndpoints(env);
    const observations: ReadinessObservation[] = [];
    const deadline = Date.now() + (this.options.readinessTimeoutMs ?? 120_000);

    const autoBoot = env.RELEASE_E2E_LOCAL_AUTO_BOOT === "1";
    if (autoBoot && !(await this.serverReachable(endpoints.serverUrl))) {
      await this.autoBoot(ctx, endpoints, observations);
    }

    // 1. Candidate server + Postgres.
    const serverObs = await this.probeServer(endpoints.serverUrl, deadline);
    observations.push(serverObs);
    if (!serverObs.ok) {
      throw new WorldReadinessError(
        this.world,
        `candidate server not healthy at ${endpoints.serverUrl}`,
        observations,
      );
    }

    // 2. Candidate AnyHarness (desktop browser-renderer runtime).
    const runtimeObs = await this.probeRuntime(endpoints.runtimeUrl, deadline);
    observations.push(runtimeObs);
    if (!runtimeObs.ok) {
      throw new WorldReadinessError(
        this.world,
        `candidate AnyHarness not reachable at ${endpoints.runtimeUrl}`,
        observations,
      );
    }

    // 3. Qualification LiteLLM gateway identity (best-effort, recorded honestly).
    const gateway = await this.resolveGateway(endpoints, env);
    observations.push(gateway.observation);

    const handle: LocalRuntimeWorldHandle = {
      world: "local-runtime",
      run: ctx.run,
      shard: ctx.shard,
      readiness: observations,
      serverUrl: endpoints.serverUrl,
      webUrl: endpoints.runtimeUrl,
      databaseUrl: sanitizeDatabaseUrl(endpoints.databaseUrl),
      anyharnessUrl: endpoints.runtimeUrl,
      gatewayOrigin: gateway.origin,
      gatewayIdentity: gateway.identity,
    };

    await ctx.evidence.append({
      kind: "world-ready",
      world: this.world,
      serverUrl: handle.serverUrl,
      anyharnessUrl: handle.anyharnessUrl,
      gatewayOrigin: handle.gatewayOrigin,
      gatewayIdentity: handle.gatewayIdentity,
      readiness: observations,
    });
    return handle;
  }

  private async serverReachable(serverUrl: string): Promise<boolean> {
    return (await this.probeServer(serverUrl, Date.now() + 3_000)).ok;
  }

  private async autoBoot(
    ctx: WorldContext,
    endpoints: ResolvedEndpoints,
    observations: ReadinessObservation[],
  ): Promise<void> {
    const repoRoot = this.options.repoRoot ?? path.resolve(import.meta.dirname, "../../../../../..");
    const child: ChildProcess = spawn("make", ["run", `PROFILE=${LOCAL_RUNTIME_PROFILE}`], {
      cwd: repoRoot,
      stdio: "ignore",
      detached: false,
    });
    // Register the spawned stack in the ledger immediately — before readiness,
    // before first use — per the cleanup-ledger rule.
    const sequence = await ctx.ledger.register({
      runId: ctx.run.runId,
      shardId: ctx.shard.shardId,
      provider: "local-process",
      resourceType: "profile-stack",
      resourceId: `make-run-${LOCAL_RUNTIME_PROFILE}-pid-${child.pid ?? "unknown"}`,
      owningWorld: this.world,
    });
    child.once("exit", () => {
      void ctx.ledger.transition(sequence, "absent").catch(() => undefined);
    });
    // Tie termination to the ledger cleanup path.
    process.once("exit", () => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* best-effort */
      }
    });
    observations.push({
      check: "auto-boot-spawn",
      ok: true,
      detail: `spawned make run PROFILE=${LOCAL_RUNTIME_PROFILE} (pid ${child.pid ?? "unknown"})`,
      observedAt: new Date().toISOString(),
    });
  }

  private async probeServer(serverUrl: string, deadline: number): Promise<ReadinessObservation> {
    const started = Date.now();
    // Poll /health then /meta until one returns 200 or the deadline passes.
    for (;;) {
      for (const pathname of ["/health", "/meta"]) {
        const result = await httpStatus(`${serverUrl}${pathname}`);
        if (result.status === 200) {
          return {
            check: "server-health",
            ok: true,
            detail: `GET ${pathname} 200 in ${Date.now() - started}ms`,
            observedAt: new Date().toISOString(),
          };
        }
      }
      if (Date.now() >= deadline) {
        return {
          check: "server-health",
          ok: false,
          detail: `no 200 from ${serverUrl}/health or /meta within deadline`,
          observedAt: new Date().toISOString(),
        };
      }
      await sleep(1_000);
    }
  }

  private async probeRuntime(runtimeUrl: string, deadline: number): Promise<ReadinessObservation> {
    const started = Date.now();
    for (;;) {
      const result = await httpStatus(`${runtimeUrl}/v1/agents`);
      if (result.status === 200) {
        return {
          check: "anyharness-agents",
          ok: true,
          detail: `GET /v1/agents 200 in ${Date.now() - started}ms`,
          observedAt: new Date().toISOString(),
        };
      }
      if (Date.now() >= deadline) {
        return {
          check: "anyharness-agents",
          ok: false,
          detail: `GET /v1/agents on ${runtimeUrl} did not return 200 within deadline (last=${result.status})`,
          observedAt: new Date().toISOString(),
        };
      }
      await sleep(1_000);
    }
  }

  /**
   * Resolve the qualification LiteLLM gateway identity. Precedence:
   *  1. RELEASE_E2E_GATEWAY_BASE_URL — the qualification deployment's public URL.
   *  2. The candidate server's own capabilities.publicBaseUrl (when the gateway
   *     is enabled server-side).
   *  3. Absent — recorded honestly; LOCAL-2 will report blocked, never green.
   */
  private async resolveGateway(
    endpoints: ResolvedEndpoints,
    env: NodeJS.ProcessEnv,
  ): Promise<{ origin: string; identity: string; observation: ReadinessObservation }> {
    const now = () => new Date().toISOString();
    if (endpoints.gatewayBaseUrl) {
      return {
        origin: endpoints.gatewayBaseUrl,
        identity: `qualification-litellm:${gatewayHostIdentity(endpoints.gatewayBaseUrl)}`,
        observation: {
          check: "gateway-identity",
          ok: true,
          detail: `qualification LiteLLM from RELEASE_E2E_GATEWAY_BASE_URL (${gatewayHostIdentity(
            endpoints.gatewayBaseUrl,
          )})`,
          observedAt: now(),
        },
      };
    }
    // Ask the candidate server what gateway it is configured to hand actors.
    try {
      const durableEmail = env.RELEASE_E2E_DURABLE_USER_EMAIL;
      const durablePassword = env.RELEASE_E2E_DURABLE_USER_PASSWORD;
      if (durableEmail && durablePassword) {
        const anon = new ApiClient({ baseUrl: endpoints.serverUrl });
        const session = await anon.post<{ accessToken: string }>("/auth/web/password/login", {
          email: durableEmail,
          password: durablePassword,
        });
        const caps = await getGatewayCapabilities(anon.withBearerToken(session.accessToken));
        if (caps.gatewayEnabled && caps.publicBaseUrl) {
          return {
            origin: caps.publicBaseUrl,
            identity: `server-configured-litellm:${gatewayHostIdentity(caps.publicBaseUrl)}`,
            observation: {
              check: "gateway-identity",
              ok: true,
              detail: `server capabilities report gateway enabled at ${gatewayHostIdentity(
                caps.publicBaseUrl,
              )}`,
              observedAt: now(),
            },
          };
        }
        return {
          origin: "",
          identity: "gateway-disabled",
          observation: {
            check: "gateway-identity",
            ok: false,
            detail: `candidate server reports gateway_enabled=${caps.gatewayEnabled}; no public base url — LOCAL-2 will report blocked`,
            observedAt: now(),
          },
        };
      }
    } catch {
      /* fall through to absent */
    }
    return {
      origin: "",
      identity: "gateway-absent",
      observation: {
        check: "gateway-identity",
        ok: false,
        detail: "no RELEASE_E2E_GATEWAY_BASE_URL and server gateway capability could not be resolved",
        observedAt: now(),
      },
    };
  }
}

function resolveEndpoints(env: NodeJS.ProcessEnv): ResolvedEndpoints {
  return {
    serverUrl: (env.RELEASE_E2E_SERVER_URL ?? DEFAULT_LOCAL_SERVER_URL).replace(/\/+$/, ""),
    runtimeUrl: (env.RELEASE_E2E_LOCAL_RUNTIME_URL ?? DEFAULT_LOCAL_RUNTIME_URL).replace(/\/+$/, ""),
    databaseUrl: env.RELEASE_E2E_LOCAL_DATABASE_URL,
    gatewayBaseUrl: env.RELEASE_E2E_GATEWAY_BASE_URL?.replace(/\/+$/, ""),
  };
}

/** A safe host-only identity for a gateway URL — never the key or userinfo. */
export function gatewayHostIdentity(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

/** Strip userinfo (credentials) from a DB URL before it enters a handle/evidence. */
export function sanitizeDatabaseUrl(url: string | undefined): string {
  if (!url) {
    return "";
  }
  return url.replace(/(:\/\/)[^@/]+@/, "$1[REDACTED]@");
}

async function httpStatus(url: string): Promise<{ status: number }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3_000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      return { status: response.status };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { status: 0 };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
