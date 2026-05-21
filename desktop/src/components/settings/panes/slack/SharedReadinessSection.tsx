import { Button } from "@proliferate/ui/primitives/Button";
import { Badge } from "@/components/ui/Badge";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsCardRow } from "@/components/settings/shared/SettingsCardRow";

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
    <section className="space-y-2">
      <div className="space-y-0.5">
        <h2 className="text-sm font-medium text-foreground">Shared readiness</h2>
        <p className="text-sm text-muted-foreground">
          Slack-created work uses the organization shared cloud runtime.
        </p>
      </div>
      <SettingsCard>
        <SettingsCardRow
          label="Compute targets"
          description={loadingTargets
            ? "Checking shared cloud target inventory..."
            : targetCount > 0
              ? "Open Compute to review runtime, auth, and sandbox readiness."
              : "Set up shared cloud compute before enabling Slack for the team."}
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
        </SettingsCardRow>
      </SettingsCard>
    </section>
  );
}
