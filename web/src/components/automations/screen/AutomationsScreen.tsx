import { useAutomations } from "@proliferate/cloud-sdk-react";

import { AutomationsList } from "@proliferate/product-ui/automations/AutomationsList";
import { ProductPageShell } from "@proliferate/product-ui/layout/ProductPageShell";

export function AutomationsScreen() {
  const automations = useAutomations();

  return (
    <ProductPageShell
      title="Automations"
      description="Scheduled cloud work. More automation kinds run on Desktop."
      telemetryBlocked
    >
      <AutomationsList
        loading={automations.isLoading}
        error={Boolean(automations.error)}
        items={(automations.data?.automations ?? []).map((automation) => ({
          id: automation.id,
          title: automation.title,
          repo: `${automation.gitOwner}/${automation.gitRepoName}`,
          schedule: automation.schedule.summary,
          target: automation.targetMode,
          lastRun: automation.lastScheduledAt,
          enabled: automation.enabled,
        }))}
      />
    </ProductPageShell>
  );
}
