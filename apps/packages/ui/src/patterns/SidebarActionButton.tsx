import { forwardRef, type MouseEventHandler, type ReactNode } from "react";
import { RowActionIconButton } from "../primitives/RowActionIconButton";

export type SidebarActionButtonVariant = "default" | "section";

export interface SidebarActionButtonProps {
  children: ReactNode;
  title: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  className?: string;
  alwaysVisible?: boolean;
  active?: boolean;
  disabled?: boolean;
  variant?: SidebarActionButtonVariant;
}

/**
 * Thin sidebar tone/variant adapter over the shared `RowActionIconButton`
 * primitive ([ROW-ACTION-01], retune-spec.md §5.6) — not a second visual
 * primitive. Overrides the primitive's default 28px/muted-ink treatment
 * with the sidebar's 24px box and sidebar-foreground ink; the reveal
 * contract, its opacity transition, and click-stop behavior come from the
 * shared base — this adapter deliberately declares no `transition-*` of its
 * own, since any spelling here replaces the base's whole property list
 * (same twMerge group) and would silently re-own motion for every consumer.
 *
 * Round-3: the base primitive's hover/active/open background chip
 * (`hover:bg-hover active:bg-active data-[state=open]:bg-active`) makes
 * these trailing plus/three-dots controls read as their own separate
 * button surface — heavier than the reference, whose equivalent controls
 * carry no background at any interaction state (`enabled:hover:bg-transparent`
 * in the reference stylesheet) and signal hover purely through a muted→
 * foreground color shift. `bg-transparent` here wins the same twMerge
 * background-color group as the base's `bg-hover`/`bg-active`, canceling
 * the chip while keeping the base's color transition and reveal-on-hover
 * opacity contract intact.
 */
export const SidebarActionButton = forwardRef<HTMLButtonElement, SidebarActionButtonProps>(
  function SidebarActionButton({
    children,
    title,
    onClick,
    className = "",
    alwaysVisible = false,
    active = false,
    disabled = false,
    variant = "default",
  }, ref) {
    const isAlwaysVisible = alwaysVisible || variant === "section";

    return (
      <RowActionIconButton
        ref={ref}
        label={title}
        onClick={onClick}
        disabled={disabled}
        visibility={isAlwaysVisible ? "always" : "hover"}
        className={`size-6 border border-transparent text-sidebar-muted-foreground [font-size:var(--text-sidebar-row)] hover:bg-transparent hover:text-sidebar-foreground active:bg-transparent data-[state=open]:bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-sidebar-ring ${
          active ? "bg-selected text-sidebar-accent-foreground" : ""
        } ${
          variant === "section"
            ? "opacity-75 hover:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
            : ""
        } ${className}`}
      >
        {children}
      </RowActionIconButton>
    );
  },
);
