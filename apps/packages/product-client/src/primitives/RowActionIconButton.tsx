import {
  forwardRef,
  type ButtonHTMLAttributes,
  type MouseEvent,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import { twMerge } from "#product/primitives/utils/tw-merge";

/**
 * [ROW-ACTION-01] sanctioned row-action icon-button primitive
 * (retune-spec.md §5.6). Fixed 28px hit target / 16px glyph, resting muted
 * ink, hover/active overlays, and a default reveal-on-group-hover contract
 * so a row's action affordances stay hidden until the row (or the button
 * itself) is hovered/focused/opened. `visibility="always"` drops the reveal
 * classes for actions that must stay visible at rest.
 *
 * Built directly on the native `<button>` (not `IconButton`, whose size
 * variants compose via plain template concatenation rather than `twMerge` —
 * overriding them from a consumer className would depend on unstable
 * generated-CSS source order instead of a reliable merge).
 */

/**
 * The transition list covers OPACITY as well as color: the reveal contract
 * below is expressed entirely in opacity, so a colors-only transition made
 * every revealed row action snap in instantly (and made the WKWebView
 * `transform-gpu`/`will-change-[opacity]` hints its consumers carry
 * meaningless). One explicit property list rather than `transition-colors` +
 * `transition-opacity`, which are the same twMerge group and would drop each
 * other. `duration-hover` is the ruled 120ms pointer-feedback role.
 */
const ROW_ACTION_BASE_CLASS =
  "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md p-0 text-ui text-muted-foreground transition-[color,background-color,border-color,opacity] duration-hover [&_svg]:icon-control hover:bg-hover hover:text-foreground active:bg-active data-[state=open]:bg-active data-[state=open]:text-foreground focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";

const ROW_ACTION_REVEAL_CLASS =
  "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:opacity-100 disabled:!pointer-events-none";

export interface RowActionIconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title" | "aria-label" | "onClick"> {
  /** Required: supplies both the accessible name and the hover title. */
  label: string;
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  /**
   * "hover" (default) hides the button until the owning row group is
   * hovered/focused/open; "always" keeps it visible and pointer-active at
   * rest.
   */
  visibility?: "hover" | "always";
  active?: boolean;
  className?: string;
}

export const RowActionIconButton = forwardRef<HTMLButtonElement, RowActionIconButtonProps>(
  function RowActionIconButton(
    {
      label,
      children,
      onClick,
      visibility = "hover",
      active = false,
      className = "",
      type = "button",
      ...props
    },
    ref,
  ) {
    const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
      // The owning row remains independently clickable, so this stops the
      // click from bubbling into the row before invoking the action.
      event.stopPropagation();
      onClick?.(event);
    };

    return (
      <button
        ref={ref}
        type={type}
        title={label}
        aria-label={label}
        onClick={handleClick}
        className={twMerge(
          ROW_ACTION_BASE_CLASS,
          active && "bg-active",
          visibility === "hover" ? ROW_ACTION_REVEAL_CLASS : "",
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);
