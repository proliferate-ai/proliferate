import { Badge } from "@proliferate/ui/primitives/Badge";
import { SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { computeTargetReadiness } from "@/lib/domain/compute/target-readiness";
import type {
  ComputeRuntimeConfigStatus,
  ComputeSandboxProfileTargetState,
  ComputeTargetSummary,
} from "@/lib/domain/compute/target-types";

interface ComputeTargetReadinessProps {
  target: ComputeTargetSummary;
  sandboxProfileTargetState?: ComputeSandboxProfileTargetState | null;
  runtimeConfigStatus?: ComputeRuntimeConfigStatus | null;
  loadingTargetState?: boolean;
  loadingRuntimeConfig?: boolean;
}

const READINESS_TONE: Record<
  ReturnType<typeof computeTargetReadiness>[number]["status"],
  "success" | "warning" | "neutral" | "destructive"
> = {
  ready: "success",
  pending: "warning",
  missing: "warning",
  unavailable: "neutral",
};

export function ComputeTargetReadiness({
  target,
  sandboxProfileTargetState = null,
  runtimeConfigStatus = null,
  loadingTargetState = false,
  loadingRuntimeConfig = false,
}: ComputeTargetReadinessProps) {
  const items = computeTargetReadiness(target, {
    sandboxProfileTargetState,
    runtimeConfigStatus,
    loadingTargetState,
    loadingRuntimeConfig,
  });
  return (
    <SettingsSection title="Readiness" description="Tooling and target state required for cloud work.">
      {items.map((item) => (
        <SettingsRow key={item.key} label={item.label} description={item.detail}>
          <Badge tone={READINESS_TONE[item.status]}>{readinessLabel(item)}</Badge>
        </SettingsRow>
      ))}
    </SettingsSection>
  );
}

function readinessLabel(item: ReturnType<typeof computeTargetReadiness>[number]): string {
  if (item.status === "ready") {
    return item.key === "git" || item.key === "node" || item.key === "python"
      ? "Installed"
      : "Ready";
  }
  if (item.status === "pending") {
    return "Pending";
  }
  if (item.status === "missing") {
    return "Missing";
  }
  return "Unavailable";
}
