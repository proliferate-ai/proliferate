import { useMemo } from "react";
import { useComputeTargetAppearancePreferences } from "@/hooks/compute/workflows/use-compute-target-appearance-preferences";
import {
  buildComputeTargetAppearanceById,
  buildSshTargetOptions,
} from "@/lib/domain/compute/target-options";
import type { ComputeTargetSummary } from "@/lib/domain/compute/target-types";

const EMPTY_TARGETS: ComputeTargetSummary[] = [];

export function useComputeTargetOptions({
  enabled: _enabled = true,
  ownerScope = null,
}: {
  enabled?: boolean;
  ownerScope?: ComputeTargetSummary["ownerScope"] | null;
} = {}) {
  const appearancePreferences = useComputeTargetAppearancePreferences();
  const targets: ComputeTargetSummary[] = EMPTY_TARGETS;

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
    isLoading: appearancePreferences.loading,
  };
}
