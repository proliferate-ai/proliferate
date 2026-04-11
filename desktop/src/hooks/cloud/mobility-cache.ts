import type { QueryClient } from "@tanstack/react-query";
import type {
  CloudMobilityHandoffSummary,
  CloudMobilityWorkspaceDetail,
  CloudMobilityWorkspaceSummary,
} from "@/lib/integrations/cloud/client";
import { cloudMobilityWorkspaceKey, cloudMobilityWorkspacesKey } from "./query-keys";

export function applyCloudMobilityWorkspaceDetail(
  queryClient: QueryClient,
  detail: CloudMobilityWorkspaceDetail,
) {
  queryClient.setQueryData(cloudMobilityWorkspaceKey(detail.id), detail);
  queryClient.setQueryData<CloudMobilityWorkspaceSummary[] | undefined>(
    cloudMobilityWorkspacesKey(),
    (current) => {
      if (!current) {
        return current;
      }
      const nextSummary = detailToSummary(detail);
      const existingIndex = current.findIndex((workspace) => workspace.id === detail.id);
      if (existingIndex === -1) {
        return [nextSummary, ...current];
      }
      const next = current.slice();
      next[existingIndex] = nextSummary;
      return next;
    },
  );
}

export function applyCloudMobilityHandoffSummary(
  queryClient: QueryClient,
  mobilityWorkspaceId: string,
  handoff: CloudMobilityHandoffSummary,
) {
  queryClient.setQueryData<CloudMobilityWorkspaceDetail | undefined>(
    cloudMobilityWorkspaceKey(mobilityWorkspaceId),
    (current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        activeHandoff: handoff,
      };
    },
  );
  queryClient.setQueryData<CloudMobilityWorkspaceSummary[] | undefined>(
    cloudMobilityWorkspacesKey(),
    (current) => {
      if (!current) {
        return current;
      }
      return current.map((workspace) => (
        workspace.id === mobilityWorkspaceId
          ? { ...workspace, activeHandoff: handoff }
          : workspace
      ));
    },
  );
}

function detailToSummary(detail: CloudMobilityWorkspaceDetail): CloudMobilityWorkspaceSummary {
  return {
    id: detail.id,
    displayName: detail.displayName,
    repo: detail.repo,
    owner: detail.owner,
    lifecycleState: detail.lifecycleState,
    statusDetail: detail.statusDetail,
    lastError: detail.lastError,
    cloudWorkspaceId: detail.cloudWorkspaceId,
    cloudLostAt: detail.cloudLostAt,
    cloudLostReason: detail.cloudLostReason,
    activeHandoff: detail.activeHandoff,
    updatedAt: detail.updatedAt,
    createdAt: detail.createdAt,
  };
}
