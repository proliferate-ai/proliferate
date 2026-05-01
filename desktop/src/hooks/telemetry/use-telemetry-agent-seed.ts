import { useEffect, useRef } from "react";
import { useRuntimeHealthQuery } from "@anyharness/sdk-react";
import { trackProductEvent } from "@/lib/integrations/telemetry/client";
import { useHarnessStore } from "@/stores/sessions/harness-store";

export function useTelemetryAgentSeed() {
  const runtimeUrl = useHarnessStore((state) => state.runtimeUrl);
  const connectionState = useHarnessStore((state) => state.connectionState);
  const isHealthy = connectionState === "healthy" && runtimeUrl.trim().length > 0;
  const { data: runtimeHealth } = useRuntimeHealthQuery({ enabled: isHealthy });
  const reportedStatusRef = useRef<string | null>(null);
  const agentSeed = runtimeHealth?.agentSeed;

  useEffect(() => {
    if (!agentSeed) {
      return;
    }

    const statusKey = `${agentSeed.status}:${agentSeed.seedVersion ?? ""}:${agentSeed.failureKind ?? ""}`;
    if (reportedStatusRef.current === statusKey) {
      return;
    }

    const hasSeedContent = agentSeed.seedOwnedArtifactCount > 0;
    if (
      agentSeed.status === "ready"
      || (agentSeed.status === "partial" && hasSeedContent)
    ) {
      reportedStatusRef.current = statusKey;
      trackProductEvent("agent_seed_hydrated", {
        status: agentSeed.status,
        source: agentSeed.source,
        ownership: agentSeed.ownership,
        last_action: agentSeed.lastAction,
        seeded_agent_count: agentSeed.seededAgents.length,
        seed_owned_artifact_count: agentSeed.seedOwnedArtifactCount,
        skipped_existing_artifact_count: agentSeed.skippedExistingArtifactCount,
        repaired_artifact_count: agentSeed.repairedArtifactCount,
      });
      return;
    }

    if (agentSeed.status === "failed" || agentSeed.status === "missing_bundled_seed") {
      reportedStatusRef.current = statusKey;
      trackProductEvent("agent_seed_hydration_failed", {
        status: agentSeed.status,
        source: agentSeed.source,
        failure_kind: agentSeed.failureKind ?? "unknown",
      });
    }
  }, [agentSeed]);
}
