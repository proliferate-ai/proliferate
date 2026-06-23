import type { ReactNode } from "react";
import type {
  OrganizationIntegrationPolicyItem,
  OrganizationIntegrationPolicyStatusFilter,
} from "@proliferate/product-domain/plugins/organization-integration-policy";
import { Plus, Search } from "@proliferate/ui/icons";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Select } from "@proliferate/ui/primitives/Select";
import { Switch } from "@proliferate/ui/primitives/Switch";
import { SettingsPageHeader } from "../settings/SettingsPageHeader";
import { PluginIconTile } from "./PluginGlyph";

export type {
  OrganizationIntegrationPolicyItem,
  OrganizationIntegrationPolicyStatusFilter,
};

export interface OrganizationIntegrationsPolicySurfaceProps {
  items: readonly OrganizationIntegrationPolicyItem[];
  query: string;
  statusFilter: OrganizationIntegrationPolicyStatusFilter;
  loading: boolean;
  error: string | null;
  pendingCatalogEntryIds: readonly string[];
  onQueryChange: (query: string) => void;
  onStatusFilterChange: (statusFilter: OrganizationIntegrationPolicyStatusFilter) => void;
  onToggleIntegration: (catalogEntryId: string, enabled: boolean) => void;
  onRetry: () => void;
  onAddMcpIntegration?: () => void;
}

export function OrganizationIntegrationsPolicySurface({
  items,
  query,
  statusFilter,
  loading,
  error,
  pendingCatalogEntryIds,
  onQueryChange,
  onStatusFilterChange,
  onToggleIntegration,
  onRetry,
  onAddMcpIntegration,
}: OrganizationIntegrationsPolicySurfaceProps) {
  const pendingIds = new Set(pendingCatalogEntryIds);
  const searchEmpty = !loading && !error && query.trim().length > 0 && items.length === 0;
  const empty = !loading && !error && query.trim().length === 0 && items.length === 0;

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Integrations"
        description={(
          <>
            Manage integrations available to your organization members. Members connect
            personal accounts from User Settings &gt; Integrations.
          </>
        )}
        action={onAddMcpIntegration ? (
          <Button type="button" variant="outline" onClick={onAddMcpIntegration}>
            <Plus className="size-4" />
            Add MCP integration
          </Button>
        ) : null}
      />

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search integrations..."
            className="pl-9"
            aria-label="Search integrations"
          />
        </div>
        <Select
          value={statusFilter}
          onChange={(event) =>
            onStatusFilterChange(event.target.value as OrganizationIntegrationPolicyStatusFilter)
          }
          aria-label="Filter integrations"
        >
          <option value="all">All</option>
          <option value="enabled">Enabled</option>
          <option value="disabled">Disabled</option>
        </Select>
      </div>

      {error && items.length > 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <span className="min-w-0">{error}</span>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-border-light bg-surface-elevated">
        {loading && items.length === 0 ? (
          <PolicyListMessage title="Loading integrations" />
        ) : null}

        {error && items.length === 0 ? (
          <PolicyListMessage
            title="Couldn't load integrations"
            description={error}
            action={<Button variant="outline" onClick={onRetry}>Retry</Button>}
          />
        ) : null}

        {searchEmpty ? (
          <PolicyListMessage
            title={`No integrations match "${query}"`}
            description="Try a different search term."
          />
        ) : null}

        {empty ? (
          <PolicyListMessage title="No integrations are available right now." />
        ) : null}

        {items.map((item) => (
          <PolicyRow
            key={item.catalogEntryId}
            item={item}
            pending={pendingIds.has(item.catalogEntryId)}
            onToggle={(enabled) => {
              onToggleIntegration(item.catalogEntryId, enabled);
            }}
          />
        ))}
      </div>
    </section>
  );
}

function PolicyRow({
  item,
  pending,
  onToggle,
}: {
  item: OrganizationIntegrationPolicyItem;
  pending: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <article className="grid min-h-[5.5rem] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-border-light px-4 py-4 last:border-b-0 sm:px-6">
      <div className="flex min-w-0 items-center gap-4">
        <PluginIconTile iconId={item.iconId} size="md" />
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="min-w-0 text-sm font-medium leading-5 text-foreground">
              {item.name}
            </h2>
            {item.tags.map((tag) => (
              <Badge key={tag} tone={tag === "MCP" ? "neutral" : "accent"}>
                {tag}
              </Badge>
            ))}
          </div>
          <p className="line-clamp-2 max-w-3xl text-sm leading-5 text-muted-foreground">
            {item.description}
          </p>
        </div>
      </div>
      <Switch
        checked={item.enabled}
        disabled={pending}
        onChange={onToggle}
        aria-label={`${item.enabled ? "Disable" : "Enable"} ${item.name}`}
      />
    </article>
  );
}

function PolicyListMessage({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="px-4 py-10 text-center">
      <div className="text-sm font-medium text-foreground">{title}</div>
      {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
