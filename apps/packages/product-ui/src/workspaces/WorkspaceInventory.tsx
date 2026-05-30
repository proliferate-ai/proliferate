import { type CSSProperties, useId } from "react";
import { twMerge } from "tailwind-merge";
import {
  Bot,
  Braces,
  CalendarClock,
  ChevronRight,
  Cloud,
  ExternalLink,
  HelpCircle,
  Monitor,
  Smartphone,
  UsersRound,
} from "lucide-react";

import { EmptyState } from "@proliferate/ui/layout/EmptyState";
import { Button } from "@proliferate/ui/primitives/Button";

import type {
  WorkspaceInventoryGroupView,
  WorkspaceInventoryItemView,
  WorkspaceInventorySourceKind,
  WorkspaceInventoryStatusKind,
} from "@proliferate/product-domain/workspaces/inventory";

export type {
  WorkspaceInventoryGroupView,
  WorkspaceInventoryItemView,
  WorkspaceInventoryLocationKind,
  WorkspaceInventoryOwnershipKind,
  WorkspaceInventorySourceKind,
  WorkspaceInventoryStatusKind,
} from "@proliferate/product-domain/workspaces/inventory";

export interface WorkspaceInventoryProps {
  groups: readonly WorkspaceInventoryGroupView[];
  loading?: boolean;
  error?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  ariaLabel?: string;
  className?: string;
  externalOpenWorkspaceIds?: ReadonlySet<string>;
  onGroupToggle?: (groupId: string) => void;
  onWorkspaceSelect?: (workspaceId: string) => void;
}

const STATUS_GLYPH_CLASSES: Record<WorkspaceInventoryStatusKind, string> = {
  waiting: "text-muted-foreground",
  working: "",
  review: "text-success",
  blocked: "text-destructive",
  done: "text-muted-foreground",
};

const STATUS_GLYPH_STYLES: Partial<Record<WorkspaceInventoryStatusKind, CSSProperties>> = {
  working: {
    color: "var(--color-status-in-progress, var(--color-warning))",
  },
};

export function WorkspaceInventory({
  groups,
  loading = false,
  error = false,
  emptyTitle = "No workspaces",
  emptyDescription = "Workspaces will appear here when they are available.",
  ariaLabel = "Workspace inventory",
  className = "",
  externalOpenWorkspaceIds,
  onGroupToggle,
  onWorkspaceSelect,
}: WorkspaceInventoryProps) {
  const itemCount = groups.reduce((sum, g) => sum + g.items.length, 0);

  if (loading) {
    return (
      <div
        className={twMerge("py-4 text-xs text-muted-foreground", className)}
        role="status"
        aria-live="polite"
      >
        Loading workspaces
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        className={className}
        role="alert"
        title="Could not load workspaces"
        description="Refresh the page or sign in again."
      />
    );
  }

  if (itemCount === 0) {
    return (
      <EmptyState
        className={className}
        title={emptyTitle}
        description={emptyDescription}
      />
    );
  }

  return (
    <div
      className={twMerge("w-full min-w-0 overflow-hidden pb-10", className)}
      role="region"
      aria-label={ariaLabel}
    >
      {groups.map((group) => (
        <InventoryGroup
          key={group.id}
          group={group}
          externalOpenWorkspaceIds={externalOpenWorkspaceIds}
          onGroupToggle={onGroupToggle}
          onWorkspaceSelect={onWorkspaceSelect}
        />
      ))}
    </div>
  );
}

function InventoryGroup({
  group,
  externalOpenWorkspaceIds,
  onGroupToggle,
  onWorkspaceSelect,
}: {
  group: WorkspaceInventoryGroupView;
  externalOpenWorkspaceIds?: ReadonlySet<string>;
  onGroupToggle?: (groupId: string) => void;
  onWorkspaceSelect?: (workspaceId: string) => void;
}) {
  const headingId = useId();
  const listId = useId();
  const canToggle = typeof onGroupToggle === "function";
  const collapsed = canToggle && Boolean(group.collapsed);

  const headerContent = (
    <>
      <span
        className={twMerge(
          "flex min-w-0 items-center gap-2",
          canToggle ? "" : "pl-0.5",
        )}
      >
        {canToggle && (
          <ChevronRight
            className={twMerge(
              "size-4 shrink-0 text-muted-foreground/36 transition-transform",
              collapsed ? "" : "rotate-90",
            )}
            aria-hidden
          />
        )}
        {group.statusKind && <StatusGlyph status={group.statusKind} size={14} />}
        <span
          id={headingId}
          className="text-sm font-medium leading-5 text-foreground"
        >
          {group.label}
        </span>
      </span>
      <span className="text-sm tabular-nums text-muted-foreground">
        {group.count}
      </span>
    </>
  );

  const headerClass =
    "group mt-3 flex h-9 w-full justify-start items-center gap-2 rounded-[10px] bg-foreground/[0.042] px-3";

  return (
    <section aria-labelledby={headingId}>
      {canToggle ? (
        <Button
          variant="unstyled"
          size="unstyled"
          type="button"
          onClick={() => onGroupToggle(group.id)}
          aria-controls={listId}
          aria-expanded={!collapsed}
          className={twMerge(
            headerClass,
            "cursor-pointer hover:bg-foreground/[0.045] focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]",
          )}
        >
          {headerContent}
        </Button>
      ) : (
        <div className={headerClass}>{headerContent}</div>
      )}

      <div id={listId} hidden={collapsed}>
        {!collapsed &&
          (group.items.length > 0 ? (
            group.items.map((item) => (
              <InventoryRow
                key={item.id}
                item={item}
                suppressSourceLabel={group.id === item.sourceKind}
                suppressOwnerLabel={Boolean(group.suppressOwnerLabel)}
                showExternalOpenAction={externalOpenWorkspaceIds?.has(item.id) ?? false}
                onWorkspaceSelect={onWorkspaceSelect}
              />
            ))
          ) : (
            <div className="px-2.5 py-2 text-xs text-muted-foreground/50">
              No workspaces
            </div>
          ))}
      </div>
    </section>
  );
}

