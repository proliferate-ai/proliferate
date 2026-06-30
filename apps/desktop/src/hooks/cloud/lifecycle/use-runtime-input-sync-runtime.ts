import { useCallback, useEffect, useRef, useState } from "react";
import {
  createRuntimeInputSyncQueueState,
  dequeueRuntimeInputSyncDescriptor,
  enqueueRuntimeInputSyncDescriptors,
  runtimeInputSyncDescriptorTrackedFileSourceKind,
  runtimeInputSyncDescriptorSourceKind,
  type RuntimeInputSyncDescriptor,
  type RuntimeInputSyncFailureKind,
  type RuntimeInputSyncQueueState,
  type RuntimeInputSyncTrigger,
} from "@/lib/domain/cloud/runtime-input-sync";
import { useTauriCredentialsActions } from "@/hooks/access/tauri/use-credentials-actions";
import { trackProductEvent } from "@/lib/integrations/telemetry/client";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { useAgentAuthCache } from "@/hooks/access/cloud/use-agent-auth-cache";
import { useWorkspaceCollectionsInvalidation } from "@/hooks/workspaces/cache/use-workspace-collections-invalidation";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { syncLocalAgentAuthCredentialToCloud } from "@/lib/access/cloud/agent-auth-sync";
import { subscribeRuntimeInputSyncEvents } from "./runtime-input-sync-events";

const HOURLY_RETRY_MS = 3_600_000;

interface RuntimeInputSyncCycleCounts {
  credential: number;
  repo_tracked_file: number;
  failures: number;
}

function emptyCounts(): RuntimeInputSyncCycleCounts {
  return {
    credential: 0,
    repo_tracked_file: 0,
    failures: 0,
  };
}

function hasRuntimeInputSyncCounts(counts: RuntimeInputSyncCycleCounts): boolean {
  return counts.credential > 0
    || counts.repo_tracked_file > 0
    || counts.failures > 0;
}

function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
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
  const { listSyncableAgentAuthCredentials } = useTauriCredentialsActions();
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const preferencesHydrated = useUserPreferencesStore((state) => state._hydrated);
  const cloudRuntimeInputSyncEnabled = useUserPreferencesStore(
    (state) => state.cloudRuntimeInputSyncEnabled,
  );
  const { cloudActive } = useCloudAvailabilityState();
  const [online, setOnline] = useState(isOnline);
  const queueRef = useRef<RuntimeInputSyncQueueState>(createRuntimeInputSyncQueueState());
  const inFlightRef = useRef(false);
  const keepFreshActiveRef = useRef(false);
  const previousOnlineRef = useRef(online);
  const { invalidateAgentAuth } = useAgentAuthCache();
  const invalidateWorkspaceCollections = useWorkspaceCollectionsInvalidation(runtimeUrl);

  const keepFreshActive =
    preferencesHydrated && cloudRuntimeInputSyncEnabled && cloudActive && online;

  useEffect(() => {
    keepFreshActiveRef.current = keepFreshActive;
  }, [keepFreshActive]);

  const enqueue = useCallback((descriptors: RuntimeInputSyncDescriptor[]) => {
    queueRef.current = enqueueRuntimeInputSyncDescriptors(queueRef.current, descriptors);
  }, []);

  const processDescriptor = useCallback(async (
    descriptor: RuntimeInputSyncDescriptor,
  ) => {
    switch (descriptor.kind) {
      case "credential": {
        const { provider } = descriptor;
        // Cred-sync only covers tauri-keychain providers (AgentAuthProvider:
        // claude/codex/gemini). grok and other kinds aren't syncable here.
        if (provider === "claude" || provider === "codex" || provider === "gemini") {
          await syncLocalAgentAuthCredentialToCloud(provider);
          await Promise.all([
            invalidateAgentAuth(),
            invalidateWorkspaceCollections(),
          ]);
        }
        return;
      }
      case "repo_tracked_file":
        return;
    }
  }, [invalidateAgentAuth, invalidateWorkspaceCollections]);

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
            ...(descriptor.kind === "repo_tracked_file"
              ? { tracked_file_source: runtimeInputSyncDescriptorTrackedFileSourceKind(descriptor) }
              : {}),
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
          repo_file_count: counts.repo_tracked_file,
          failure_count: counts.failures,
        });
      }
    }
  }, [processDescriptor]);

  const enqueueKeepFreshDescriptors = useCallback(async () => {
    const descriptors: RuntimeInputSyncDescriptor[] = [];
    const localSources = await listSyncableAgentAuthCredentials().catch(() => []);
    for (const source of localSources) {
      if (source.detected) {
        descriptors.push({ kind: "credential", provider: source.provider });
      }
    }

    enqueue(descriptors);
  }, [enqueue, listSyncableAgentAuthCredentials]);

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
