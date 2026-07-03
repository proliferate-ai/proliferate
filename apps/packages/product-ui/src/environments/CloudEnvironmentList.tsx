import { Cloud, Folder, Plus } from "lucide-react";

import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { SettingsEmptyState } from "../settings/SettingsEmptyState";
import { SettingsPageHeader } from "../settings/SettingsPageHeader";
import { SettingsRow } from "../settings/SettingsRow";
import { SettingsSection } from "../settings/SettingsSection";

export interface CloudEnvironmentListItemView {
  id: string;
  fullName: string;
  description: string;
  cloudStatus?: "pending" | "running" | "ready" | "error" | null;
}

export interface CloudEnvironmentListProps {
  title?: string;
  description?: string;
  cloudEnvironments: readonly CloudEnvironmentListItemView[];
  loadingCloudEnvironments?: boolean;
  cloudUnavailableReason?: string | null;
  cloudErrorMessage?: string | null;
  onSelectCloudEnvironment: (id: string) => void;
  onAddCloudEnvironment?: () => void;
  onRetryCloudEnvironments?: () => void;
}

export function CloudEnvironmentList({
  title = "Environments",
  description = "GitHub repositories that run in Proliferate Cloud.",
  cloudEnvironments,
  loadingCloudEnvironments = false,
  cloudUnavailableReason = null,
  cloudErrorMessage = null,
  onSelectCloudEnvironment,
  onAddCloudEnvironment,
  onRetryCloudEnvironments,
}: CloudEnvironmentListProps) {
  const hasItems = cloudEnvironments.length > 0;
  const unavailableRow = cloudUnavailableReason ? (
    <SettingsRow
      label="Cloud environments unavailable"
      description={cloudUnavailableReason}
    />
  ) : null;
  const errorRow = !cloudUnavailableReason && cloudErrorMessage ? (
    <SettingsRow
      label="Couldn't load cloud environments"
      description={cloudErrorMessage}
    >
      {onRetryCloudEnvironments ? (
        <Button type="button" variant="secondary" size="sm" onClick={onRetryCloudEnvironments}>
          Retry
        </Button>
      ) : null}
    </SettingsRow>
  ) : null;

  return (
    <section className="space-y-6">
      <SettingsPageHeader title={title} description={description} />

      <SettingsSection
        title="Repositories"
        description="GitHub repositories configured for Proliferate Cloud."
      >
        {hasItems ? (
          <>
            {cloudEnvironments.map((environment) => (
              <EnvironmentRow
                key={environment.id}
                environment={environment}
                onSelectCloudEnvironment={onSelectCloudEnvironment}
              />
            ))}
            {unavailableRow}
            {errorRow}
            {loadingCloudEnvironments ? (
              <SettingsRow label="Cloud environments" description="Loading…" />
            ) : null}
            {onAddCloudEnvironment && !cloudUnavailableReason ? (
              <Button
                type="button"
                variant="unstyled"
                size="unstyled"
                onClick={onAddCloudEnvironment}
                className="mt-1 flex w-full items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-2 text-ui-sm font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
              >
                <Plus className="size-4" />
                Add cloud environment
              </Button>
            ) : null}
          </>
        ) : unavailableRow ? (
          unavailableRow
        ) : errorRow ? (
          errorRow
        ) : loadingCloudEnvironments ? (
          <SettingsEmptyState size="compact" title="Loading environments…" />
        ) : (
          <SettingsEmptyState
            size="full"
            icon={<Folder />}
            title="No environments yet"
            description="Add a GitHub repo to run it in Proliferate Cloud."
            action={onAddCloudEnvironment ? (
              <Button type="button" variant="secondary" onClick={onAddCloudEnvironment}>
                <Plus size={14} />
                Add cloud environment
              </Button>
            ) : undefined}
          />
        )}
      </SettingsSection>
    </section>
  );
}

function EnvironmentRow({
  environment,
  onSelectCloudEnvironment,
}: {
  environment: CloudEnvironmentListItemView;
  onSelectCloudEnvironment: (id: string) => void;
}) {
  return (
    <SettingsRow
      label={(
        <span className="flex min-w-0 items-center gap-2">
          <Cloud size={14} className="shrink-0 text-muted-foreground" />
          <span className="truncate">{environment.fullName}</span>
        </span>
      )}
      description={environment.description}
    >
      <Badge tone="neutral">Cloud</Badge>
      {environment.cloudStatus === "error" ? (
        <Badge tone="destructive">Setup failed</Badge>
      ) : null}
      {environment.cloudStatus === "pending" || environment.cloudStatus === "running" ? (
        <Badge tone="info">Setting up</Badge>
      ) : null}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => onSelectCloudEnvironment(environment.id)}
      >
        Configure
      </Button>
    </SettingsRow>
  );
}
