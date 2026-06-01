import { Check, ListFilter } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { SidebarActionButton } from "@proliferate/ui/layout/SidebarActionButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import type {
  RecentWorkRuntimeLocation,
  RecentWorkSourceKind,
} from "@proliferate/product-domain/workspaces/cloud-work-inventory";

export type SourceFilter = RecentWorkSourceKind | "all";
export type RuntimeFilter = RecentWorkRuntimeLocation | "all";

const SOURCE_FILTERS: readonly { id: SourceFilter; label: string }[] = [
  { id: "all", label: "All sources" },
  { id: "desktop_exposed", label: "Desktop" },
  { id: "cloud_sandbox", label: "Cloud sandbox" },
  { id: "web", label: "Web" },
  { id: "mobile", label: "Mobile" },
  { id: "personal_automation", label: "Personal automation" },
  { id: "team_automation", label: "Team automation" },
  { id: "slack", label: "Slack" },
  { id: "api", label: "API" },
];

const RUNTIME_FILTERS: readonly { id: RuntimeFilter; label: string }[] = [
  { id: "all", label: "All runtimes" },
  { id: "local_desktop", label: "Local Desktop" },
  { id: "cloud_sandbox", label: "Cloud runtime" },
  { id: "ssh_remote", label: "SSH remote" },
  { id: "offline", label: "Offline" },
  { id: "unknown", label: "Unknown" },
];

export function RecentFilterPopover({
  open,
  activeFilterCount,
  onToggle,
  onClose,
  sourceFilter,
  runtimeFilter,
  onSourceFilterChange,
  onRuntimeFilterChange,
  onClear,
  onOpenAll,
}: {
  open: boolean;
  activeFilterCount: number;
  onToggle: () => void;
  onClose: () => void;
  sourceFilter: SourceFilter;
  runtimeFilter: RuntimeFilter;
  onSourceFilterChange: (filter: SourceFilter) => void;
  onRuntimeFilterChange: (filter: RuntimeFilter) => void;
  onClear: () => void;
  onOpenAll: () => void;
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

  return (
    <div ref={rootRef} className="relative">
      <SidebarActionButton
        title="Filter recents"
        active={open || activeFilterCount > 0}
        variant="section"
        onClick={onToggle}
      >
        <ListFilter className="size-3" />
        {activeFilterCount ? (
          <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-sidebar-foreground" />
        ) : null}
      </SidebarActionButton>
      {open ? (
        <div className="absolute right-0 top-full z-40 mt-2 max-h-[min(28rem,calc(100vh-12rem))] w-56 overflow-y-auto rounded-xl bg-popover/95 p-1 text-popover-foreground shadow-popover ring-[0.5px] ring-popover-ring backdrop-blur-sm">
          <FilterMenuSection label="Source">
            {SOURCE_FILTERS.map((option) => (
              <FilterMenuOption
                key={option.id}
                active={sourceFilter === option.id}
                label={option.label}
                onClick={() => onSourceFilterChange(option.id)}
              />
            ))}
          </FilterMenuSection>
          <div className="my-1 h-px bg-border" />
          <FilterMenuSection label="Runtime">
            {RUNTIME_FILTERS.map((option) => (
              <FilterMenuOption
                key={option.id}
                active={runtimeFilter === option.id}
                label={option.label}
                onClick={() => onRuntimeFilterChange(option.id)}
              />
            ))}
          </FilterMenuSection>
          <div className="my-1 h-px bg-border" />
          <PopoverMenuItem
            variant="sidebar"
            label="Clear filters"
            disabled={activeFilterCount === 0}
            onClick={onClear}
          />
          <PopoverMenuItem
            variant="sidebar"
            label="Open workspaces"
            onClick={onOpenAll}
          />
        </div>
      ) : null}
    </div>
  );
}

function FilterMenuSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="px-2 py-1 text-[10px] font-semibold uppercase leading-3 text-muted-foreground/70">
        {label}
      </div>
      {children}
    </div>
  );
}

function FilterMenuOption({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <PopoverMenuItem
      aria-pressed={active}
      onClick={onClick}
      variant="sidebar"
      label={label}
      trailing={active ? <Check className="size-3.5 text-foreground/60" /> : null}
      className={active ? "bg-sidebar-accent text-sidebar-accent-foreground" : ""}
    />
  );
}
