import { useEffect, useRef } from "react";
import { useRuntimeHealthQuery } from "@anyharness/sdk-react";
import { useProductTelemetry } from "@/hooks/telemetry/facade/use-product-telemetry";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";

// Owns agent seed hydration telemetry emitted from runtime health changes.
// Reports through the typed telemetry adapter. Does not own runtime health
// fetching or agent setup behavior.
export function useTelemetryAgentSeed() {
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const connectionState = useHarnessConnectionStore((state) => state.connectionState);
  const isHealthy = connectionState === "healthy" && runtimeUrl.trim().length > 0;
  const { data: runtimeHealth } = useRuntimeHealthQuery({ enabled: isHealthy });
  const telemetry = useProductTelemetry();
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
      telemetry.track("agent_seed_hydrated", {
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
      telemetry.track("agent_seed_hydration_failed", {
        status: agentSeed.status,
        source: agentSeed.source,
        failure_kind: agentSeed.failureKind ?? "unknown",
      });
    }
  }, [agentSeed, telemetry]);
}
