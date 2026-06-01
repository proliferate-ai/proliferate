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

type ApplyRuntimeConfigOptions = Parameters<typeof applyRuntimeConfig>[2];

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
): Promise<RuntimeConfigRevisionExpectation | null> {
  try {
    const profile = await ensurePersonalSandboxProfile();
    const response = await getSandboxProfileDesktopRuntimeConfigApplyRequest(
      profile.id,
      { targetId: profile.primaryTargetId ?? null },
    );
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

function isOptionalLocalRuntimeConfigError(error: unknown): boolean {
  return error instanceof ProliferateClientError
    && (error.code === "cloud_client_unconfigured" || error.status === 401);
}
