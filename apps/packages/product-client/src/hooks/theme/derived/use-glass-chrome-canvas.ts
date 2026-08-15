import { useEffect } from "react";

/**
 * The design system paints the page canvas opaque (`:root { background:
 * var(--color-background) }` in product.css), and `:root` outranks the later
 * `html, body { background: transparent }` rule by specificity. An opaque
 * canvas blocks the macOS window's vibrancy no matter how transparent the DOM
 * below it is, so while glass chrome is active the shell overrides the canvas
 * with an inline style (which outranks any stylesheet rule) and restores the
 * stylesheet value when glass turns off or the shell unmounts.
 */
export function useGlassChromeCanvas(active: boolean): void {
  useEffect(() => {
    if (!active) {
      return;
    }
    const root = document.documentElement;
    const previous = root.style.backgroundColor;
    root.style.backgroundColor = "transparent";
    return () => {
      root.style.backgroundColor = previous;
    };
  }, [active]);
}
