import { Cloud, Folder, Plus } from "lucide-react";

import { Button } from "#product/primitives/Button";
import { SettingsEmptyState } from "#product/primitives/patterns/settings/SettingsEmptyState";
import { SettingsPageHeader } from "#product/components/patterns/SettingsPageHeader";
import { SettingsRow } from "#product/primitives/patterns/settings/SettingsRow";
import { SettingsSection } from "#product/primitives/patterns/settings/SettingsSection";

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
      key="unavailable"
      label="Cloud environments unavailable"
      description={cloudUnavailableReason}
    />
  ) : null;
  const errorRow = !cloudUnavailableReason && cloudErrorMessage ? (
    <SettingsRow
      key="error"
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

  const showAddButton = hasItems && Boolean(onAddCloudEnvironment) && !cloudUnavailableReason;
  const usingEmptyState = !hasItems && !unavailableRow && !errorRow;

  return (
    <section className="space-y-6">
      <SettingsPageHeader title={title} description={description} />

      <SettingsSection
        title="Repositories"
        description="GitHub repositories configured for Proliferate Cloud."
        surface={usingEmptyState ? "plain" : "group"}
      >
        {hasItems ? (
          // Direct array of children, not a fragment: SettingsGroup dividers
          // key off Children.toArray(children), which treats a single
          // fragment as one child and drops dividers between rows inside it.
          [
            ...cloudEnvironments.map((environment) => (
              <EnvironmentRow
                key={environment.id}
                environment={environment}
                onSelectCloudEnvironment={onSelectCloudEnvironment}
              />
            )),
            unavailableRow,
            errorRow,
            loadingCloudEnvironments ? (
              <SettingsRow key="loading" label="Cloud environments" description="Loading…" />
            ) : null,
          ].filter(Boolean)
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
                <Plus className="icon-paired" />
                Add cloud environment
              </Button>
            ) : undefined}
          />
        )}
      </SettingsSection>

      {showAddButton ? (
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          onClick={onAddCloudEnvironment}
          className="mt-2 flex w-full items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-2 text-ui-sm font-medium text-muted-foreground transition-colors hover:bg-hover hover:text-foreground active:bg-active"
        >
          <Plus className="icon-paired" />
          Add cloud environment
        </Button>
      ) : null}
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
          <Cloud className="icon-paired shrink-0 text-muted-foreground" />
          <span className="truncate">{environment.fullName}</span>
        </span>
      )}
      description={environment.description}
    >
      <span className="text-ui-sm text-muted-foreground">Cloud</span>
      {environment.cloudStatus === "error" ? (
        <span className="text-ui-sm text-muted-foreground">Setup failed</span>
      ) : null}
      {environment.cloudStatus === "pending" || environment.cloudStatus === "running" ? (
        <span className="text-ui-sm text-muted-foreground">Setting up</span>
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
