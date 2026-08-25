import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { twMerge } from "#product/primitives/utils/tw-merge";
import { Button } from "#product/primitives/Button";
import { PopoverMenuItem } from "#product/primitives/PopoverMenuItem";
import { PopoverSearchField } from "#product/primitives/PopoverSearchField";
import {
  POPOVER_SURFACE_CLASS,
} from "#product/primitives/PopoverButton";
import { ChevronDown } from "#product/primitives/icons/core";
import {
  CloudIcon,
  Monitor,
} from "#product/primitives/icons/platform";
import { Tree } from "#product/primitives/icons/workspace-git";
import type { HomeNextRepoLaunchKind } from "#product/lib/domain/home/home-next-launch";

export const TARGET_PICKER_SURFACE_CLASS = `w-60 min-w-[175px] ${POPOVER_SURFACE_CLASS}`;

const TARGET_PICKER_SECTION_CLASS =
  "flex min-h-6 items-center truncate px-2.5 py-1 text-ui-sm text-muted-foreground";
const TARGET_PICKER_TRIGGER_ICON_CLASS = "icon-paired";
const TARGET_PICKER_MENU_ICON_CLASS = "size-full";

export function homeTargetLaunchKindIcon(
  kind: HomeNextRepoLaunchKind,
  variant: "trigger" | "menu" = "trigger",
) {
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
  /** Value ("proliferate", "New worktree") shown in the attached utility bar. */
  value: string;
  disclosure?: boolean;
}

/**
 * Home utility-bar item: compact inline "icon value ▾" trigger with a
 * quiet pill hover fill.
 */
export const HomeTargetRowItem = forwardRef<HTMLButtonElement, HomeTargetRowItemProps>(
  function HomeTargetRowItem(
    { icon, value, disclosure = true, className, type = "button", ...props },
    ref,
  ) {
    return (
      <Button
        ref={ref}
        type={type}
        variant="unstyled"
        size="unstyled"
        className={twMerge(
          "flex h-7 min-w-0 select-none items-center gap-1.5 whitespace-nowrap rounded-full border border-transparent px-2.5 py-0 text-body text-foreground outline-none transition-colors enabled:hover:bg-hover enabled:active:bg-active disabled:cursor-not-allowed disabled:opacity-40 data-[state=open]:bg-active",
          className,
        )}
        {...props}
      >
        {/* The icons center on the line box, but the mostly-lowercase labels
            carry their visual mass at x-height, below that center — sit the
            glyph down a hair so it reads aligned with the word. */}
        {icon ? <span className="inline-flex shrink-0 translate-y-[1px] items-center">{icon}</span> : null}
        <span className="inline-flex min-w-0 items-baseline gap-1 text-left">
          <span className="min-w-0 max-w-60 truncate font-normal">{value}</span>
        </span>
        {disclosure ? (
          <ChevronDown className="icon-compact shrink-0 text-foreground" />
        ) : null}
      </Button>
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
