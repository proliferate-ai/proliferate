import { Check, ListFilter, RefreshCw, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { ProductNotice } from "../layout/ProductNotice";
import { ProductPageShell } from "../layout/ProductPageShell";
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
  const [groupPanelOpen, setGroupPanelOpen] = useState(false);

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
        <FilterTabs
          options={filterOptions}
          selectedId={selectedFilterId}
          onChange={onFilterChange}
        />
        <div className="flex items-center gap-1.5">
          <ToolbarPopoverButton
            ariaLabel="Filter workspaces"
            title="Filter workspaces"
            icon={<ListFilter className="size-3.5" aria-hidden />}
          >
            {(close) => (
              <MenuOptionList
                ariaLabel="Workspace filters"
                options={filterOptions}
                selectedId={selectedFilterId}
                onSelect={(filterId) => {
                  onFilterChange(filterId);
                  close();
                }}
              />
            )}
          </ToolbarPopoverButton>
          <ToolbarIconButton
            ariaLabel={`Group workspaces by ${selectedGroupLabel(groupOptions, selectedGroupId)}`}
            title={`Group by ${selectedGroupLabel(groupOptions, selectedGroupId)}`}
            pressed={groupPanelOpen}
            expanded={groupPanelOpen}
            onClick={() => setGroupPanelOpen((open) => !open)}
          >
            <SlidersHorizontal className="size-3.5" aria-hidden />
          </ToolbarIconButton>
        </div>
      </div>

      {groupPanelOpen ? (
        <div className="mb-2 rounded-[10px] border border-border/55 bg-foreground/[0.025] p-1">
          <MenuOptionList
            ariaLabel="Workspace grouping"
            options={groupOptions}
            selectedId={selectedGroupId}
            onSelect={(groupBy) => {
              onGroupChange(groupBy);
              setGroupPanelOpen(false);
            }}
          />
        </div>
      ) : null}

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

function FilterTabs({
  options,
  selectedId,
  onChange,
}: {
  options: readonly WorkspaceInventoryFilterOption[];
  selectedId: WorkspaceInventoryFilterId;
  onChange: (filterId: WorkspaceInventoryFilterId) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {options.map((option) => {
        const active = selectedId === option.id;
        return (
          <Button
            key={option.id}
            variant="unstyled"
            size="unstyled"
            type="button"
            onClick={() => onChange(option.id)}
            aria-pressed={active}
            aria-label={`${option.label}, ${formatWorkspaceCount(option.count)}`}
            className={twMerge(
              "flex h-8 items-center gap-2 rounded-full border px-3.5 text-sm transition-colors",
              active
                ? "border-border bg-foreground/[0.075] font-medium text-foreground shadow-[inset_0_0_0_0.5px_rgb(255_255_255_/_0.03)]"
                : "border-border/45 bg-transparent font-normal text-muted-foreground hover:bg-foreground/[0.035] hover:text-foreground",
            )}
          >
            <span>{option.label}</span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {option.count}
            </span>
          </Button>
        );
      })}
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
        "flex size-8 items-center justify-center rounded-full border text-muted-foreground transition-colors hover:border-border/65 hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-45",
        pressed
          ? "border-border/65 bg-foreground/[0.075] text-foreground"
          : "border-border/45 bg-foreground/[0.028]",
      )}
    >
      {children}
    </Button>
  );
}

function ToolbarPopoverButton({
  ariaLabel,
  title,
  icon,
  children,
}: {
  ariaLabel: string;
  title: string;
  icon: ReactNode;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
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
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div ref={rootRef} className="relative">
      <ToolbarIconButton
        ariaLabel={ariaLabel}
        title={title}
        pressed={open}
        expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {icon}
      </ToolbarIconButton>
      {open ? (
        <div className="absolute right-0 top-full z-40 mt-2 w-56 rounded-[10px] border border-popover-ring bg-popover p-1 text-popover-foreground shadow-popover">
          {children(close)}
        </div>
      ) : null}
    </div>
  );
}

function MenuOptionList<TId extends string>({
  ariaLabel,
  options,
  selectedId,
  onSelect,
}: {
  ariaLabel: string;
  options: readonly { id: TId; label: string; count?: number }[];
  selectedId: TId;
  onSelect: (id: TId) => void;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="space-y-0.5">
      {options.map((option) => {
        const active = option.id === selectedId;
        return (
          <Button
            key={option.id}
            variant="unstyled"
            size="unstyled"
            type="button"
            aria-pressed={active}
            aria-label={
              typeof option.count === "number"
                ? `${option.label}, ${formatWorkspaceCount(option.count)}`
                : option.label
            }
            onClick={() => onSelect(option.id)}
            className={twMerge(
              "flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-sm transition-colors",
              active
                ? "bg-popover-accent text-foreground"
                : "text-muted-foreground hover:bg-popover-accent hover:text-foreground",
            )}
          >
            <span className="flex size-3.5 shrink-0 items-center justify-center">
              {active ? <Check className="size-3" aria-hidden /> : null}
            </span>
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            {typeof option.count === "number" ? (
              <span className="tabular-nums text-muted-foreground">
                {option.count}
              </span>
            ) : null}
          </Button>
        );
      })}
    </div>
  );
}

function selectedGroupLabel(
  options: readonly WorkspaceInventoryGroupOption[],
  selectedId: WorkspaceInventoryGroupBy,
): string {
  return options.find((option) => option.id === selectedId)?.label ?? "Source";
}

function formatWorkspaceCount(count: number): string {
  return `${count} ${count === 1 ? "workspace" : "workspaces"}`;
}
