import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { humanizeBranchName, workspaceCurrentBranchName } from "@/lib/domain/workspaces/creation/branch-naming";
import {
  cloudWorkspaceSyntheticId,
  isCloudWorkspaceId,
} from "@/lib/domain/workspaces/cloud/cloud-ids";
import type { CloudWorkspaceSummary } from "@/lib/domain/workspaces/cloud/cloud-workspace-model";
import { workspaceDisplayName } from "@/lib/domain/workspaces/display/workspace-display";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import type {
  SupportReportWindowSnapshot,
  SupportReportWorkspaceOption,
} from "@/lib/domain/support/report-types";
import type { SupportMessageContext } from "@/lib/domain/support/types";

interface UseSupportReportSnapshotOptions {
  source: SupportMessageContext["source"];
}

export function useSupportReportSnapshot({
  source,
}: UseSupportReportSnapshotOptions): SupportReportWindowSnapshot {
  const location = useLocation();
  const { data: workspaceCollections } = useWorkspaces();
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);

  return useMemo(() => {
    const pathname = `${location.pathname}${location.search}`;
    const localOptions = (workspaceCollections?.allWorkspaces ?? []).map((workspace) => ({
      id: workspace.id,
      label: workspaceDisplayName(workspace),
      location: "local" as const,
      path: workspace.path,
      branch: workspaceCurrentBranchName(workspace),
      status: workspace.lifecycleState,
      updatedAt: workspace.updatedAt,
    }));
    const cloudOptions = (workspaceCollections?.cloudWorkspaces ?? []).map(cloudWorkspaceOption);
    const workspaceOptions = [...localOptions, ...cloudOptions]
      .sort(compareWorkspaceOptionsByUpdatedAtDesc);
    const defaultWorkspace = resolveDefaultWorkspace(workspaceOptions, selectedWorkspaceId);
    const context = buildSupportReportContext({
      source,
      pathname,
      workspaceOptions,
      selectedWorkspaceId: defaultWorkspace?.id ?? null,
    });

    return {
      openedAt: new Date().toISOString(),
      source,
      context,
      defaultScope: defaultWorkspace ? "most_recent_workspace" : "app_only",
      defaultWorkspaceId: defaultWorkspace?.id ?? null,
      workspaceOptions,
    };
  }, [
    location.pathname,
    location.search,
    selectedWorkspaceId,
    source,
    workspaceCollections,
  ]);
}

function cloudWorkspaceOption(
  workspace: CloudWorkspaceSummary,
): SupportReportWorkspaceOption {
  const branch = workspace.repo.branch || workspace.repo.baseBranch || null;
  const materialization = workspace.primaryMaterialization;
  const targetId = workspace.targetId
    ?? workspace.executionTarget?.targetId
    ?? materialization?.targetId
    ?? workspace.directTargetContext?.targetId
    ?? null;
  return {
    id: cloudWorkspaceSyntheticId(workspace.id),
    label: workspace.displayName?.trim()
      || (branch ? humanizeBranchName(branch) : workspace.repo.name),
    location: "cloud",
    path: `${workspace.repo.owner}/${workspace.repo.name}`,
    branch,
    status: workspace.status,
    updatedAt: workspace.updatedAt ?? workspace.readyAt ?? workspace.createdAt ?? null,
    cloudWorkspaceId: workspace.id,
    cloudTargetId: targetId,
    anyharnessWorkspaceId: materialization?.anyharnessWorkspaceId
      ?? workspace.directTargetContext?.anyharnessWorkspaceId
      ?? null,
    exposureId: workspace.cloudAccess?.exposureId ?? null,
    materializationId: workspace.selectedMaterializationId ?? materialization?.id ?? null,
    visibility: workspace.visibility,
    sandboxType: workspace.sandboxType ?? null,
  };
}

function resolveDefaultWorkspace(
  workspaceOptions: SupportReportWorkspaceOption[],
  selectedWorkspaceId: string | null,
): SupportReportWorkspaceOption | null {
  if (selectedWorkspaceId) {
    const selected = workspaceOptions.find((workspace) => workspace.id === selectedWorkspaceId);
    if (selected) {
      return selected;
    }
  }
  return workspaceOptions[0] ?? null;
}

function compareWorkspaceOptionsByUpdatedAtDesc(
  a: SupportReportWorkspaceOption,
  b: SupportReportWorkspaceOption,
): number {
  return dateMs(b.updatedAt) - dateMs(a.updatedAt);
}

function dateMs(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function buildSupportReportContext({
  source,
  pathname,
  workspaceOptions,
  selectedWorkspaceId,
}: {
  source: SupportMessageContext["source"];
  pathname: string;
  workspaceOptions: SupportReportWorkspaceOption[];
  selectedWorkspaceId: string | null;
}): SupportMessageContext {
  const workspace = selectedWorkspaceId
    ? workspaceOptions.find((candidate) => candidate.id === selectedWorkspaceId)
    : null;
  return {
    source,
    intent: "general",
    pathname,
    workspaceId: workspace?.id,
    workspaceName: workspace?.label,
    workspaceLocation: workspace
      ? isCloudWorkspaceId(workspace.id) ? "cloud" : workspace.location
      : undefined,
  };
}
