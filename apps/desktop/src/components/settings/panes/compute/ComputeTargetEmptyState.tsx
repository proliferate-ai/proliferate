import { Server } from "@proliferate/ui/icons";
import { SettingsEmptyState } from "@proliferate/product-ui/settings/SettingsEmptyState";
import { COMPUTE_COPY } from "@/copy/settings/compute";

export function ComputeTargetEmptyState() {
  return (
    <SettingsEmptyState
      icon={<Server aria-hidden="true" />}
      title={COMPUTE_COPY.selectTargetTitle}
      description={COMPUTE_COPY.selectTargetDescription}
    />
  );
}
