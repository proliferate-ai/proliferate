import type { ReactNode } from "react";
import { ComputeTargetSwatch } from "@/components/compute/ComputeTargetSwatch";
import { Input } from "@proliferate/ui/primitives/Input";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import {
  POPOVER_SURFACE_CLASS,
} from "@proliferate/ui/primitives/PopoverButton";
import {
  CloudIcon,
  Monitor,
  Search,
  Terminal,
  Tree,
} from "@proliferate/ui/icons";
import type { ComputeLaunchTargetOption } from "@/lib/domain/compute/target-options";
import type { HomeNextRepoLaunchKind } from "@/lib/domain/home/home-next-launch";

export const TARGET_PICKER_SURFACE_CLASS = `w-60 min-w-[175px] ${POPOVER_SURFACE_CLASS}`;
export const TARGET_PICKER_DIVIDER_CLASS = "mx-1 my-1.5 h-px scale-y-50 bg-foreground/10";

const TARGET_PICKER_SECTION_CLASS =
  "flex min-h-6 items-center truncate px-2 py-1 text-sm leading-4 text-muted-foreground";
const TARGET_PICKER_TRIGGER_ICON_CLASS = "size-3.5";
const TARGET_PICKER_MENU_ICON_CLASS = "size-full";

export function homeTargetLaunchKindIcon(
  kind: HomeNextRepoLaunchKind,
  target?: ComputeLaunchTargetOption | null,
  variant: "trigger" | "menu" = "trigger",
) {
  if (kind === "ssh" && target) {
    if (variant === "menu") {
      return <ComputeTargetSwatch appearance={target.appearance} size="inherit" />;
    }
    return (
      <span className={TARGET_PICKER_TRIGGER_ICON_CLASS}>
        <ComputeTargetSwatch appearance={target.appearance} size="inherit" />
      </span>
    );
  }
  const iconClassName = variant === "menu"
    ? TARGET_PICKER_MENU_ICON_CLASS
    : TARGET_PICKER_TRIGGER_ICON_CLASS;
  switch (kind) {
    case "worktree":
      return <Tree className={iconClassName} />;
    case "local":
      return <Monitor className={iconClassName} />;
    case "cloud":
      return <CloudIcon className={iconClassName} />;
    case "ssh":
      return <Terminal className={iconClassName} />;
  }
}

export function TargetSection({ label }: { label: string }) {
  return (
    <div className={TARGET_PICKER_SECTION_CLASS}>
      {label}
    </div>
  );
}

export function TargetPickerMenuItem({
  icon,
  label,
  trailing,
  disabled,
  title,
  onClick,
}: {
  icon?: ReactNode;
  label: string;
  trailing?: ReactNode;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <PopoverMenuItem
      density="compact"
      title={title}
      disabled={disabled}
      icon={icon}
      label={label}
      trailing={trailing}
      onClick={() => {
        onClick();
      }}
    />
  );
}

export function ProjectSearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="p-2 pb-1.5">
      <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-surface-control px-2.5">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Search projects"
          className="h-8 border-0 bg-transparent px-0 py-0 text-sm shadow-none focus:ring-0"
        />
      </div>
    </div>
  );
}

export function BranchSearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="px-1 pb-1">
      <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-surface-control px-2.5">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Search branches"
          className="h-8 border-0 bg-transparent px-0 py-0 text-sm shadow-none focus:ring-0"
        />
      </div>
    </div>
  );
}
