import { useMemo } from "react";
import { useCloudTargets } from "@/hooks/access/cloud/targets/use-cloud-targets";
import { useComputeTargetAppearancePreferences } from "@/hooks/settings/workflows/use-ssh-direct-target-profile";
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
  const targetsQuery = useCloudTargets(enabled);
  const appearancePreferences = useComputeTargetAppearancePreferences();
  const targets: ComputeTargetSummary[] = targetsQuery.data ?? EMPTY_TARGETS;

  const sshTargetOptions = useMemo(() => buildSshTargetOptions({
    targets,
    appearancePreferences: appearancePreferences.preferences,
    ownerScope,
  }), [appearancePreferences.preferences, ownerScope, targets]);

  const targetAppearanceById = useMemo(() => buildComputeTargetAppearanceById({
    targets,
    appearancePreferences: appearancePreferences.preferences,
  }), [appearancePreferences.preferences, targets]);

  return {
    targets,
    sshTargetOptions,
    targetAppearanceById,
    isLoading: targetsQuery.isLoading || appearancePreferences.loading,
  };
}
