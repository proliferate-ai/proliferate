import { Check, ListFilter, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { ProductNotice } from "../layout/ProductNotice";
import { ProductPageShell } from "../layout/ProductPageShell";
import { PopoverMenuItem } from "../popover/PopoverMenuItem";
import { WorkspaceInventory } from "./WorkspaceInventory";

import type {
  WorkspaceInventoryFilterId,
  WorkspaceInventoryFilterOption,
  WorkspaceInventoryGroupBy,
  WorkspaceInventoryGroupOption,
  WorkspaceInventoryGroupView,
} from "@proliferate/product-model/workspaces/inventory";
import { Button } from "@proliferate/ui/primitives/Button";

export interface WorkspacesSurfaceProps {
  title?: string;
  groups: readonly WorkspaceInventoryGroupView[];
  filterOptions: readonly WorkspaceInventoryFilterOption[];
  selectedFilterId: WorkspaceInventoryFilterId;
  groupOptions: readonly WorkspaceInventoryGroupOption[];
  selectedGroupId: WorkspaceInventoryGroupBy;
  summaryLabel: string;
  lastSyncedLabel: string;
  loading?: boolean;
  error?: boolean;
  backgroundRefreshFailed?: boolean;
  isRefreshing?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  maxWidthClassName?: string;
  externalOpenWorkspaceIds?: ReadonlySet<string>;
  onFilterChange: (filterId: WorkspaceInventoryFilterId) => void;
  onGroupChange: (groupBy: WorkspaceInventoryGroupBy) => void;
  onRefresh: () => void;
  onGroupToggle: (groupId: string) => void;
  onWorkspaceSelect: (workspaceId: string) => void;
}

export function WorkspacesSurface({
  title = "Workspaces",
  groups,
  filterOptions,
  selectedFilterId,
  groupOptions,
  selectedGroupId,
  summaryLabel,
  lastSyncedLabel,
  loading = false,
  error = false,
  backgroundRefreshFailed = false,
  isRefreshing = false,
  emptyTitle = "No cloud-visible workspaces",
  emptyDescription = "Workspaces from Desktop, Web, Slack, or automations appear here.",
  maxWidthClassName = "max-w-none",
  externalOpenWorkspaceIds,
  onFilterChange,
  onGroupChange,
  onRefresh,
  onGroupToggle,
  onWorkspaceSelect,
}: WorkspacesSurfaceProps) {
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const activeViewOptionCount = [
    selectedFilterId !== "all",
    selectedGroupId !== "source",
  ].filter(Boolean).length;

  return (
    <ProductPageShell
      title={title}
      description={summaryLabel}
      actions={
        <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="hidden sm:inline">{lastSyncedLabel}</span>
          <ToolbarIconButton
            ariaLabel={isRefreshing ? "Refreshing workspaces" : "Refresh workspaces"}
            title={isRefreshing ? "Refreshing workspaces" : "Refresh workspaces"}
            disabled={isRefreshing}
            onClick={onRefresh}
          >
            <RefreshCw className={twMerge("size-3.5", isRefreshing ? "animate-spin" : "")} aria-hidden />
          </ToolbarIconButton>
        </div>
      }
      maxWidthClassName={maxWidthClassName}
      telemetryBlocked
    >
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2 pt-1">
        <div className="min-w-0 text-xs text-muted-foreground">
          <span>{selectedFilterLabel(filterOptions, selectedFilterId)}</span>
          <span className="px-1.5 text-muted-foreground/45">·</span>
          <span>Grouped by {selectedGroupLabel(groupOptions, selectedGroupId)}</span>
        </div>
        <WorkspaceViewPopover
          open={viewMenuOpen}
          activeOptionCount={activeViewOptionCount}
          filterOptions={filterOptions}
          selectedFilterId={selectedFilterId}
          groupOptions={groupOptions}
          selectedGroupId={selectedGroupId}
          onToggle={() => setViewMenuOpen((open) => !open)}
          onClose={() => setViewMenuOpen(false)}
          onFilterChange={onFilterChange}
          onGroupChange={onGroupChange}
          onClear={() => {
            onFilterChange("all");
            onGroupChange("source");
          }}
        />
      </div>

      {backgroundRefreshFailed ? (
        <ProductNotice
          tone="warning"
          title="Workspace refresh failed"
          description="The current workspace list is still shown. Try refreshing again when the connection is back."
          className="rounded-[8px] border-warning/30 bg-warning/5"
        />
      ) : null}

      <WorkspaceInventory
        groups={groups}
        loading={loading}
        error={error}
        emptyTitle={emptyTitle}
        emptyDescription={emptyDescription}
        externalOpenWorkspaceIds={externalOpenWorkspaceIds}
        onGroupToggle={onGroupToggle}
        onWorkspaceSelect={onWorkspaceSelect}
      />
    </ProductPageShell>
  );
}

function WorkspaceViewPopover({
  open,
  activeOptionCount,
  filterOptions,
  selectedFilterId,
  groupOptions,
  selectedGroupId,
  onToggle,
  onClose,
  onFilterChange,
  onGroupChange,
  onClear,
}: {
  open: boolean;
  activeOptionCount: number;
  filterOptions: readonly WorkspaceInventoryFilterOption[];
  selectedFilterId: WorkspaceInventoryFilterId;
  groupOptions: readonly WorkspaceInventoryGroupOption[];
  selectedGroupId: WorkspaceInventoryGroupBy;
  onToggle: () => void;
  onClose: () => void;
  onFilterChange: (filterId: WorkspaceInventoryFilterId) => void;
  onGroupChange: (groupBy: WorkspaceInventoryGroupBy) => void;
  onClear: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) {
        return;
      }
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  const primaryFilters = filterOptions.filter((option) => !option.id.includes(":"));
  const sourceFilters = filterOptions.filter((option) => option.id.startsWith("source:"));
  const runtimeFilters = filterOptions.filter((option) => option.id.startsWith("runtime:"));

  return (
    <div ref={rootRef} className="relative">
      <ToolbarIconButton
        ariaLabel="Workspace view options"
        title="Workspace view options"
        pressed={open || activeOptionCount > 0}
        expanded={open}
        onClick={onToggle}
      >
        <ListFilter className="size-3.5" aria-hidden />
        {activeOptionCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-foreground" />
        ) : null}
      </ToolbarIconButton>
      {open ? (
        <div className="absolute right-0 top-full z-40 mt-2 max-h-[min(32rem,calc(100vh-12rem))] w-64 overflow-y-auto rounded-xl bg-popover/95 p-1 text-popover-foreground shadow-popover ring-[0.5px] ring-popover-ring backdrop-blur-sm">
          <WorkspaceMenuSection label="Filter">
            <WorkspaceFilterOptions
              options={primaryFilters}
              selectedId={selectedFilterId}
              onSelect={onFilterChange}
            />
          </WorkspaceMenuSection>
          {sourceFilters.length > 0 ? (
            <>
              <WorkspaceMenuSeparator />
              <WorkspaceMenuSection label="Source">
                <WorkspaceFilterOptions
                  options={sourceFilters}
                  selectedId={selectedFilterId}
                  onSelect={onFilterChange}
                />
              </WorkspaceMenuSection>
            </>
          ) : null}
          {runtimeFilters.length > 0 ? (
            <>
              <WorkspaceMenuSeparator />
              <WorkspaceMenuSection label="Runtime">
                <WorkspaceFilterOptions
                  options={runtimeFilters}
                  selectedId={selectedFilterId}
                  onSelect={onFilterChange}
                />
              </WorkspaceMenuSection>
            </>
          ) : null}
          <WorkspaceMenuSeparator />
          <WorkspaceMenuSection label="Group by">
            {groupOptions.map((option) => (
              <WorkspaceMenuOption
                key={option.id}
                active={option.id === selectedGroupId}
                label={option.label}
                onClick={() => onGroupChange(option.id)}
              />
            ))}
          </WorkspaceMenuSection>
          <WorkspaceMenuSeparator />
          <PopoverMenuItem
            variant="sidebar"
            label="Clear view options"
            disabled={activeOptionCount === 0}
            onClick={onClear}
          />
        </div>
      ) : null}
    </div>
  );
}

