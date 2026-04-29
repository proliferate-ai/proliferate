import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  createRuntimeInputSyncQueueState,
  dequeueRuntimeInputSyncDescriptor,
  enqueueRuntimeInputSyncDescriptors,
  MAX_RUNTIME_INPUT_SYNC_TRACKED_FILE_BYTES,
  runtimeInputSyncDescriptorSourceKind,
  type RuntimeInputSyncDescriptor,
  type RuntimeInputSyncFailureKind,
  type RuntimeInputSyncQueueState,
  type RuntimeInputSyncTrigger,
} from "@/lib/domain/cloud/runtime-input-sync";
import { readWorkspaceTextFile } from "@/lib/integrations/anyharness/files";
import { resyncCloudRepoFileFromLocal } from "@/lib/integrations/cloud/repo-configs";
import { getCloudRepoConfig } from "@/lib/integrations/cloud/repo-configs";
import { listSyncableCloudCredentials } from "@/platform/tauri/credentials";
import { trackProductEvent } from "@/lib/integrations/telemetry/client";
import { useCloudAvailabilityState } from "@/hooks/cloud/use-cloud-availability-state";
import { useConnectorSyncRetry } from "@/hooks/mcp/use-connector-sync-retry";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { workspaceCollectionsScopeKey } from "@/hooks/workspaces/query-keys";
import {
  cloudCredentialsKey,
  cloudRepoConfigKey,
  cloudRepoConfigsKey,
  isCloudWorkspaceRepoConfigStatusQueryKey,
} from "./query-keys";
import { syncLocalCloudCredentialToCloud } from "./cloud-credential-sync";
import { subscribeRuntimeInputSyncEvents } from "./runtime-input-sync-events";

const HOURLY_RETRY_MS = 3_600_000;

interface RuntimeInputSyncCycleCounts {
  credential: number;
  mcp_api_key_replica: number;
  repo_tracked_file: number;
  failures: number;
}

function emptyCounts(): RuntimeInputSyncCycleCounts {
  return {
    credential: 0,
    mcp_api_key_replica: 0,
    repo_tracked_file: 0,
    failures: 0,
  };
}

function hasRuntimeInputSyncCounts(counts: RuntimeInputSyncCycleCounts): boolean {
  return counts.credential > 0
    || counts.mcp_api_key_replica > 0
    || counts.repo_tracked_file > 0
    || counts.failures > 0;
}

function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

async function sha256Text(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function contentByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function classifyRuntimeInputSyncFailure(error: unknown): RuntimeInputSyncFailureKind {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes("reconnect")) {
      return "needs_reconnect";
    }
    if (message.includes("too large") || message.includes("1 mib")) {
      return "too_large";
    }
    if (message.includes("runtime") || message.includes("workspace")) {
      return "runtime_unavailable";
    }
    if (message.includes("not found") || message.includes("missing")) {
      return "missing_local_source";
    }
  }
  return "request_failed";
}

