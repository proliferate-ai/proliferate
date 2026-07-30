import type { ComponentProps } from "react";

import { Toaster as SonnerToaster, toast } from "sonner";

import { POPOVER_FRAME_CLASS } from "./popover-surface";

/**
 * The single toast treatment for the whole app.
 *
 * Toasts and popovers are the same kind of object — a small floating panel of
 * app chrome laid over content — so they wear the same skin: the canonical
 * popover frame (90%-alpha fill, hairline ring, blur, 12px radius, floating
 * shadow) instead of the opaque flat-bordered card sonner ships. Reusing
 * `POPOVER_FRAME_CLASS` rather than restating those values is what keeps the
 * two from drifting the next time popover chrome is retuned.
 *
 * Hierarchy inside the toast follows the update announcement that this
 * treatment is modeled on: a medium-weight title at the small UI step, a muted
 * description under it, and the button pair as compact 24px controls where only
 * the primary action carries a fill. Padding is 12px, not sonner's 16px —
 * these are one- or two-line notices, and the extra inset made every toast
 * read as a dialog.
 *
 * `!` prefixes are load-bearing: sonner styles the same elements through
 * `[data-sonner-toast][data-styled="true"]` selectors that outrank a plain
 * utility class, so every property we mean to own is marked important — hence
 * `important()` over the popover frame instead of interpolating it directly.
 */
function important(classes: string): string {
  return classes
    .split(/\s+/)
    .filter(Boolean)
    .map((name) => (name.startsWith("!") ? name : `!${name}`))
    .join(" ");
}

const kitClassNames = {
  toast: `${important(POPOVER_FRAME_CLASS)} !p-3 !gap-2 !text-ui-sm`,
  title: "!text-ui-sm !font-medium !text-foreground",
  description: "!text-ui-sm !text-muted-foreground",
  icon: "!mr-2 !items-start",
  content: "!gap-0.5",
  actionButton:
    "!h-6 !rounded-md !border !border-transparent !bg-primary !px-2 !text-ui-sm !font-medium !text-primary-foreground hover:!bg-primary/90 active:!bg-primary/80",
  cancelButton:
    "!h-6 !rounded-md !border !border-input !bg-transparent !px-2 !text-ui-sm !text-muted-foreground hover:!bg-hover hover:!text-foreground active:!bg-active",
  closeButton:
    "!border-transparent !bg-transparent !text-muted-foreground hover:!bg-hover hover:!text-foreground",
};

export function Toaster({ toastOptions, ...props }: ComponentProps<typeof SonnerToaster>) {
  return (
    <SonnerToaster
      theme="dark"
      position="bottom-right"
      richColors={false}
      // Always expanded: prevents the hover-enter resize animation that sonner
      // applies when transitioning stacked toasts from collapsed to expanded.
      expand
      // Sonner's default 14px stack gap is wider than the 8px rhythm the rest
      // of the floating chrome uses.
      gap={8}
      {...props}
      toastOptions={{
        ...toastOptions,
        classNames: {
          ...kitClassNames,
          ...toastOptions?.classNames,
        },
      }}
    />
  );
}

export { toast };
