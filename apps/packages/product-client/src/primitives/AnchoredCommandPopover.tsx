import { type ReactNode } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { Popover, PopoverAnchor } from "./Popover";
import { useNativeOverlayRegistration } from "#product/primitives/overlays/overlay-presence";
import { POPOVER_SURFACE_CLASS } from "./popover-surface";

interface AnchoredCommandPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible name for the popover's dialog. Required: this surface has no
   * trigger to borrow a name from. */
  "aria-label": string;
  /** Class name for the popover surface. */
  className?: string;
  children: ReactNode;
}

/**
 * A popover raised by a COMMAND rather than by a control.
 *
 * Everything an anchored popover gives you — the portal, the chrome, the
 * dismissal, the focus neutrality, the enter animation — but with nothing on
 * screen to hang off. Surfaces reached from the command palette, a deep link or
 * an empty state have no trigger element, and the alternative (a centered
 * Dialog) says "answer this" about content that is a menu.
 *
 * The anchor is a zero-size fixed point near the top of the viewport, so the
 * surface lands where a menu opened from the top chrome would.
 */
export function AnchoredCommandPopover({
  open,
  onOpenChange,
  "aria-label": ariaLabel,
  className = POPOVER_SURFACE_CLASS,
  children,
}: AnchoredCommandPopoverProps) {
  useNativeOverlayRegistration(open);

  return (
    // modal: parity with PopoverButton — an outside click must ONLY dismiss.
    <Popover open={open} onOpenChange={onOpenChange} modal>
      <PopoverAnchor asChild>
        {/* Sanctioned geometry: the command surface's resting height is this
            primitive's own anatomy, not a call site's choice (geometry rule). */}
        <span
          aria-hidden
          className="pointer-events-none fixed left-1/2 top-[15vh] block size-0"
        />
      </PopoverAnchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          data-slot="popover-content"
          aria-label={ariaLabel}
          side="bottom"
          align="center"
          sideOffset={0}
          // Focus neutrality, matching PopoverButton: opening must not blur the
          // composer, closing must not yank focus back to an anchor that is not
          // a control.
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          // The enter animation is scoped to `data-[state=open]`: an
          // unconditional `animate-popover-in` leaves the animation declared on
          // the CLOSED element too, and Radix Presence then waits forever for an
          // `animationend` that already fired, so the closed popover never
          // unmounts (see PopoverButton).
          className={`z-popover outline-none data-[state=open]:animate-popover-in [transform-origin:var(--radix-popover-content-transform-origin)] ${className}`}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </Popover>
  );
}
