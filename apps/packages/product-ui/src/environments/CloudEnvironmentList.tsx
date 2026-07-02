import type { ReactNode } from "react";
import { Cloud, Folder, Plus } from "lucide-react";

import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { SettingsSection } from "../settings/SettingsSection";
import { SettingsRow } from "../settings/SettingsRow";
import { SettingsPageHeader } from "../settings/SettingsPageHeader";
import { SettingsEyebrow } from "../settings/SettingsEyebrow";

export interface CloudEnvironmentListItemView {
  id: string;
  fullName: string;
  description: string;
  configured: boolean | null;
  locationState: "local_only" | "local_and_cloud" | "cloud_only";
  localSourceRoot?: string | null;
  trackedFileCount?: number | null;
}

export interface CloudEnvironmentListProps {
  title?: string;
  description?: string;
  cloudEnvironments: readonly CloudEnvironmentListItemView[];
  loadingCloudEnvironments?: boolean;
  cloudUnavailableReason?: string | null;
  onSelectLocalCheckout?: (id: string) => void;
  onSelectCloudEnvironment: (id: string) => void;
  onAddCloudEnvironment?: () => void;
  onRetryCloudEnvironments?: () => void;
}

export function CloudEnvironmentList({
  title = "Environments",
  description = "Configure local checkouts and personal cloud environments.",
  cloudEnvironments,
  loadingCloudEnvironments = false,
  cloudUnavailableReason = null,
  onSelectLocalCheckout,
  onSelectCloudEnvironment,
  onAddCloudEnvironment,
  onRetryCloudEnvironments,
}: CloudEnvironmentListProps) {
  return (
    <section className="space-y-6">
      <SettingsPageHeader title={title} description={description} />

      <section className="space-y-3">
        <SectionHeading
          title="Repositories"
          description="Local checkouts and GitHub repositories configured for Proliferate Cloud."
          action={onAddCloudEnvironment ? (
            <Button type="button" size="sm" onClick={onAddCloudEnvironment}>
              <Plus size={14} />
              Add GitHub repo
            </Button>
          ) : null}
        />
        <SettingsSection>
          {cloudUnavailableReason ? (
            <SettingsRow
              label="Cloud environments unavailable"
              description={cloudUnavailableReason}
            />
          ) : loadingCloudEnvironments && cloudEnvironments.length === 0 ? (
            <SettingsRow label="Repositories" description="Loading..." />
          ) : cloudEnvironments.length === 0 ? (
            <SettingsRow
              label="No repositories"
              description="Add a local checkout or GitHub repo to use it from Desktop, web, or mobile."
            />
          ) : (
            cloudEnvironments.map((environment) => (
              <SettingsRow
                key={environment.id}
                label={(
                  <span className="flex min-w-0 items-center gap-2">
                    {environment.locationState === "cloud_only" ? (
                      <Cloud size={14} className="shrink-0 text-muted-foreground" />
                    ) : (
                      <Folder size={14} className="shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate">{environment.fullName}</span>
                  </span>
                )}
                description={environmentDescription(environment)}
              >
                <div className="flex items-center gap-2">
                  {environment.localSourceRoot ? (
                    <Badge tone="neutral">Local</Badge>
                  ) : null}
                  {environment.configured !== null ? (
                    <Badge tone={environment.configured ? "success" : "warning"}>
                      {environment.configured ? "Cloud enabled" : "Cloud disabled"}
                    </Badge>
                  ) : null}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      if (environment.localSourceRoot && onSelectLocalCheckout) {
                        onSelectLocalCheckout(environment.localSourceRoot);
                        return;
                      }
                      onSelectCloudEnvironment(environment.id);
                    }}
                  >
                    Configure
                  </Button>
                </div>
              </SettingsRow>
            ))
          )}
          {onRetryCloudEnvironments ? (
            <SettingsRow label="Refresh" description="Reload cloud environment records.">
              <Button type="button" variant="secondary" size="sm" onClick={onRetryCloudEnvironments}>
                Retry
              </Button>
            </SettingsRow>
          ) : null}
        </SettingsSection>
      </section>
    </section>
  );
}

function SectionHeading({
  title,
  description,
  action = null,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <SettingsEyebrow as="h3">{title}</SettingsEyebrow>
        <p className="mt-1 max-w-2xl text-ui-sm leading-[1.45] text-muted-foreground">{description}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function environmentDescription(environment: CloudEnvironmentListItemView): string {
  const parts = [environment.description];
  if ((environment.trackedFileCount ?? 0) > 0) {
    parts.push(`${environment.trackedFileCount} tracked file${environment.trackedFileCount === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}