function ToolbarIconButton({
  children,
  ariaLabel,
  title,
  disabled = false,
  pressed = false,
  expanded,
  onClick,
}: {
  children: ReactNode;
  ariaLabel: string;
  title: string;
  disabled?: boolean;
  pressed?: boolean;
  expanded?: boolean;
  onClick?: () => void;
}) {
  return (
    <Button
      variant="unstyled"
      size="unstyled"
      type="button"
      aria-label={ariaLabel}
      aria-expanded={expanded}
      aria-pressed={pressed || undefined}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={twMerge(
        "relative flex size-8 items-center justify-center rounded-full border text-muted-foreground transition-colors hover:border-border/65 hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-45",
        pressed
          ? "border-border/65 bg-foreground/[0.075] text-foreground"
          : "border-border/45 bg-foreground/[0.028]",
      )}
    >
      {children}
    </Button>
  );
}

function WorkspaceFilterOptions({
  options,
  selectedId,
  onSelect,
}: {
  options: readonly WorkspaceInventoryFilterOption[];
  selectedId: WorkspaceInventoryFilterId;
  onSelect: (id: WorkspaceInventoryFilterId) => void;
}) {
  return (
    <>
      {options.map((option) => (
        <WorkspaceMenuOption
          key={option.id}
          active={option.id === selectedId}
          label={option.label}
          count={option.count}
          onClick={() => onSelect(option.id)}
        />
      ))}
    </>
  );
}

function WorkspaceMenuSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="space-y-0.5">
      <div
        aria-hidden
        className="px-2 py-1 text-[10px] font-semibold uppercase leading-3 text-muted-foreground/70"
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function WorkspaceMenuOption({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <PopoverMenuItem
      aria-pressed={active}
      variant="sidebar"
      label={label}
      trailing={(
        <span className="flex items-center gap-2">
          {typeof count === "number" ? (
            <span aria-hidden className="tabular-nums text-muted-foreground">
              {count}
            </span>
          ) : null}
          {active ? <Check className="size-3.5 text-foreground/60" /> : null}
        </span>
      )}
      className={active ? "bg-sidebar-accent text-sidebar-accent-foreground" : ""}
      onClick={onClick}
    />
  );
}

function WorkspaceMenuSeparator() {
  return <div className="my-1 h-px bg-border" />;
}

function selectedGroupLabel(
  options: readonly WorkspaceInventoryGroupOption[],
  selectedId: WorkspaceInventoryGroupBy,
): string {
  return options.find((option) => option.id === selectedId)?.label ?? "Source";
}

function selectedFilterLabel(
  options: readonly WorkspaceInventoryFilterOption[],
  selectedId: WorkspaceInventoryFilterId,
): string {
  return options.find((option) => option.id === selectedId)?.label ?? "All";
}
