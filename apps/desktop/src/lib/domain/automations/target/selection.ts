import {
  automationTargetId,
  isSameAutomationRepo,
} from "@/lib/domain/automations/target/selection-identity";
import { buildTargetRepoDrafts } from "@/lib/domain/automations/target/selection-drafts";
import {
  buildTargetGroups,
  constrainTargetToRows,
  findSelectedTargetRow,
  firstDefaultTarget,
} from "@/lib/domain/automations/target/selection-rows";
import type {
  AutomationTargetState,
  BuildAutomationTargetStateInput,
} from "@/lib/domain/automations/target/selection-types";

export type {
  AutomationExecutionTarget,
  AutomationTargetGroup,
  AutomationTargetRepoIdentity,
  AutomationTargetRow,
  AutomationTargetSelection,
  AutomationTargetState,
  BuildAutomationTargetStateInput,
} from "@/lib/domain/automations/target/selection-types";

export {
  automationTargetId,
  isSameAutomationRepo,
};

export function buildAutomationTargetState({
  repoConfigs,
  cloudWorkspaces,
  sshTargets,
  repositories,
  selectedTarget,
  savedTarget = null,
  editRepoIdentity = null,
  cloudAvailable = true,
}: BuildAutomationTargetStateInput): AutomationTargetState {
  const repoDrafts = buildTargetRepoDrafts({
    repoConfigs,
    cloudWorkspaces,
    repositories,
    savedTarget,
    editRepoIdentity,
  });
  const defaultTarget = editRepoIdentity
    ? savedTarget
    : firstDefaultTarget(repoDrafts, cloudAvailable);
  const requestedTarget = selectedTarget ?? defaultTarget;
  const constrainedTarget = constrainTargetToRows(
    requestedTarget,
    repoDrafts,
    cloudAvailable,
  );
  const effectiveTarget = constrainedTarget ?? constrainTargetToRows(
    defaultTarget,
    repoDrafts,
    cloudAvailable,
  );
  const groups = buildTargetGroups(
    repoDrafts,
    effectiveTarget,
    cloudAvailable,
    sshTargets ?? [],
  );
  const selectedRow = findSelectedTargetRow(groups, effectiveTarget);
  const unsupportedReason = effectiveTarget?.executionTarget === "ssh"
    ? "SSH automation dispatch is not wired yet."
    : null;
  const disabledReason = effectiveTarget
    ? selectedRow?.disabledReason ?? unsupportedReason
    : "Select a local worktree or configured cloud workspace.";

  return {
    groups,
    selectedTarget: effectiveTarget,
    selectedRow,
    canSubmit: Boolean(effectiveTarget && selectedRow && !selectedRow.disabledReason && !unsupportedReason),
    disabledReason,
  };
}
