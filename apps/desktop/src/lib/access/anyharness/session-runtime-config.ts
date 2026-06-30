import type {
  ApplyAgentAuthConfigRequest,
  ApplyRuntimeConfigRequest,
  RuntimeConfigRevisionExpectation,
} from "@anyharness/sdk";
import { getAnyHarnessClient } from "@anyharness/sdk-react";
import {
  ensurePersonalSandboxProfile,
  getSandboxProfileDesktopAgentAuthConfigApplyRequest,
  recordSandboxProfileDesktopAgentAuthConfigApplyStatus,
} from "@proliferate/cloud-sdk/client/agent-auth";
import { ProliferateClientError } from "@proliferate/cloud-sdk/client/core";
import {
  getSandboxProfileDesktopRuntimeConfigApplyRequest,
} from "@proliferate/cloud-sdk/client/runtime-config";
import type { RuntimeTarget } from "@/lib/access/anyharness/runtime-target";
import {
  applyAgentAuthConfig,
  applyRuntimeConfig,
  type AnyHarnessRuntimeConfigConnection,
} from "@/lib/access/anyharness/runtime-config";
import { logLatency } from "@/lib/infra/measurement/debug-latency";

type ApplyRuntimeConfigOptions = Parameters<typeof applyRuntimeConfig>[2];
type DesktopRuntimeConfigApplyRequestResponse = Awaited<
  ReturnType<typeof getSandboxProfileDesktopRuntimeConfigApplyRequest>
>;
type DesktopAgentAuthConfigApplyRequestResponse = Awaited<
  ReturnType<typeof getSandboxProfileDesktopAgentAuthConfigApplyRequest>
>;

const LOCAL_RUNTIME_CONFIG_CLOUD_PREFLIGHT_TIMEOUT_MS = 2_500;
const RUNTIME_CONFIG_PREFLIGHT_TIMEOUT = Symbol("runtime_config_preflight_timeout");

interface PrepareLocalSessionRuntimeConfigOptions {
  cloudPreflightTimeoutMs?: number;
}

export function assertDirectSessionCreateRuntimeConfigStamped(
  target: RuntimeTarget,
): void {
  if (target.location === "local" || target.runtimeAccessKind === "proliferate-gateway") {
    return;
  }
  throw new Error(
    "Remote session creation requires runtime config stamping. Start this session through the managed gateway or cloud command path.",
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
  if (target.location !== "local" && target.runtimeAccessKind !== "proliferate-gateway") {
    return null;
  }
  await prepareCloudSandboxGatewayAgentAuthConfig(target, connection, options, config);
  return prepareLocalSessionRuntimeConfig(connection, options, config);
}

export async function prepareCloudSandboxGatewayAgentAuthConfig(
  target: RuntimeTarget,
  connection: AnyHarnessRuntimeConfigConnection,
  options?: ApplyRuntimeConfigOptions,
  config?: PrepareLocalSessionRuntimeConfigOptions,
): Promise<void> {
  if (target.runtimeAccessKind !== "proliferate-gateway") {
    return;
  }
  const profile = await ensurePersonalSandboxProfile();
  const targetId = target.targetId ?? profile.primaryTargetId ?? null;
  const response = await getSandboxProfileDesktopAgentAuthConfigApplyRequest(
    profile.id,
    { targetId },
  );
  await materializeCloudSandboxGatewaySyncedFiles(
    target,
    connection,
    response,
  );
  const applied = await applyAgentAuthConfig(
    connection,
    response.applyRequest as unknown as ApplyAgentAuthConfigRequest,
    options,
  );
  void recordSandboxProfileDesktopAgentAuthConfigApplyStatus(
    profile.id,
    {
      targetId,
      revision: applied.revision,
      status: applied.status,
      applied: applied.applied,
    },
  ).catch((error: unknown) => {
    logLatency("session.agent_auth_config.status_report_failed", {
      runtimeAccessKind: target.runtimeAccessKind,
      error: error instanceof Error ? error.message : String(error),
    });
  });
  logLatency("session.agent_auth_config.prepared", {
    runtimeAccessKind: target.runtimeAccessKind,
    selectionCount: applied.selectionCount,
    status: applied.status,
    cloudPreflightTimeoutMs: config?.cloudPreflightTimeoutMs ?? null,
  });
}

async function materializeCloudSandboxGatewaySyncedFiles(
  target: RuntimeTarget,
  connection: AnyHarnessRuntimeConfigConnection,
  response: DesktopAgentAuthConfigApplyRequestResponse,
): Promise<void> {
  const files = response.syncedFiles ?? [];
  if (files.length === 0) {
    return;
  }
  const result = await getAnyHarnessClient(connection).processes.run(
    target.anyharnessWorkspaceId,
    {
      command: [
        "python3",
        "-c",
        AGENT_AUTH_SYNCED_FILE_WRITE_SCRIPT,
        JSON.stringify(files),
      ],
      timeoutMs: 10_000,
      maxOutputBytes: 16_384,
    },
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to materialize agent auth files: ${result.stderr || result.stdout || "unknown error"}`,
    );
  }
  logLatency("session.agent_auth_config.synced_files_materialized", {
    runtimeAccessKind: target.runtimeAccessKind,
    fileCount: files.length,
  });
}

const AGENT_AUTH_SYNCED_FILE_WRITE_SCRIPT = `
import json
import os
import pathlib
import sys

home = pathlib.Path.home()
for item in json.loads(sys.argv[1]):
    relative_path = str(item["relativePath"])
    pure = pathlib.PurePosixPath(relative_path)
    if relative_path.startswith("/") or any(part in ("", ".", "..") for part in pure.parts):
        raise SystemExit(f"unsafe agent auth path: {relative_path}")
    destination = home.joinpath(*pure.parts)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(str(item["content"]), encoding="utf-8")
    os.chmod(destination, 0o600)
`.trim();

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
