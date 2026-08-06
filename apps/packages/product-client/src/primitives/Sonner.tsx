import { useEffect, useState, type ComponentProps } from "react";

import { Toaster as SonnerToaster, toast } from "sonner";

import { POPOVER_FRAME_IMPORTANT_CLASS } from "./popover-surface";

/**
 * The single toast treatment for the whole app.
 *
 * Toasts and popovers are the same kind of object — a small floating panel of
 * app chrome laid over content — so they wear the same skin: the canonical
 * popover frame (90%-alpha fill, hairline ring, blur, 12px radius, floating
 * shadow) instead of the opaque flat-bordered card sonner ships. Reusing the
 * popover frame rather than restating those values is what keeps the two from
 * drifting the next time popover chrome is retuned.
 *
 * Hierarchy inside the toast follows the update announcement that this
 * treatment is modeled on: a medium-weight title at the small UI step, a muted
 * description under it, and the button pair as compact 24px controls where only
 * the primary action carries a fill. Padding is 12px, not sonner's 16px —
 * these are one- or two-line notices, and the extra inset made every toast
 * read as a dialog. The close control sits inside the right edge and reveals
 * on toast hover or keyboard focus. Sonner's default hangs it outside the
 * top-left corner, which our deliberate overflow cap clips into a stray slash.
 *
 * `!` prefixes are load-bearing: sonner styles the same elements through
 * `[data-sonner-toast][data-styled="true"]` selectors that outrank a plain
 * utility class, so every property we mean to own is marked important — hence
 * `POPOVER_FRAME_IMPORTANT_CLASS` rather than the plain frame.
 *
 * That constant is a hand-written literal on purpose. Prefixing the plain frame
 * with `!` in a helper *looked* equivalent and read cleanly, but Tailwind emits
 * utilities by scanning source text: `!bg-popover/90` assembled at runtime
 * appears in no file, so no rule is ever generated and the class silently does
 * nothing. Sonner's own `background: var(--normal-bg)` then won, which is how
 * every toast rendered as a flat black card in light mode.
 */

/**
 * Hard limit: three toasts visible; sonner collapses the rest behind the stack
 * rather than growing an unbounded column. Same-id replacement (sonner's own
 * behaviour for a repeated `id`) is what keeps a ticking flow — a download, a
 * retry counter — from becoming four toasts about one thing.
 */
export const MAX_VISIBLE_TOASTS = 3;

/**
 * Hard limit: never taller than the three-line excerpt. If a message doesn't
 * fit, it isn't a toast — so the frame clips instead of scrolling, which makes
 * an over-long payload a visible bug rather than a silent panel.
 */
const TOAST_MAX_HEIGHT_CLASS = "!max-h-[168px] !overflow-hidden";

const kitClassNames = {
  toast: `${POPOVER_FRAME_IMPORTANT_CLASS} group/toast !py-3 !pl-3 !pr-9 !gap-2 !text-ui-sm ${TOAST_MAX_HEIGHT_CLASS}`,
  title: "!text-ui-sm !font-medium !text-foreground",
  description: "!text-ui-sm !text-muted-foreground",
  icon: "!mr-2 !items-start",
  content: "!gap-0.5",
  actionButton:
    "!h-6 !rounded-md !border !border-transparent !bg-primary !px-2 !text-ui-sm !font-medium !text-primary-foreground hover:!bg-primary/90 active:!bg-primary/80",
  cancelButton:
    "!h-6 !rounded-md !border !border-input !bg-transparent !px-2 !text-ui-sm !text-muted-foreground hover:!bg-hover hover:!text-foreground active:!bg-active",
  closeButton:
    "[--toast-close-button-start:auto] [--toast-close-button-end:8px] [--toast-close-button-transform:translateY(-50%)] !top-1/2 !border-transparent !bg-transparent !text-muted-foreground !opacity-0 !transition-[opacity,background,color] !duration-hover group-hover/toast:!opacity-100 hover:!bg-hover hover:!text-foreground focus-visible:!opacity-100",
};

/**
 * Follows the app's own `data-mode`, not the OS.
 *
 * This matters even though the kit owns every visible property: sonner's theme
 * decides the `--normal-*` variables behind its own defaults, so a pinned
 * `theme="dark"` left a black card waiting behind a light-mode toast for any
 * property the kit ever stops overriding. Reading the same attribute the
 * stylesheet reads means the fallback can no longer disagree with the surface.
 */
function useResolvedToastTheme(): "light" | "dark" {
  const read = () =>
    typeof document !== "undefined"
    && document.documentElement.dataset.mode === "light"
      ? "light"
      : "dark";
  const [theme, setTheme] = useState<"light" | "dark">(read);

  useEffect(() => {
    const sync = () => setTheme(read());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-mode"],
    });
    return () => observer.disconnect();
  }, []);

  return theme;
}

export function Toaster({ toastOptions, ...props }: ComponentProps<typeof SonnerToaster>) {
  const theme = useResolvedToastTheme();
  return (
    <SonnerToaster
      theme={theme}
      position="bottom-right"
      richColors={false}
      // Always expanded: prevents the hover-enter resize animation that sonner
      // applies when transitioning stacked toasts from collapsed to expanded.
      expand
      // Sonner's default 14px stack gap is wider than the 8px rhythm the rest
      // of the floating chrome uses.
      gap={8}
      visibleToasts={MAX_VISIBLE_TOASTS}
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
