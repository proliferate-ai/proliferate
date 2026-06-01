import type { ReactNode } from "react";
import {
  ChevronDown,
  CloudIcon,
  Copy,
  Folder,
  FolderOpen,
  GitBranch,
} from "@proliferate/ui/icons";
import { ComposerControlButton } from "@proliferate/ui/primitives/ComposerControlButton";
import { WorkspaceMobilityFooterProgressStatus } from "@/components/workspace/chat/input/WorkspaceMobilityFooterRow";
import { WorkspaceMobilityLocationPopover } from "@/components/workspace/chat/input/WorkspaceMobilityLocationPopover";
import { WorkspaceMobilityOverlayView } from "@/components/workspace/chat/surface/WorkspaceMobilityOverlay";
import type { ScenarioKey } from "@/config/playground";
import type { MobilityPromptState } from "@/lib/domain/workspaces/mobility/mobility-prompt";
import type { WorkspaceMobilityDestinationOption } from "@/lib/domain/workspaces/mobility/mobility-destinations";
import {
  getMobilityOverlayTitle,
  mobilityStatusCopy,
} from "@/lib/domain/workspaces/mobility/presentation";
import type { WorkspaceMobilityConfirmSnapshot } from "@/lib/domain/workspaces/mobility/types";
import { noop } from "@/components/playground/PlaygroundComposerActions";

export function PlaygroundMobilityFooterRow({ scenario }: { scenario: ScenarioKey }) {
  const prompt = mobilityPromptForScenario(scenario);
  const isCloudScenario = scenario === "mobility-cloud-active"
    || scenario === "mobility-in-flight"
    || scenario.startsWith("cloud-");
  const locationLabel = isCloudScenario
    ? "Cloud workspace"
    : "Local worktree";
  const detailLabel = isCloudScenario
    ? "proliferate-ai/proliferate"
    : "/Users/pablo/proliferate";
  const detailIcon = isCloudScenario
    ? <CloudIcon className="size-3.5" />
    : <Folder className="size-3.5" />;
  const progressStatus = scenario === "mobility-in-flight"
    ? {
      title: getMobilityOverlayTitle("local_to_cloud", "transferring"),
      statusLabel: mobilityStatusCopy("transferring", "local_to_cloud").title,
    }
    : null;

  if (progressStatus) {
    return (
      <div className="relative rounded-[var(--radius-composer)] border border-border bg-card px-2 py-2 shadow-xs">
        <WorkspaceMobilityFooterProgressStatus
          title={progressStatus.title}
          statusLabel={progressStatus.statusLabel}
        />
      </div>
    );
  }

  return (
    <div className="relative rounded-[var(--radius-composer)] border border-border bg-card px-2 py-2 shadow-xs">
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
        <ComposerControlButton
          icon={isCloudScenario ? <CloudIcon className="size-3.5" /> : <FolderOpen className="size-3.5" />}
          label={locationLabel}
          active={Boolean(prompt) || scenario === "mobility-in-flight"}
          trailing={<ChevronDown className="size-3 text-muted-foreground/70" />}
          disabled
        />
        <ComposerControlButton
          icon={detailIcon}
          label={detailLabel}
          labelClassName={isCloudScenario ? undefined : "[direction:rtl]"}
          trailing={<Copy className="size-3 text-muted-foreground/70" />}
          disabled
        />
        <ComposerControlButton
          icon={<GitBranch className="size-3.5" />}
          label="feature/workspace-mobility"
          trailing={<Copy className="size-3 text-muted-foreground/70" />}
          disabled
        />
      </div>
      {prompt && (
        <div className="absolute bottom-full left-2 z-10 mb-2">
          <WorkspaceMobilityLocationPopover
            destinationOptions={mobilityDestinationOptionsForScenario(isCloudScenario)}
            selectedDestinationId={isCloudScenario ? "local_workspace" : "cloud_workspace"}
            prompt={prompt}
            snapshot={mobilitySnapshotForScenario(scenario)}
            onClose={noop}
            onSelectDestination={noop}
            onPrimaryAction={noop}
          />
        </div>
      )}
    </div>
  );
}