export function useRuntimeInputSyncRuntime() {
  const queryClient = useQueryClient();
  const runtimeUrl = useHarnessStore((state) => state.runtimeUrl);
  const preferencesHydrated = useUserPreferencesStore((state) => state._hydrated);
  const cloudRuntimeInputSyncEnabled = useUserPreferencesStore(
    (state) => state.cloudRuntimeInputSyncEnabled,
  );
  const { cloudActive } = useCloudAvailabilityState();
  const { retryPendingConnectorSync } = useConnectorSyncRetry();
  const [online, setOnline] = useState(isOnline);
  const queueRef = useRef<RuntimeInputSyncQueueState>(createRuntimeInputSyncQueueState());
  const inFlightRef = useRef(false);
  const runtimeUrlRef = useRef(runtimeUrl);
  const queryClientRef = useRef(queryClient);
  const retryPendingConnectorSyncRef = useRef(retryPendingConnectorSync.mutateAsync);
  const keepFreshActiveRef = useRef(false);
  const previousOnlineRef = useRef(online);

  useEffect(() => {
    runtimeUrlRef.current = runtimeUrl;
  }, [runtimeUrl]);

  useEffect(() => {
    queryClientRef.current = queryClient;
  }, [queryClient]);

  useEffect(() => {
    retryPendingConnectorSyncRef.current = retryPendingConnectorSync.mutateAsync;
  }, [retryPendingConnectorSync.mutateAsync]);

  const keepFreshActive =
    preferencesHydrated && cloudRuntimeInputSyncEnabled && cloudActive && online;

  useEffect(() => {
    keepFreshActiveRef.current = keepFreshActive;
  }, [keepFreshActive]);

  const enqueue = useCallback((descriptors: RuntimeInputSyncDescriptor[]) => {
    queueRef.current = enqueueRuntimeInputSyncDescriptors(queueRef.current, descriptors);
  }, []);

  const syncRepoFile = useCallback(async (
    descriptor: Extract<RuntimeInputSyncDescriptor, { kind: "repo_tracked_file" }>,
  ) => {
    const runtimeUrl = runtimeUrlRef.current.trim();
    if (!runtimeUrl) {
      throw new Error("Local runtime is unavailable.");
    }
    const config = await getCloudRepoConfig(descriptor.gitOwner, descriptor.gitRepoName);
    const metadata = config.trackedFiles.find(
      (file) => file.relativePath === descriptor.relativePath,
    );
    if (!config.configured || !metadata) {
      return;
    }

    const content = await readWorkspaceTextFile(
      runtimeUrl,
      descriptor.localWorkspaceId,
      descriptor.relativePath,
    );
    if (contentByteLength(content) > MAX_RUNTIME_INPUT_SYNC_TRACKED_FILE_BYTES) {
      throw new Error("Tracked file is too large.");
    }
    if (await sha256Text(content) === metadata.contentSha256) {
      return;
    }

    const response = await resyncCloudRepoFileFromLocal(
      descriptor.gitOwner,
      descriptor.gitRepoName,
      {
        relativePath: descriptor.relativePath,
        content,
      },
    );
    await Promise.all([
      queryClientRef.current.invalidateQueries({ queryKey: cloudRepoConfigsKey() }),
      queryClientRef.current.invalidateQueries({
        queryKey: cloudRepoConfigKey(descriptor.gitOwner, descriptor.gitRepoName),
      }),
      queryClientRef.current.invalidateQueries({
        predicate: (query) => isCloudWorkspaceRepoConfigStatusQueryKey(query.queryKey),
      }),
    ]);
    trackProductEvent("cloud_repo_file_resynced", {
      tracked_file_count: response.trackedFiles.length,
    });
  }, []);

  const processDescriptor = useCallback(async (
    descriptor: RuntimeInputSyncDescriptor,
  ) => {
    switch (descriptor.kind) {
      case "credential":
        await syncLocalCloudCredentialToCloud(descriptor.provider);
        await Promise.all([
          queryClientRef.current.invalidateQueries({ queryKey: cloudCredentialsKey() }),
          queryClientRef.current.invalidateQueries({
            queryKey: workspaceCollectionsScopeKey(runtimeUrlRef.current),
          }),
        ]);
        return;
      case "mcp_api_key_replica":
        await retryPendingConnectorSyncRef.current({ silent: true });
        return;
      case "repo_tracked_file":
        await syncRepoFile(descriptor);
        return;
    }
  }, [syncRepoFile]);

  const runQueuedDescriptors = useCallback(async (trigger: RuntimeInputSyncTrigger) => {
    if (
      inFlightRef.current
      || !keepFreshActiveRef.current
      || queueRef.current.items.length === 0
    ) {
      return;
    }
    inFlightRef.current = true;
    const counts = emptyCounts();

    try {
      while (queueRef.current.items.length > 0) {
        const next = dequeueRuntimeInputSyncDescriptor(queueRef.current);
        queueRef.current = next.state;
        const descriptor = next.descriptor;
        if (!descriptor) {
          break;
        }

        counts[descriptor.kind] += 1;
        try {
          await processDescriptor(descriptor);
        } catch (error) {
          counts.failures += 1;
          trackProductEvent("runtime_input_sync_item_failed", {
            source_kind: runtimeInputSyncDescriptorSourceKind(descriptor),
            failure_kind: classifyRuntimeInputSyncFailure(error),
          });
        }
      }
    } finally {
      inFlightRef.current = false;
      if (hasRuntimeInputSyncCounts(counts)) {
        trackProductEvent("runtime_input_sync_cycle_completed", {
          trigger,
          credential_count: counts.credential,
          mcp_count: counts.mcp_api_key_replica,
          repo_file_count: counts.repo_tracked_file,
          failure_count: counts.failures,
        });
      }
    }
  }, [processDescriptor]);

  const enqueueKeepFreshDescriptors = useCallback(async () => {
    const descriptors: RuntimeInputSyncDescriptor[] = [];
    const localSources = await listSyncableCloudCredentials().catch(() => []);
    for (const source of localSources) {
      if (source.detected) {
        descriptors.push({ kind: "credential", provider: source.provider });
      }
    }
    descriptors.push({ kind: "mcp_api_key_replica" });

    enqueue(descriptors);
  }, [enqueue]);

  const runKeepFreshCycle = useCallback(async (trigger: RuntimeInputSyncTrigger) => {
    if (!keepFreshActiveRef.current) {
      return;
    }
    await enqueueKeepFreshDescriptors();
    await runQueuedDescriptors(trigger);
  }, [enqueueKeepFreshDescriptors, runQueuedDescriptors]);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeRuntimeInputSyncEvents((event) => {
      enqueue(event.descriptors);
      void runQueuedDescriptors(event.trigger);
    });
    return unsubscribe;
  }, [enqueue, runQueuedDescriptors]);

  useEffect(() => {
    if (cloudActive && online) {
      return;
    }
    queueRef.current = createRuntimeInputSyncQueueState();
  }, [cloudActive, online]);

  useEffect(() => {
    queueRef.current = createRuntimeInputSyncQueueState();
    return () => {
      queueRef.current = createRuntimeInputSyncQueueState();
    };
  }, []);

  useEffect(() => {
    if (!keepFreshActive) {
      return;
    }
    void runKeepFreshCycle("startup");
    const intervalId = window.setInterval(() => {
      void runKeepFreshCycle("hourly");
    }, HOURLY_RETRY_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [keepFreshActive, runKeepFreshCycle]);

  useEffect(() => {
    if (!online) {
      previousOnlineRef.current = online;
      return;
    }
    if (previousOnlineRef.current === online) {
      return;
    }
    previousOnlineRef.current = online;
    if (keepFreshActive) {
      void runKeepFreshCycle("online");
    }
  }, [keepFreshActive, online, runKeepFreshCycle]);
}
