import type { HarnessLaunchOptionsResponse } from "@anyharness/sdk";
import { useAgentLaunchOptionsQuery } from "@anyharness/sdk-react";
import type { CloudHarnessLaunchOptionsResponse } from "@proliferate/cloud-sdk";
import {
  useCloudHarnessLaunchOptions,
  useCloudSandbox,
} from "@proliferate/cloud-sdk-react";
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

function isNotFound(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "status" in error
    && error.status === 404,
  );
}
