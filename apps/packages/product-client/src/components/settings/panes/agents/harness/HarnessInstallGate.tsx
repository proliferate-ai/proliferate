import type { AgentAuthSurface } from "@proliferate/cloud-sdk";
import { SettingsEmptyState } from "@proliferate/product-ui/settings/SettingsEmptyState";
import { Button } from "@proliferate/ui/primitives/Button";
import { ProviderIcon } from "@proliferate/ui/provider-icons";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";
import type { HarnessInstallAction } from "#product/hooks/agents/workflows/use-harness-install-action";

export function HarnessInstallGate({
  harnessKind,
  displayName,
  surface,
  installAction,
  installing,
}: {
  harnessKind: string;
  displayName: string;
  surface: AgentAuthSurface;
  installAction: HarnessInstallAction | null;
  installing: boolean;
}) {
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
        <Button type="button" variant="secondary" loading disabled>
          {installAction?.label ?? HARNESS_PANE_COPY.installingAction(displayName)}
        </Button>
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
      className="min-h-80"
    />
  );
}
