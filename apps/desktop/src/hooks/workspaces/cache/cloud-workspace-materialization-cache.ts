import {
  anyHarnessAgentLaunchOptionsKey,
  anyHarnessWorkspaceKey,
} from "@anyharness/sdk-react";
import type { QueryClient } from "@tanstack/react-query";
import type { CloudConnectionInfo } from "@/lib/access/cloud/client";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";

export interface CloudWorkspaceMaterializationIdentity {
  anyharnessWorkspaceId: string;
  runtimeGeneration: number;
}

function normalizeWorkspaceId(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

/**
 * Excludes short-lived gateway credentials so a token refresh retains the
 * workspace cache, while a replacement runtime/workspace clears it.
 */
export function cloudWorkspaceMaterializationIdentity(
  connection: CloudConnectionInfo,
): CloudWorkspaceMaterializationIdentity | null {
  const anyharnessWorkspaceId = normalizeWorkspaceId(connection.anyharnessWorkspaceId);
  if (!anyharnessWorkspaceId) {
    return null;
  }

  return {
    anyharnessWorkspaceId,
    runtimeGeneration: connection.runtimeGeneration ?? 0,
  };
}

export function sameCloudWorkspaceMaterialization(
  left: CloudWorkspaceMaterializationIdentity,
  right: CloudWorkspaceMaterializationIdentity,
): boolean {
  return left.anyharnessWorkspaceId === right.anyharnessWorkspaceId
    && left.runtimeGeneration === right.runtimeGeneration;
}

export interface CloudWorkspaceMaterializationCacheTracker {
  observe(input: {
    cloudWorkspaceId: string;
    connection: CloudConnectionInfo;
  }): Promise<void>;
}

interface CloudWorkspaceMaterializationObservation {
  identity: CloudWorkspaceMaterializationIdentity;
  runtimeUrl: string;
}

interface MaterializationCacheQueryFilters {
  queryKey: readonly unknown[];
  exact: boolean;
}

async function clearMaterializationQueries(
  queryClient: QueryClient,
  filters: MaterializationCacheQueryFilters[],
): Promise<void> {
  await Promise.all(filters.map((queryFilters) => queryClient.cancelQueries(queryFilters)));

  for (const queryFilters of filters) {
    queryClient.removeQueries({
      ...queryFilters,
      type: "inactive",
    });
  }

  await Promise.all(filters.map((queryFilters) => queryClient.resetQueries({
    ...queryFilters,
    type: "active",
  })));
}

async function clearMaterializationTransitionCaches(input: {
  queryClient: QueryClient;
  cacheScopeKey: string;
  cloudWorkspaceId: string;
  previous: CloudWorkspaceMaterializationObservation;
  next: CloudWorkspaceMaterializationObservation;
}): Promise<void> {
  const workspaceFilters = {
    queryKey: anyHarnessWorkspaceKey(
      input.cacheScopeKey,
      cloudWorkspaceSyntheticId(input.cloudWorkspaceId),
    ),
    exact: false as const,
  };
  const launchOptionObservations = (
    input.previous.runtimeUrl === input.next.runtimeUrl
    && input.previous.identity.anyharnessWorkspaceId
      === input.next.identity.anyharnessWorkspaceId
  )
    ? [input.previous]
    : [input.previous, input.next];
  const launchOptionFilters = launchOptionObservations.map((observation) => ({
    queryKey: anyHarnessAgentLaunchOptionsKey(
      observation.runtimeUrl,
      observation.identity.anyharnessWorkspaceId,
      input.cacheScopeKey,
    ),
    exact: true as const,
  }));

  await clearMaterializationQueries(input.queryClient, [
    workspaceFilters,
    ...launchOptionFilters,
  ]);
}

/**
 * Owns the transition from a stable Cloud workspace identity to the current
 * AnyHarness materialization. The initial observation establishes a baseline;
 * later runtime/workspace replacements discard every descendant workspace key.
 */
export function createCloudWorkspaceMaterializationCacheTracker(input: {
  queryClient: QueryClient;
  cacheScopeKey: string;
}): CloudWorkspaceMaterializationCacheTracker {
  const observations = new Map<string, CloudWorkspaceMaterializationObservation>();

  return {
    async observe({ cloudWorkspaceId, connection }) {
      const identity = cloudWorkspaceMaterializationIdentity(connection);
      if (!identity) {
        return;
      }

      const next = {
        identity,
        runtimeUrl: connection.runtimeUrl.trim(),
      };
      const previous = observations.get(cloudWorkspaceId);
      observations.set(cloudWorkspaceId, next);
      if (!previous || sameCloudWorkspaceMaterialization(previous.identity, identity)) {
        return;
      }

      await clearMaterializationTransitionCaches({
        queryClient: input.queryClient,
        cacheScopeKey: input.cacheScopeKey,
        cloudWorkspaceId,
        previous,
        next,
      });
    },
  };
}
