import {
  resolveComputeTargetAppearance,
  type ComputeTargetAppearance,
  type ComputeTargetAppearancePreference,
} from "@/lib/domain/compute/target-appearance";
import type { DirectRuntimeConnectionState } from "@/lib/domain/compute/direct-runtime";
import {
  computeTargetOwnerLabel,
  computeTargetStatusLabel,
} from "@/lib/domain/compute/target-presentation";
import type { ComputeTargetSummary } from "@/lib/domain/compute/target-types";

export interface ComputeLaunchTargetOption {
  id: string;
  label: string;
  detail: string;
  ownerScope: ComputeTargetSummary["ownerScope"];
  status: ComputeTargetSummary["status"];
  appearance: ComputeTargetAppearance;
  disabledReason: string | null;
  /** Desktop-plane attach state; null when the caller has no attach data. */
  attachState?: DirectRuntimeConnectionState | null;
  target: ComputeTargetSummary;
}

export function buildComputeTargetAppearanceById(input: {
  targets: readonly ComputeTargetSummary[];
  appearancePreferences: Record<string, ComputeTargetAppearancePreference>;
}): Record<string, ComputeTargetAppearance> {
  const entries = input.targets.map((target) => [
    target.id,
    resolveComputeTargetAppearance({
      targetId: target.id,
      displayName: target.displayName,
      kind: target.kind,
      preference: input.appearancePreferences[target.id],
    }),
  ]);
  return Object.fromEntries(entries);
}

export function buildSshTargetOptions(input: {
  targets: readonly ComputeTargetSummary[];
  appearancePreferences: Record<string, ComputeTargetAppearancePreference>;
  ownerScope?: ComputeTargetSummary["ownerScope"] | null;
  attachStates?: Record<string, DirectRuntimeConnectionState>;
}): ComputeLaunchTargetOption[] {
  return input.targets
    .filter((target) =>
      target.kind === "ssh"
      && !target.archivedAt
      && (!input.ownerScope || target.ownerScope === input.ownerScope)
    )
    .map((target) => {
      const appearance = resolveComputeTargetAppearance({
        targetId: target.id,
        displayName: target.displayName,
        kind: target.kind,
        preference: input.appearancePreferences[target.id],
      });
      return {
        id: target.id,
        label: appearance.displayName,
        detail: [
          `${computeTargetOwnerLabel(target.ownerScope)} SSH target`,
          computeTargetStatusLabel(target.status).toLowerCase(),
          target.defaultWorkspaceRoot ?? null,
        ].filter(Boolean).join(" · "),
        ownerScope: target.ownerScope,
        status: target.status,
        appearance,
        disabledReason: sshTargetDisabledReason(target),
        attachState: input.attachStates?.[target.id] ?? null,
        target,
      };
    })
    .sort((left, right) => {
      const byOwner = left.ownerScope.localeCompare(right.ownerScope);
      return byOwner || left.label.localeCompare(right.label);
    });
}

function sshTargetDisabledReason(target: ComputeTargetSummary): string | null {
  switch (target.status) {
    case "online":
      return null;
    case "enrolling":
      return "Waiting for enrollment.";
    case "offline":
      return "Target is offline.";
    case "degraded":
      return "Target is degraded.";
    case "archived":
      return "Target is archived.";
  }
}
