import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";
import { ComputeTargetSwatch } from "@/components/compute/ComputeTargetSwatch";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { PopoverSearchField } from "@proliferate/ui/primitives/PopoverSearchField";
import {
  POPOVER_SURFACE_CLASS,
} from "@proliferate/ui/primitives/PopoverButton";
import {
  ChevronDown,
  CloudIcon,
  Monitor,
  Terminal,
  Tree,
} from "@proliferate/ui/icons";
import type { ComputeLaunchTargetOption } from "@/lib/domain/compute/target-options";
import type { HomeNextRepoLaunchKind } from "@/lib/domain/home/home-next-launch";

export const TARGET_PICKER_SURFACE_CLASS = `w-60 min-w-[175px] ${POPOVER_SURFACE_CLASS}`;
export const TARGET_PICKER_DIVIDER_CLASS = "mx-1 my-1.5 h-px scale-y-50 bg-foreground/10";

const TARGET_PICKER_SECTION_CLASS =
  "flex min-h-6 items-center truncate px-2.5 py-1 text-[12px] leading-4 text-muted-foreground";
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

interface HomeTargetRowItemProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon?: ReactNode;
  /** Category label ("Project", "Env") — 12px weight 500 foreground. */
  category?: string | null;
  /** Value ("proliferate", "New worktree") — 12px weight 400 muted. */
  value: string;
  disclosure?: boolean;
}

/**
 * Codex home footer item (UX spec §1.3, anchor `_externalFooterItem`):
 * inline "category value ▾" trigger — 12px text, category weight 500
 * `--foreground`, value weight 400 truncated, 12px `--faint` chevron,
 * pill hover fill.
 */
export const HomeTargetRowItem = forwardRef<HTMLButtonElement, HomeTargetRowItemProps>(
  function HomeTargetRowItem(
    { icon, category, value, disclosure = true, className, type = "button", ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={twMerge(
          "flex h-6 min-w-0 select-none items-center gap-1 whitespace-nowrap rounded-full border border-transparent px-1.5 py-0 text-[13px] leading-[18px] text-muted-foreground outline-none transition-colors enabled:hover:bg-accent enabled:hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 data-[state=open]:bg-accent data-[state=open]:text-foreground",
          className,
        )}
        {...props}
      >
        {icon ? <span className="inline-flex shrink-0 items-center">{icon}</span> : null}
        <span className="inline-flex min-w-0 items-baseline gap-1 text-left">
          {category ? (
            <span className="shrink-0 font-medium text-foreground">{category}</span>
          ) : null}
          <span className="min-w-0 max-w-60 truncate font-normal">{value}</span>
        </span>
        {disclosure ? (
          <ChevronDown className="size-3 shrink-0 text-faint" />
        ) : null}
      </button>
    );
  },
);

export function ProjectSearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return <PopoverSearchField value={value} onChange={onChange} placeholder="Search projects" />;
}

export function BranchSearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return <PopoverSearchField value={value} onChange={onChange} placeholder="Search branches" />;
}
