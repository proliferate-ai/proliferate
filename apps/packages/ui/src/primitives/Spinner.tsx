export interface SpinnerProps {
  className?: string;
}

/**
 * The single spinning-loader primitive (~29 call sites).
 *
 * Rotation invariants, all load-bearing. The animation half lives in the
 * generated theme's `.proliferate-spinner > svg` rule:
 *
 * 1. **The wrapper never rotates.** Callers pass glyph-tier classes
 *    (`icon-paired`, `icon-control`, …) that size this box, and some
 *    historically also passed `animate-spin`. Rotating the inline box changes
 *    its transformed bounding box every frame, which is what makes a compact
 *    tab or sidebar spinner appear to orbit. `.proliferate-spinner`'s
 *    `animation: none !important` neutralizes any such class.
 * 2. **`aspect-square` pins the box square.** The glyph tiers are `em`-based
 *    (`--icon-paired` is `1.230769em`), so a spinner placed in a flex or grid
 *    parent that stretches one axis resolves a non-square box. `size-full`
 *    then makes the SVG non-square too, and a rotating non-square box sweeps
 *    an arc wider than its own footprint, which reads as wobble.
 * 3. **The SVG owns the rotation, about its own view box.** The rotation
 *    origin must resolve against the `0 0 24 24` view box, whose exact centre
 *    is (12,12) and where both drawn paths are exactly centred (their combined
 *    bounding box is [4,20]×[4,20]). `fill-box` is not a well-defined
 *    reference box on an `<svg>` root, so the origin is set in CSS through
 *    `transform-box: view-box` and is deliberately never authored inline here.
 */
export function Spinner({ className }: SpinnerProps) {
  return (
    <div
      className={`proliferate-spinner inline-grid aspect-square flex-none place-items-center align-middle leading-none ${className ?? ""}`}
      data-loading-spinner
    >
      <svg
        aria-hidden="true"
        className="block size-full"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Faint full-ring track. Bounding box is exactly [4,20]×[4,20]. */}
        <path
          opacity="0.3"
          d="M18 12C18 8.68629 15.3137 6 12 6C8.68629 6 6 8.68629 6 12C6 15.3137 8.68629 18 12 18C15.3137 18 18 15.3137 18 12ZM20 12C20 16.4183 16.4183 20 12 20C7.58172 20 4 16.4183 4 12C4 7.58172 7.58172 4 12 4C16.4183 4 20 7.58172 20 12Z"
          fill="currentColor"
        />
        {/* Solid ~270° arc over the track; the moving 90° gap reads as motion. */}
        <path
          d="M12 4C16.4183 4 20 7.58172 20 12C20 16.4183 16.4183 20 12 20C7.58172 20 4 16.4183 4 12H6C6 15.3137 8.68629 18 12 18C15.3137 18 18 15.3137 18 12C18 8.68629 15.3137 6 12 6V4Z"
          fill="currentColor"
        />
      </svg>
    </div>
  );
}
