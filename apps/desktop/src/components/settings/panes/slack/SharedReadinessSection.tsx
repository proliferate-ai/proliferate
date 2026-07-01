import { Button } from "@proliferate/ui/primitives/Button";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { SettingsSection } from "@/components/settings/shared/SettingsSection";
import { SettingsRow } from "@/components/settings/shared/SettingsRow";

interface SharedReadinessSectionProps {
  loadingTargets: boolean;
  targetCount: number;
  onOpenCompute: () => void;
}

export function SharedReadinessSection({
  loadingTargets,
  targetCount,
  onOpenCompute,
}: SharedReadinessSectionProps) {
  return (
    <SettingsSection
      title="Organization readiness"
      description="Slack-created work uses organization cloud runtime."
    >
        <SettingsRow
          label="Compute targets"
          description={loadingTargets
            ? "Checking organization cloud target inventory..."
            : targetCount > 0
              ? "Open Compute to review runtime, auth, and sandbox readiness."
              : "Set up organization cloud compute before enabling Slack for the team."}
        >
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge tone={targetCount > 0 ? "success" : "warning"}>
              {loadingTargets
                ? "Checking"
                : targetCount > 0
                  ? `${targetCount.toLocaleString()} target${targetCount === 1 ? "" : "s"}`
                  : "Setup needed"}
            </Badge>
            <Button type="button" variant="outline" onClick={onOpenCompute}>
              Open Compute
            </Button>
          </div>
        </SettingsRow>
    </SettingsSection>
  );
}