function InventoryRow({
  item,
  suppressSourceLabel,
  suppressOwnerLabel,
  showExternalOpenAction,
  onWorkspaceSelect,
}: {
  item: WorkspaceInventoryItemView;
  suppressSourceLabel: boolean;
  suppressOwnerLabel: boolean;
  showExternalOpenAction: boolean;
  onWorkspaceSelect?: (workspaceId: string) => void;
}) {
  const hasAction = typeof onWorkspaceSelect === "function";
  const ariaLabel = buildRowAriaLabel(item, showExternalOpenAction);
  const targetLabel = [item.runtimeLocationLabel, item.cloudAccessLabel].filter(Boolean).join(" · ");
  const subtitle = rowSubtitle(item);

  const rowClass = twMerge(
    "group relative grid h-12 w-full grid-cols-[18px_minmax(0,1fr)_3.5rem] items-center gap-x-3 rounded-[5px] px-3 py-1 text-left",
    suppressSourceLabel
      ? "sm:grid-cols-[18px_7.5rem_minmax(0,1fr)_3.5rem] lg:grid-cols-[18px_7.5rem_minmax(0,1fr)_minmax(8rem,14rem)_6.75rem_3.5rem]"
      : "sm:grid-cols-[18px_5.5rem_minmax(0,1fr)_3.5rem] md:grid-cols-[18px_5.5rem_7.5rem_minmax(0,1fr)_3.5rem] lg:grid-cols-[18px_5.5rem_7.5rem_minmax(0,1fr)_minmax(8rem,14rem)_6.75rem_3.5rem]",
    "transition-colors",
    hasAction
      ? "cursor-pointer hover:bg-foreground/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]"
      : "cursor-default",
    item.active ? "bg-foreground/[0.05]" : "",
  );

  const inner = (
    <>
      <span className="inline-flex shrink-0 items-center justify-center">
        <SourceGlyph source={item.sourceKind} label={item.sourceLabel} />
      </span>

      {!suppressSourceLabel && (
        <MetadataCell
          className="hidden sm:flex"
          label={item.sourceLabel}
        />
      )}

      <MetadataCell
        className={suppressSourceLabel ? "hidden sm:flex" : "hidden md:flex"}
        label={targetLabel}
      />

      <span className="min-w-0" title={item.title}>
        <span className="block min-w-0 truncate text-sm font-medium leading-5 text-foreground">
          {item.title}
        </span>
        {subtitle ? (
          <span className="block min-w-0 truncate text-xs leading-4 text-muted-foreground">
            {subtitle}
          </span>
        ) : null}
      </span>

      <MetadataCell
        className="hidden lg:flex"
        label={item.branchLabel ?? ""}
        subtle
      />

      <MetadataCell
        className="hidden justify-end lg:flex"
        label={item.statusLabel}
      />

      <span className="relative flex min-w-0 items-center justify-end text-right text-xs tabular-nums leading-4 text-muted-foreground">
        <span
          className={twMerge(
            "truncate transition-opacity",
            showExternalOpenAction ? "group-hover:opacity-0 group-focus-visible:opacity-0" : "",
          )}
        >
          {item.updatedLabel ?? ""}
        </span>
        {showExternalOpenAction && (
          <span
            className="pointer-events-none absolute right-0 flex size-7 items-center justify-center text-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            aria-hidden
          >
            <ExternalLink className="size-3.5" />
          </span>
        )}
      </span>

      {!showExternalOpenAction && item.ownerLabel === "Unclaimed" && !suppressOwnerLabel && (
        <span className="pointer-events-none absolute right-16 hidden text-xs font-medium leading-4 text-foreground/0 transition-colors group-hover:text-foreground group-focus-visible:text-foreground xl:block">
          Claim
        </span>
      )}
    </>
  );

  if (!hasAction) {
    return (
      <div
        className={rowClass}
        aria-label={ariaLabel}
        aria-current={item.active ? "page" : undefined}
      >
        {inner}
      </div>
    );
  }

  return (
    <Button
      variant="unstyled"
      size="unstyled"
      type="button"
      onClick={() => onWorkspaceSelect(item.id)}
      className={rowClass}
      aria-current={item.active ? "page" : undefined}
      aria-label={ariaLabel}
    >
      {inner}
    </Button>
  );
}

