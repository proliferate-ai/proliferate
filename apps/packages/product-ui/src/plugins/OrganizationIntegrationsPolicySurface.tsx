import { useMemo, useState, type ReactNode } from "react";
import type {
  OrganizationIntegrationPolicyCategoryFilter,
  OrganizationIntegrationPolicyItem,
} from "@proliferate/product-domain/plugins/organization-integration-policy";
import {
  ORGANIZATION_INTEGRATION_POLICY_FILTER_OPTIONS,
} from "@proliferate/product-domain/plugins/organization-integration-policy";
import { Check, ChevronDown, Plus, Search } from "@proliferate/ui/icons";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import {
  PickerEmptyRow,
  PickerPopoverContent,
} from "@proliferate/ui/primitives/PickerPopoverContent";
import { PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { Switch } from "@proliferate/ui/primitives/Switch";
import { SettingsPageHeader } from "../settings/SettingsPageHeader";
import { PluginIconTile } from "./PluginGlyph";

export type {
  OrganizationIntegrationPolicyCategoryFilter,
  OrganizationIntegrationPolicyItem,
};

export interface OrganizationIntegrationsPolicySurfaceProps {
  items: readonly OrganizationIntegrationPolicyItem[];
  query: string;
  categoryFilter: OrganizationIntegrationPolicyCategoryFilter;
  loading: boolean;
  error: string | null;
  pendingCatalogEntryIds: readonly string[];
  onQueryChange: (query: string) => void;
  onCategoryFilterChange: (categoryFilter: OrganizationIntegrationPolicyCategoryFilter) => void;
  onToggleIntegration: (catalogEntryId: string, enabled: boolean) => void;
  onRetry: () => void;
  onAddMcpIntegration?: () => void;
}

export function OrganizationIntegrationsPolicySurface({
  items,
  query,
  categoryFilter,
  loading,
  error,
  pendingCatalogEntryIds,
  onQueryChange,
  onCategoryFilterChange,
  onToggleIntegration,
  onRetry,
  onAddMcpIntegration,
}: OrganizationIntegrationsPolicySurfaceProps) {
  const pendingIds = new Set(pendingCatalogEntryIds);
  const trimmedQuery = query.trim();
  const hasActiveFilter = trimmedQuery.length > 0 || categoryFilter !== "all";
  const filteredEmpty = !loading && !error && hasActiveFilter && items.length === 0;
  const empty = !loading && !error && !hasActiveFilter && items.length === 0;
  const filteredEmptyTitle = trimmedQuery.length > 0
    ? `No integrations match "${trimmedQuery}"`
    : "No integrations match these filters";

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
        <IntegrationCategoryFilterDropdown
          value={categoryFilter}
          onChange={onCategoryFilterChange}
        />
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

        {filteredEmpty ? (
          <PolicyListMessage
            title={filteredEmptyTitle}
            description="Try a different search term or filter."
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

function IntegrationCategoryFilterDropdown({
  value,
  onChange,
}: {
  value: OrganizationIntegrationPolicyCategoryFilter;
  onChange: (value: OrganizationIntegrationPolicyCategoryFilter) => void;
}) {
  const [filterQuery, setFilterQuery] = useState("");
  const selectedOption =
    ORGANIZATION_INTEGRATION_POLICY_FILTER_OPTIONS.find((option) => option.id === value)
    ?? { id: "all", label: "All" };
  const visibleOptions = useMemo(() => {
    const normalizedQuery = filterQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return ORGANIZATION_INTEGRATION_POLICY_FILTER_OPTIONS;
    }
    return ORGANIZATION_INTEGRATION_POLICY_FILTER_OPTIONS.filter((option) =>
      option.label.toLowerCase().includes(normalizedQuery)
    );
  }, [filterQuery]);

  return (
    <PopoverButton
      trigger={(
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-surface-control px-3 text-left text-sm text-foreground shadow-none outline-none transition-colors hover:bg-list-hover focus:outline-none focus:ring-1 focus:ring-ring data-[state=open]:bg-list-hover data-[state=open]:ring-1 data-[state=open]:ring-ring"
          aria-label={`Filter integrations: ${selectedOption.label}`}
        >
          <span className="min-w-0 truncate">{selectedOption.label}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      )}
      align="end"
      side="bottom"
      className="w-56 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-floating"
      onOpenChange={(open) => {
        if (!open) {
          setFilterQuery("");
        }
      }}
    >
      {(close) => (
        <PickerPopoverContent
          searchValue={filterQuery}
          searchPlaceholder="Search"
          onSearchChange={setFilterQuery}
          bodyClassName="py-1"
        >
          {visibleOptions.length > 0 ? (
            visibleOptions.map((option) => {
              const selected = option.id === value;
              return (
                <PopoverMenuItem
                  key={option.id}
                  label={option.label}
                  trailing={selected ? <Check className="size-3.5" /> : null}
                  className={selected ? "bg-list-hover" : ""}
                  aria-selected={selected}
                  onClick={() => {
                    onChange(option.id);
                    setFilterQuery("");
                    close();
                  }}
                />
              );
            })
          ) : (
            <PickerEmptyRow label="No filters found" />
          )}
        </PickerPopoverContent>
      )}
    </PopoverButton>
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
