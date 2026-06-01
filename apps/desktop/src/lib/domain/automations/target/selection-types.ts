import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";
import type { ComputeLaunchTargetOption } from "@/lib/domain/compute/target-options";
import type {
  AutomationExecutionTarget,
  AutomationTargetCloudWorkspaceRecord,
  AutomationTargetRepoConfigRecord,
} from "@/lib/domain/automations/target/records";

export type { AutomationExecutionTarget };

export interface AutomationTargetSelection {
  executionTarget: AutomationExecutionTarget;
  gitOwner: string;
  gitRepoName: string;
  cloudTargetId?: string | null;
}

export interface AutomationTargetRepoIdentity {
  gitOwner: string;
  gitRepoName: string;
}

export type AutomationTargetRow =
  | {
    kind: "target";
    id: string;
    repoKey: string;
    repoLabel: string;
    label: string;
    description: string | null;
    target: AutomationTargetSelection;
    computeTargetOption?: ComputeLaunchTargetOption | null;
    disabledReason: string | null;
    selected: boolean;
  }
  | {
    kind: "configureCloud";
    id: string;
    repoKey: string;
    repoLabel: string;
    label: string;
    description: string | null;
    gitOwner: string;
    gitRepoName: string;
  };

export interface AutomationTargetGroup {
  repoKey: string;
  repoLabel: string;
  gitOwner: string;
  gitRepoName: string;
  rows: AutomationTargetRow[];
}

export interface AutomationTargetState {
  groups: AutomationTargetGroup[];
  selectedTarget: AutomationTargetSelection | null;
  selectedRow: Extract<AutomationTargetRow, { kind: "target" }> | null;
  canSubmit: boolean;
  disabledReason: string | null;
}

export interface BuildAutomationTargetStateInput {
  repoConfigs: readonly AutomationTargetRepoConfigRecord[] | null | undefined;
  cloudWorkspaces?: readonly AutomationTargetCloudWorkspaceRecord[] | null | undefined;
  sshTargets?: readonly ComputeLaunchTargetOption[] | null | undefined;
  repositories: readonly SettingsRepositoryEntry[] | null | undefined;
  selectedTarget: AutomationTargetSelection | null;
  savedTarget?: AutomationTargetSelection | null;
  editRepoIdentity?: AutomationTargetRepoIdentity | null;
  cloudAvailable?: boolean;
}

export interface TargetRepoDraft {
  repoKey: string;
  gitOwner: string;
  gitRepoName: string;
  label: string;
  hasLocalRepository: boolean;
  hasConfiguredCloud: boolean;
  hasCloudWorkspace: boolean;
  hasCloudConfig: boolean;
  hasSavedCloudTarget: boolean;
  hasSavedLocalTarget: boolean;
}
