import type {
  ApplyRuntimeConfigRequest,
  RuntimeConfigRevisionExpectation,
} from "@anyharness/sdk";
import { ensurePersonalSandboxProfile } from "@proliferate/cloud-sdk/client/agent-auth";
import { ProliferateClientError } from "@proliferate/cloud-sdk/client/core";
import {
  getSandboxProfileDesktopRuntimeConfigApplyRequest,
} from "@proliferate/cloud-sdk/client/runtime-config";
import type { RuntimeTarget } from "@/lib/access/anyharness/runtime-target";
import {
  applyRuntimeConfig,
  type AnyHarnessRuntimeConfigConnection,
} from "@/lib/access/anyharness/runtime-config";
import { logLatency } from "@/lib/infra/measurement/debug-latency";

type ApplyRuntimeConfigOptions = Parameters<typeof applyRuntimeConfig>[2];
type DesktopRuntimeConfigApplyRequestResponse = Awaited<
  ReturnType<typeof getSandboxProfileDesktopRuntimeConfigApplyRequest>
>;

const LOCAL_RUNTIME_CONFIG_CLOUD_PREFLIGHT_TIMEOUT_MS = 2_500;
const RUNTIME_CONFIG_PREFLIGHT_TIMEOUT = Symbol("runtime_config_preflight_timeout");

interface PrepareLocalSessionRuntimeConfigOptions {
  cloudPreflightTimeoutMs?: number;
}

export function assertDirectSessionCreateRuntimeConfigStamped(
  target: RuntimeTarget,
): void {
  if (target.location === "local") {
    return;
  }
  throw new Error(
    "Remote session creation requires runtime config stamping. Start this session from the cloud command path.",
  );
}

export async function prepareLocalSessionRuntimeConfig(
  connection: AnyHarnessRuntimeConfigConnection,
  options?: ApplyRuntimeConfigOptions,
  config?: PrepareLocalSessionRuntimeConfigOptions,
): Promise<RuntimeConfigRevisionExpectation | null> {
  try {
    const response = await loadDesktopRuntimeConfigApplyRequest(
      config?.cloudPreflightTimeoutMs ?? LOCAL_RUNTIME_CONFIG_CLOUD_PREFLIGHT_TIMEOUT_MS,
    );
    if (!response) {
      return null;
    }
    const applied = await applyRuntimeConfig(
      connection,
      response.applyRequest as unknown as ApplyRuntimeConfigRequest,
      options,
    );
    return {
      revisionId: applied.revision.id,
      sequence: applied.revision.sequence,
      contentHash: applied.revision.contentHash,
      externalScope: applied.revision.externalScope ?? null,
    };
  } catch (error) {
    if (isOptionalLocalRuntimeConfigError(error)) {
      return null;
    }
    throw error;
  }
}

export async function prepareLocalRuntimeConfigForTarget(
  target: RuntimeTarget,
  connection: AnyHarnessRuntimeConfigConnection,
  options?: ApplyRuntimeConfigOptions,
  config?: PrepareLocalSessionRuntimeConfigOptions,
): Promise<RuntimeConfigRevisionExpectation | null> {
  if (target.location !== "local") {
    return null;
  }
  return prepareLocalSessionRuntimeConfig(connection, options, config);
}

async function loadDesktopRuntimeConfigApplyRequest(
  timeoutMs: number,
): Promise<DesktopRuntimeConfigApplyRequestResponse | null> {
  const startedAt = Date.now();
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
  const preflight = (async () => {
    const profile = await ensurePersonalSandboxProfile();
    return getSandboxProfileDesktopRuntimeConfigApplyRequest(
      profile.id,
      { targetId: profile.primaryTargetId ?? null },
    );
  })();
  void preflight.catch(() => null);

  const timeout = new Promise<typeof RUNTIME_CONFIG_PREFLIGHT_TIMEOUT>((resolve) => {
    timeoutId = globalThis.setTimeout(() => {
      resolve(RUNTIME_CONFIG_PREFLIGHT_TIMEOUT);
    }, timeoutMs);
  });

  const result = await Promise.race([preflight, timeout]);
  if (timeoutId) {
    globalThis.clearTimeout(timeoutId);
  }
  if (result === RUNTIME_CONFIG_PREFLIGHT_TIMEOUT) {
    logLatency("session.runtime_config.cloud_preflight.timeout", {
      elapsedMs: Date.now() - startedAt,
      timeoutMs,
    });
    throw new Error(`Timed out preparing local runtime config after ${timeoutMs}ms.`);
  }
  logLatency("session.runtime_config.cloud_preflight.completed", {
    elapsedMs: Date.now() - startedAt,
    timeoutMs,
  });
  return result;
}

function isOptionalLocalRuntimeConfigError(error: unknown): boolean {
  return error instanceof ProliferateClientError
    && (error.code === "cloud_client_unconfigured" || error.status === 401);
}
