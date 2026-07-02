import { useMemo } from "react";
import { useCloudTargets } from "@/hooks/access/cloud/targets/use-cloud-targets";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { useDirectRuntimeAttachStateResolver } from "@/hooks/compute/derived/use-direct-runtime-attach-states";
import { useComputeTargetAppearancePreferences } from "@/hooks/settings/workflows/use-ssh-direct-target-profile";
import type { DirectRuntimeConnectionState } from "@/lib/domain/compute/direct-runtime";
import {
  buildComputeTargetAppearanceById,
  buildSshTargetOptions,
} from "@/lib/domain/compute/target-options";
import type { ComputeTargetSummary } from "@/lib/domain/compute/target-types";

const EMPTY_TARGETS: ComputeTargetSummary[] = [];

export function useComputeTargetOptions({
  enabled = true,
  ownerScope = null,
}: {
  enabled?: boolean;
  ownerScope?: ComputeTargetSummary["ownerScope"] | null;
} = {}) {
  const { cloudActive } = useCloudAvailabilityState();
  const appearancePreferences = useComputeTargetAppearancePreferences();
  const queryEnabled = enabled && cloudActive;
  const targetsQuery = useCloudTargets(queryEnabled);
  const targets: ComputeTargetSummary[] = (queryEnabled ? targetsQuery.data : undefined)
    ?? EMPTY_TARGETS;
  const getAttachState = useDirectRuntimeAttachStateResolver();

  const attachStates = useMemo(() => {
    const states: Record<string, DirectRuntimeConnectionState> = {};
    for (const target of targets) {
      if (target.kind === "ssh") {
        states[target.id] = getAttachState(target.id);
      }
    }
    return states;
  }, [getAttachState, targets]);

  const sshTargetOptions = useMemo(() => buildSshTargetOptions({
    targets,
    appearancePreferences: appearancePreferences.preferences,
    ownerScope,
    attachStates,
  }), [appearancePreferences.preferences, attachStates, ownerScope, targets]);

  const targetAppearanceById = useMemo(() => buildComputeTargetAppearanceById({
    targets,
    appearancePreferences: appearancePreferences.preferences,
  }), [appearancePreferences.preferences, targets]);

  return {
    targets,
    sshTargetOptions,
    targetAppearanceById,
    isLoading:
      appearancePreferences.loading || (queryEnabled && targetsQuery.isLoading),
  };
}
