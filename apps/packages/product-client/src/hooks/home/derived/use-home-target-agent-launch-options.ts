import type { HarnessLaunchOptionsResponse } from "@anyharness/sdk";
import {
  useAgentLaunchOptionsListQuery,
  useAgentLaunchOptionsQuery,
} from "@anyharness/sdk-react";
import type { CloudHarnessLaunchOptionsResponse } from "@proliferate/cloud-sdk";
import {
  useCloudHarnessLaunchOptions,
  useCloudSandbox,
} from "@proliferate/cloud-sdk-react";
import { useMemo } from "react";
import type { HomeLaunchTarget } from "#product/lib/domain/home/home-next-launch";

type HomeTargetLaunchOptions =
  | HarnessLaunchOptionsResponse
  | CloudHarnessLaunchOptionsResponse;

/**
 * Reads launch options from the execution target Home will actually launch.
 *
 * Local, worktree, and Cowork launches share the desktop AnyHarness runtime.
 * Cloud launches belong to the account's cloud sandbox and therefore read its
 * copied, target-scoped observation. A missing cloud copy is an honest
 * unobserved state; it never falls back to the desktop runtime.
 */
export function useHomeTargetAgentLaunchOptions({
  harnessKind,
  launchTarget,
}: {
  harnessKind: string | null | undefined;
  launchTarget: HomeLaunchTarget | null;
}): {
  data: HomeTargetLaunchOptions | undefined;
  error: Error | null;
  isError: boolean;
  isLoading: boolean;
  isTargetUnobserved: boolean;
} {
  const isCloudTarget = launchTarget?.kind === "cloud";
  const isLocalRuntimeTarget = launchTarget !== null && !isCloudTarget;
  const cloudSandbox = useCloudSandbox(isCloudTarget);
  const localLaunchOptions = useAgentLaunchOptionsQuery({
    harnessKind,
    enabled: isLocalRuntimeTarget,
  });
  const cloudLaunchOptions = useCloudHarnessLaunchOptions({
    cloudSandboxId: cloudSandbox.data?.id,
    harnessKind,
    enabled: isCloudTarget,
  });

  if (isCloudTarget) {
    const missingCloudSandbox =
      !cloudSandbox.isLoading
      && !cloudSandbox.isError
      && cloudSandbox.data === null;
    const missingCloudObservation = isNotFound(cloudLaunchOptions.error);
    const isTargetUnobserved = missingCloudSandbox || missingCloudObservation;
    return {
      data: cloudLaunchOptions.data,
      error: isTargetUnobserved
        ? null
        : cloudSandbox.error ?? cloudLaunchOptions.error ?? null,
      isError:
        !isTargetUnobserved
        && (cloudSandbox.isError || cloudLaunchOptions.isError),
      isLoading: cloudSandbox.isLoading || cloudLaunchOptions.isLoading,
      isTargetUnobserved,
    };
  }

  if (!isLocalRuntimeTarget) {
    return {
      data: undefined,
      error: null,
      isError: false,
      isLoading: false,
      isTargetUnobserved: false,
    };
  }

  return {
    data: localLaunchOptions.data,
    error: localLaunchOptions.error,
    isError: localLaunchOptions.isError,
    isLoading: localLaunchOptions.isLoading,
    isTargetUnobserved: false,
  };
}

/**
 * Additive fan-out companion: launch options for the OTHER ready harnesses on
 * the same execution target, one response (or `null` while unresolved) per
 * kind. Local-runtime targets only — a cloud launch reads its sandbox's copied
 * observation per kind and keeps today's single-kind behavior (the cloud copy
 * store has no list read yet; recorded follow-up).
 */
export function useHomeTargetOtherAgentsLaunchOptions({
  harnessKinds,
  launchTarget,
}: {
  harnessKinds: readonly string[];
  launchTarget: HomeLaunchTarget | null;
}): Array<HarnessLaunchOptionsResponse | null> {
  const isLocalRuntimeTarget = launchTarget !== null && launchTarget.kind !== "cloud";
  const entries = useAgentLaunchOptionsListQuery({
    harnessKinds,
    enabled: isLocalRuntimeTarget,
  });
  // The per-kind pending/error flags belong to a later slice; this hook still
  // answers in responses. The entries are reference-stable, so this memo holds
  // the downstream chain steady exactly as the raw array used to.
  const responses = useMemo(() => entries.map((entry) => entry.data), [entries]);
  // Stable empty reference: a fresh [] here would recompute the whole
  // downstream memo chain on every cloud/no-target render.
  return isLocalRuntimeTarget ? responses : EMPTY_RESPONSES;
}

const EMPTY_RESPONSES: Array<HarnessLaunchOptionsResponse | null> = [];

function isNotFound(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "status" in error
    && error.status === 404,
  );
}
