import { MoreHorizontal, Pause, Pencil, Play, Zap } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";
import { Button } from "@proliferate/ui/primitives/Button";
import type {
  AutomationInventoryGroupView,
  AutomationInventoryItemView,
} from "@proliferate/product-model/automations/inventory";
import { AutomationStatusGlyph } from "./AutomationStatusGlyph";

export interface AutomationInventoryListProps {
  groups: readonly AutomationInventoryGroupView[];
  busyAutomationId?: string | null;
  busyAction?: "pause" | "resume" | "run" | null;
  actionsDisabled?: boolean;
  onAutomationSelect: (automationId: string) => void;
  onEdit: (automationId: string) => void;
  onPause: (automationId: string) => void;
  onResume: (automationId: string) => void;
  onRunNow: (automationId: string) => void;
}

export function AutomationInventoryList({
  groups,
  busyAutomationId = null,
  busyAction = null,
  actionsDisabled = false,
  onAutomationSelect,
  onEdit,
  onPause,
  onResume,
  onRunNow,
}: AutomationInventoryListProps) {
  return (
    <div className="w-full min-w-0 overflow-visible pb-10" role="region" aria-label="Automations">
      {groups.map((group) => (
        <section key={group.id} aria-label={group.label}>
          <div className="mt-3 flex h-9 w-full items-center gap-2 rounded-[10px] bg-foreground/[0.042] px-3">
            <span className="text-sm font-medium leading-5 text-foreground">{group.label}</span>
            <span className="text-sm tabular-nums text-muted-foreground">{group.count}</span>
          </div>
          <div role="list">
            {group.items.map((item) => (
              <AutomationInventoryRow
                key={item.id}
                item={item}
                busy={busyAutomationId === item.id ? busyAction : null}
                actionsDisabled={actionsDisabled}
                onAutomationSelect={onAutomationSelect}
                onEdit={onEdit}
                onPause={onPause}
                onResume={onResume}
                onRunNow={onRunNow}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function AutomationInventoryRow({
  item,
  busy,
  actionsDisabled,
  onAutomationSelect,
  onEdit,
  onPause,
  onResume,
  onRunNow,
}: {
  item: AutomationInventoryItemView;
  busy: "pause" | "resume" | "run" | null;
  actionsDisabled: boolean;
  onAutomationSelect: (automationId: string) => void;
  onEdit: (automationId: string) => void;
  onPause: (automationId: string) => void;
  onResume: (automationId: string) => void;
  onRunNow: (automationId: string) => void;
}) {
  return (
    <div role="listitem" className="group relative">
      <Button
        variant="unstyled"
        size="unstyled"
        type="button"
        onClick={() => onAutomationSelect(item.id)}
        className="grid h-12 w-full cursor-pointer grid-cols-[18px_minmax(0,1fr)_4rem] items-center gap-x-3 rounded-[5px] px-3 py-1 text-left transition-colors hover:bg-foreground/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px] sm:grid-cols-[18px_minmax(0,1fr)_8rem_4rem] md:grid-cols-[18px_minmax(0,1fr)_8rem_8rem_4rem] lg:grid-cols-[18px_minmax(0,1fr)_minmax(7rem,10rem)_minmax(7rem,10rem)_minmax(8rem,12rem)_4rem]"
        aria-label={automationRowAriaLabel(item)}
      >
        <span className="inline-flex shrink-0 items-center justify-center">
          <AutomationStatusGlyph status={item.statusKind} size={14} />
        </span>

        <span className="min-w-0" title={item.title}>
          <span className="block min-w-0 truncate text-sm font-medium leading-5 text-foreground">
            {item.title}
          </span>
          <span className="block min-w-0 truncate text-xs leading-4 text-muted-foreground">
            {item.repoLabel}
          </span>
        </span>

        <MetadataCell className="hidden sm:flex" label={item.scheduleLabel} />
        <MetadataCell
          className="hidden md:flex"
          label={[item.scopeLabel, item.targetLabel].filter(Boolean).join(" · ")}
        />
        <MetadataCell className="hidden justify-end lg:flex" label={item.nextRunLabel} />

        <span className="relative flex min-w-0 items-center justify-end">
          <span className="truncate text-right text-xs leading-4 text-muted-foreground transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
            {item.statusLabel}
          </span>
        </span>
      </Button>
      <span className="absolute right-3 top-1/2 z-10 flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <RowIconButton
          label="Run automation now"
          busy={busy === "run"}
          disabled={actionsDisabled || (busy !== null && busy !== "run") || !item.enabled}
          onClick={() => onRunNow(item.id)}
        >
          <Zap className="size-3.5" aria-hidden />
        </RowIconButton>
        <AutomationActionMenu
          item={item}
          busy={busy}
          actionsDisabled={actionsDisabled}
          onEdit={onEdit}
          onPause={onPause}
          onResume={onResume}
          onRunNow={onRunNow}
        />
      </span>
    </div>
  );
}

function AutomationActionMenu({
  item,
  busy,
  actionsDisabled,
  onEdit,
  onPause,
  onResume,
  onRunNow,
}: {
  item: AutomationInventoryItemView;
  busy: "pause" | "resume" | "run" | null;
  actionsDisabled: boolean;
  onEdit: (automationId: string) => void;
  onPause: (automationId: string) => void;
  onResume: (automationId: string) => void;
  onRunNow: (automationId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
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
    <span ref={rootRef} className="relative inline-flex">
      <RowIconButton
        label="Automation actions"
        expanded={open}
        disabled={actionsDisabled || busy !== null}
        onClick={() => setOpen((current) => !current)}
      >
        <MoreHorizontal className="size-3.5" aria-hidden />
      </RowIconButton>
      {open ? (
        <span className="absolute right-0 top-full z-40 mt-2 w-44 rounded-[10px] border border-popover-ring bg-popover p-1 text-popover-foreground shadow-popover">
          <MenuAction
            label="Run now"
            icon={<Zap className="size-3.5" aria-hidden />}
            disabled={actionsDisabled || busy !== null || !item.enabled}
            onClick={() => {
              onRunNow(item.id);
              close();
            }}
          />
          <MenuAction
            label="Edit"
            icon={<Pencil className="size-3.5" aria-hidden />}
            disabled={actionsDisabled || busy !== null}
            onClick={() => {
              onEdit(item.id);
              close();
            }}
          />
          <MenuAction
            label={item.enabled ? "Pause" : "Resume"}
            icon={item.enabled ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
            disabled={actionsDisabled || busy !== null}
            onClick={() => {
              if (item.enabled) {
                onPause(item.id);
              } else {
                onResume(item.id);
              }
              close();
            }}
          />
        </span>
      ) : null}
    </span>
  );
}

function RowIconButton({
  children,
  label,
  busy = false,
  disabled = false,
  expanded,
  onClick,
}: {
  children: ReactNode;
  label: string;
  busy?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="unstyled"
      size="unstyled"
      type="button"
      aria-label={label}
      aria-expanded={expanded}
      title={label}
      disabled={disabled || busy}
      loading={busy}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-45"
    >
      {children}
    </Button>
  );
}

function MenuAction({
  label,
  icon,
  disabled = false,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="unstyled"
      size="unstyled"
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-popover-accent hover:text-foreground disabled:opacity-45"
    >
      <span className="flex size-3.5 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </Button>
  );
}

function MetadataCell({
  className,
  label,
}: {
  className: string;
  label: string;
}) {
  return (
    <span
      className={twMerge("min-w-0 items-center text-xs leading-4 text-muted-foreground", className)}
      title={label}
    >
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}

function automationRowAriaLabel(item: AutomationInventoryItemView): string {
  return [
    item.title,
    `repository ${item.repoLabel}`,
    `schedule ${item.scheduleLabel}`,
    `scope ${item.scopeLabel}`,
    `target ${item.targetLabel}`,
    `next run ${item.nextRunLabel}`,
    `status ${item.statusLabel}`,
  ].join(", ");
}
