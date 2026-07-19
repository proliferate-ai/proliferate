import type { AgentInstallProgressComponent } from "@anyharness/sdk";
import type { AgentAuthSurface } from "@proliferate/cloud-sdk";
import { SettingsEmptyState } from "@proliferate/product-ui/settings/SettingsEmptyState";
import { Button } from "@proliferate/ui/primitives/Button";
import { ProviderIcon } from "@proliferate/ui/provider-icons";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";
import type { HarnessInstallAction } from "#product/hooks/agents/workflows/use-harness-install-action";
import { HarnessUpdateProgress } from "#product/components/settings/panes/agents/harness/HarnessUpdateProgress";

export function HarnessInstallGate({
  harnessKind,
  displayName,
  surface,
  installAction,
  progressComponents,
}: {
  harnessKind: string;
  displayName: string;
  surface: AgentAuthSurface;
  installAction: HarnessInstallAction | null;
  progressComponents: AgentInstallProgressComponent[];
}) {
  const installing = progressComponents.length > 0;
  const targetLabel = surface === "local" ? "This machine" : "Proliferate Cloud";

  return (
    <SettingsEmptyState
      icon={<ProviderIcon kind={harnessKind} aria-hidden="true" />}
      title={installing
        ? HARNESS_PANE_COPY.installingGateTitle(displayName)
        : HARNESS_PANE_COPY.installGateTitle(displayName)}
      description={installing
        ? HARNESS_PANE_COPY.installingGateDescription(surface)
        : HARNESS_PANE_COPY.installGateDescription(surface, displayName)}
      action={installing ? (
        <HarnessUpdateProgress
          components={progressComponents}
          displayName={displayName}
          targetLabel={targetLabel}
          variant="gate"
        />
      ) : installAction ? (
        <Button
          type="button"
          variant="secondary"
          loading={installAction.loading}
          disabled={installAction.disabled}
          onClick={installAction.onInstall}
        >
          {installAction.label}
        </Button>
      ) : null}
      className="min-h-[340px]"
    />
  );
}
