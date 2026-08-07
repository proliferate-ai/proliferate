import { useEffect, useState, type ComponentProps } from "react";

import { Toaster as SonnerToaster, toast } from "sonner";

/**
 * The single toast treatment for the whole app.
 *
 * Sonner is the positioner, not the surface. The toast bodies rendered through
 * `showToast` own the card — the popover frame, per-weight padding, the corner
 * close, and the details transform that widens the card in place (see
 * `ToastBody.tsx`). A card whose width animates per-toast and whose padding
 * differs per weight cannot be expressed as one shell class, so the shell is
 * stripped to a transparent hitbox and the body paints everything.
 *
 * `!` prefixes are load-bearing: sonner styles the toast element through
 * `[data-sonner-toast][data-styled="true"]` selectors that outrank a plain
 * utility class, so every neutralized property is marked important — width,
 * padding, background, border, shadow, gap. `!w-auto` in particular is what
 * lets the body's card decide the width: the shell shrink-wraps it, and the
 * `right: 0` anchor sonner keeps on the element makes a widening card grow
 * leftward while the corner never moves.
 *
 * These utility strings are hand-written literals on purpose. Tailwind emits
 * utilities by scanning source text, so a class assembled at runtime appears
 * in no file and generates no rule — that failure mode already shipped once
 * (a flat black card in light mode) and is documented on the body's card
 * constant too.
 */

/**
 * Hard limit: three toasts visible; sonner collapses the rest behind the stack
 * rather than growing an unbounded column. Same-id replacement (sonner's own
 * behaviour for a repeated `id`) is what keeps a ticking flow — a download, a
 * retry counter — from becoming four toasts about one thing.
 */
export const MAX_VISIBLE_TOASTS = 3;

const kitClassNames = {
  toast:
    "group/toast !w-auto !gap-0 !rounded-none !border-0 !bg-transparent !p-0 !shadow-none",
  content: "!m-0 !w-full !gap-0 !p-0",
  // Sonner's title slot carries its own type recipe; the bodies set every text
  // role explicitly, so the slot must stop asserting a weight of its own.
  title: "!m-0 !w-full !font-normal",
};

/**
 * Follows the app's own `data-mode`, not the OS.
 *
 * This matters even though the body owns every visible property: sonner's
 * theme decides the `--normal-*` variables behind its own defaults, so a
 * pinned `theme="dark"` would leave dark fallbacks waiting behind a light-mode
 * toast for any property the kit ever stops overriding. Reading the same
 * attribute the stylesheet reads means the fallback can no longer disagree
 * with the surface.
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
