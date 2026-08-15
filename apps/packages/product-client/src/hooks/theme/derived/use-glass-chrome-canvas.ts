import { useEffect } from "react";

/**
 * The design system paints the page canvas opaque (`:root { background:
 * var(--color-background) }` in product.css), and `:root` outranks the later
 * `html, body { background: transparent }` rule by specificity. An opaque
 * canvas blocks the macOS window's vibrancy no matter how transparent the DOM
 * below it is, so while glass chrome is active the shell overrides the canvas
 * with an inline style (which outranks any stylesheet rule) and restores the
 * stylesheet value when glass turns off or the shell unmounts.
 *
 * AuthenticatedAppHost can keep StandardWorkspaceShell mounted-but-hidden
 * while MainSidebarPageShell is shown (and vice versa), so this hook can be
 * mounted twice concurrently; a module-level refcount ensures only the first
 * active mount saves the pre-existing inline background and only the last
 * active mount to unmount restores it, instead of each instance racing to
 * save/restore independently and leaving "transparent" stuck.
 */
let activeCount = 0;
let savedBackground: string | null = null;

export function useGlassChromeCanvas(active: boolean): void {
  useEffect(() => {
    if (!active) {
      return;
    }
    const root = document.documentElement;
    if (activeCount === 0) {
      savedBackground = root.style.backgroundColor;
    }
    activeCount += 1;
    root.style.backgroundColor = "transparent";
    return () => {
      activeCount -= 1;
      if (activeCount === 0) {
        root.style.backgroundColor = savedBackground ?? "";
        savedBackground = null;
      }
    };
  }, [active]);
}
