import type { HarnessLaunchOptionsResponse } from "@anyharness/sdk";
import {
  useAgentLaunchOptionsListQuery,
  useAgentLaunchOptionsQuery,
  type AgentLaunchOptionsListEntry,
} from "@anyharness/sdk-react";
import type { HomeLaunchTarget } from "#product/lib/domain/home/home-next-launch";

type HomeTargetLaunchOptions = HarnessLaunchOptionsResponse;

/**
 * Reads launch options from the execution target Home will actually launch.
 *
 * Local, worktree, and Cowork launches share the desktop AnyHarness runtime.
 * The cloud sandbox stack (and with it the copied, target-scoped cloud
 * observation) is deleted, so a cloud target is permanently unobserved; it
 * never falls back to the desktop runtime.
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
  /** Re-asks the target. The cure behind the blocked notices' Retry / Check
   * again — a state that offers an action must be able to perform it. */
  refetch: () => void;
} {
  const isCloudTarget = launchTarget?.kind === "cloud";
  const isLocalRuntimeTarget = launchTarget !== null && !isCloudTarget;
  const localLaunchOptions = useAgentLaunchOptionsQuery({
    harnessKind,
    enabled: isLocalRuntimeTarget,
  });

  if (isCloudTarget) {
    // No cloud copy exists to read (or refetch): unobserved is permanent.
    return {
      data: undefined,
      error: null,
      isError: false,
      isLoading: false,
      isTargetUnobserved: true,
      refetch: () => {},
    };
  }

  if (!isLocalRuntimeTarget) {
    return {
      data: undefined,
      error: null,
      isError: false,
      isLoading: false,
      isTargetUnobserved: false,
      refetch: () => {},
    };
  }

  return {
    data: localLaunchOptions.data,
    error: localLaunchOptions.error,
    isError: localLaunchOptions.isError,
    isLoading: localLaunchOptions.isLoading,
    isTargetUnobserved: false,
    refetch: () => {
      void localLaunchOptions.refetch();
    },
  };
}

/**
 * Additive fan-out companion: launch options for the OTHER ready harnesses on
 * the same execution target, one entry per kind. Local-runtime targets only —
 * a cloud launch reads its sandbox's copied observation per kind and keeps
 * today's single-kind behavior (the cloud copy store has no list read yet;
 * recorded follow-up).
 *
 * The entries carry the list query's per-kind pending/error flags, not just
 * `data`: `data === null` alone cannot tell a kind still being asked apart
 * from a kind whose read failed, and the Home gate reports those as different
 * states (`querying` vs `transport_error`). `useQueries` structurally shares
 * `combine`'s result, so unchanged entries keep their reference.
 */
export function useHomeTargetOtherAgentsLaunchOptions({
  harnessKinds,
  launchTarget,
}: {
  harnessKinds: readonly string[];
  launchTarget: HomeLaunchTarget | null;
}): AgentLaunchOptionsListEntry[] {
  const isLocalRuntimeTarget = launchTarget !== null && launchTarget.kind !== "cloud";
  const entries = useAgentLaunchOptionsListQuery({
    harnessKinds,
    enabled: isLocalRuntimeTarget,
  });
  // Stable empty reference: a fresh [] here would recompute the whole
  // downstream memo chain on every cloud/no-target render.
  return isLocalRuntimeTarget ? entries : EMPTY_ENTRIES;
}

const EMPTY_ENTRIES: AgentLaunchOptionsListEntry[] = [];