function MetadataCell({
  className,
  label,
  subtle = false,
}: {
  className: string;
  label: string;
  subtle?: boolean;
}) {
  return (
    <span
      className={twMerge(
        "min-w-0 items-center gap-1.5 text-xs leading-4",
        subtle ? "text-muted-foreground/70" : "text-muted-foreground",
        className,
      )}
      title={label}
    >
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}

function SourceGlyph({
  source,
  label,
}: {
  source: WorkspaceInventorySourceKind;
  label: string;
}) {
  const iconClass = "size-3.5";
  const icon = (() => {
    switch (source) {
      case "desktop_exposed":
        return <Monitor className={iconClass} aria-hidden />;
      case "cloud_sandbox":
        return <Cloud className={iconClass} aria-hidden />;
      case "web":
        return <Smartphone className={iconClass} aria-hidden />;
      case "mobile":
        return <Smartphone className={iconClass} aria-hidden />;
      case "personal_automation":
        return <CalendarClock className={iconClass} aria-hidden />;
      case "team_automation":
        return <Bot className={iconClass} aria-hidden />;
      case "slack":
        return <UsersRound className={iconClass} aria-hidden />;
      case "api":
        return <Braces className={iconClass} aria-hidden />;
      case "unknown":
        return <HelpCircle className={iconClass} aria-hidden />;
    }
  })();
  return (
    <span
      title={label}
      aria-label={label}
      className="flex size-[18px] items-center justify-center text-muted-foreground"
    >
      {icon}
    </span>
  );
}

function buildRowAriaLabel(
  item: WorkspaceInventoryItemView,
  opensExternally: boolean,
): string {
  return [
    item.title,
    item.repoLabel ? `repository ${item.repoLabel}` : null,
    item.branchLabel ? `branch ${item.branchLabel}` : null,
    item.sessionLabel ? `session ${item.sessionLabel}` : null,
    `source ${item.sourceLabel}`,
    item.scopeLabel ? `scope ${item.scopeLabel}` : null,
    `runtime ${item.runtimeLocationLabel}`,
    item.cloudAccessLabel ? item.cloudAccessLabel : null,
    item.commandabilityLabel ? item.commandabilityLabel : null,
    `status ${item.statusLabel}`,
    item.ownerLabel ? `owner ${item.ownerLabel}` : null,
    item.exposureLabel ? `exposure ${item.exposureLabel}` : null,
    item.updatedLabel ? `last updated ${item.updatedLabel}` : null,
    opensExternally ? "opens externally" : null,
  ]
    .filter(Boolean)
    .join(", ");
}

function rowSubtitle(item: WorkspaceInventoryItemView): string | null {
  return (
    [
      item.repoLabel,
      item.sessionLabel,
      item.commandabilityLabel,
    ].filter(Boolean).join(" · ") ||
    item.description ||
    null
  );
}

function StatusGlyph({
  status,
  size = 14,
}: {
  status: WorkspaceInventoryStatusKind;
  size?: number;
}) {
  const cx = 7;
  const cy = 7;
  const style = STATUS_GLYPH_STYLES[status];
  const outer = (
    <circle
      cx={cx}
      cy={cy}
      r="6"
      fill="none"
      stroke="currentColor"
      strokeDasharray="3.14 0"
      strokeDashoffset="-0.7"
      strokeWidth="1.5"
    />
  );

  if (status === "waiting") {
    return (
      <svg
        height={size}
        width={size}
        viewBox="0 0 14 14"
        className={twMerge("shrink-0", STATUS_GLYPH_CLASSES[status])}
        style={style}
        aria-hidden
      >
        <circle
          cx={cx}
          cy={cy}
          r="6"
          fill="none"
          stroke="currentColor"
          strokeDasharray="2 2"
          strokeWidth="1.5"
        />
      </svg>
    );
  }

  if (status === "done") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 14 14"
        className={twMerge("shrink-0", STATUS_GLYPH_CLASSES[status])}
        style={style}
        aria-hidden
      >
        <circle cx={cx} cy={cy} r="5.25" fill="currentColor" opacity="0.74" />
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      className={twMerge("shrink-0", STATUS_GLYPH_CLASSES[status])}
      style={style}
      aria-hidden
    >
      {outer}
      {status === "working" && (
        <circle
          cx={cx}
          cy={cy}
          r="2"
          fill="none"
          stroke="currentColor"
          strokeDasharray="12.189379495928398 24.378758991856795"
          strokeDashoffset="6.094689747964199"
          strokeWidth="4"
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      )}
      {status === "review" && (
        <circle
          cx={cx}
          cy={cy}
          r="2"
          fill="none"
          stroke="currentColor"
          strokeDasharray="18.2840692438926 18.2840692438926"
          strokeDashoffset="2.8"
          strokeWidth="4"
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      )}
      {status === "blocked" && (
        <line
          x1="4.2"
          y1="7"
          x2="9.8"
          y2="7"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.7"
        />
      )}
    </svg>
  );
}