export function renderMobilityOverlayPreview(scenario: ScenarioKey): ReactNode | null {
  if (scenario === "mobility-in-flight") {
    return null;
  }

  if (scenario === "mobility-failed") {
    const phase = "cleanup_failed";
    const direction = "local_to_cloud";
    return (
      <WorkspaceMobilityOverlayView
        description={mobilityStatusCopy(phase, direction).description}
        mode="cleanup_failed"
        onContinueWorking={noop}
        onRetryCleanup={noop}
        title={getMobilityOverlayTitle(direction, phase)}
      />
    );
  }

  return null;
}

function mobilityDestinationOptionsForScenario(
  isCloudScenario: boolean,
): WorkspaceMobilityDestinationOption[] {
  return isCloudScenario
    ? [{
      id: "local_workspace",
      kind: "local_workspace",
      label: "Local workspace",
      detail: "Bring this workspace back to your local repo.",
      disabledReason: null,
      direction: "cloud_to_local",
    }]
    : [{
      id: "cloud_workspace",
      kind: "cloud_workspace",
      label: "Cloud workspace",
      detail: "Move this workspace to a personal cloud sandbox.",
      disabledReason: null,
      direction: "local_to_cloud",
    }];
}

function mobilityPromptForScenario(
  scenario: ScenarioKey,
): MobilityPromptState | null {
  switch (scenario) {
    case "mobility-local-actionable":
      return {
        variant: "actionable",
        direction: "local_to_cloud",
        headline: "Move to cloud",
        body: "Move this local worktree to a cloud runtime.",
        helper: null,
        actionLabel: "Move to cloud",
        warning: "Active terminals will stay here.",
        blocker: null,
        primaryActionKind: "confirm_move",
      };
    case "mobility-local-blocked":
      return {
        variant: "blocked",
        direction: "local_to_cloud",
        headline: "Prepare branch for move",
        body: "This workspace has uncommitted changes.",
        helper: "Commit and push these changes so the destination can check out the exact code.",
        actionLabel: "Prepare branch",
        warning: null,
        blocker: null,
        primaryActionKind: "prepare_branch",
      };
    case "mobility-unpublished-branch":
      return {
        variant: "blocked",
        direction: "local_to_cloud",
        headline: "Publish branch before moving",
        body: "This branch isn't on GitHub yet.",
        helper: "Push `feature/workspace-mobility` so the destination can check out the exact commit.",
        actionLabel: "Push and move",
        warning: null,
        blocker: null,
        primaryActionKind: "publish_branch",
      };
    case "mobility-unpushed-commits":
      return {
        variant: "blocked",
        direction: "local_to_cloud",
        headline: "Publish branch before moving",
        body: "This branch has commits that only exist on this runtime.",
        helper: "Push `feature/workspace-mobility` so the destination can check out the exact commit.",
        actionLabel: "Push and move",
        warning: null,
        blocker: null,
        primaryActionKind: "push_commits",
      };
    case "mobility-out-of-sync-branch":
      return {
        variant: "blocked",
        direction: "local_to_cloud",
        headline: "Sync branch before moving",
        body: "This branch is out of sync with GitHub.",
        helper: "Pull or rebase locally, then try again.",
        actionLabel: "Got it",
        warning: null,
        blocker: null,
        primaryActionKind: null,
      };
    case "mobility-failed":
      return null;
    default:
      return null;
  }
}

function mobilitySnapshotForScenario(
  scenario: ScenarioKey,
): WorkspaceMobilityConfirmSnapshot | null {
  if (scenario !== "mobility-local-actionable") {
    return null;
  }

  return {
    logicalWorkspaceId: "logical-1",
    direction: "local_to_cloud",
    sourceWorkspaceId: "workspace-1",
    mobilityWorkspaceId: "mobility-1",
    sourcePreflight: {
      canMove: true,
      branchName: "feature/workspace-mobility",
      baseCommitSha: "abc123456789",
      blockers: [],
      warnings: ["Terminal abc will not migrate"],
      sessions: [],
    } as never,
    cloudPreflight: {
      canStart: true,
      blockers: [],
      excludedPaths: [],
      workspace: {
        repo: {
          branch: "feature/workspace-mobility",
        },
      },
    } as never,
  };
}
