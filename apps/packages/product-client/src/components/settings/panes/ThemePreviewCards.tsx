import { useId, useRef, type FC, type KeyboardEvent } from "react";
import { themePreviewColors } from "@proliferate/design/tokens";
import { Button } from "#product/primitives/Button";
import { Check } from "#product/primitives/icons/core";
import { twMerge } from "#product/primitives/utils/tw-merge";
import type { ColorMode } from "#product/config/theme";

/**
 * Theme picker for the Appearance pane: one preview card per color mode.
 *
 * A segmented control could only name the modes; a card can show them. Each
 * card carries a miniature of the app drawn in that mode's values, so the
 * choice is made by recognition rather than by reading three words. That is
 * also why the artwork is fixed grayscale from `themePreviewColors` instead of
 * the theme custom properties every other surface resolves through — a Light
 * card that went dark along with the app would depict the mode you are leaving,
 * not the one you are picking.
 *
 * Selection follows `RadioCardGroup`'s idiom exactly (a `border-special` frame
 * plus a filled check chip) rather than inventing a second one. A white outline
 * was tried and rejected: against the dark artwork it reads as a rendering
 * seam, not as a state.
 */

const { light, dark } = themePreviewColors;

const MODE_LABELS: Record<ColorMode, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

/**
 * The mini-app is the same drawing in both palettes: a title pill and a
 * subtitle pill on the page ground, then a sheet holding three rows of
 * pill-and-hairline content. Only the fills change between Light and Dark,
 * which is the point — the shape is the constant, the palette is the variable.
 */
function ModeArtwork({ palette }: { palette: { ground: string; sheet: string; pillStrong: string; pill: string; hairline: string } }) {
  return (
    <>
      <rect x="0" y="0" width="170" height="120" fill={palette.ground} />
      <path fill={palette.pillStrong} d="M49 26h72a3 3 0 0 1 0 6H49a3 3 0 0 1 0-6Z" />
      <path fill={palette.pill} d="M28 35h114a2 2 0 0 1 0 4H28a2 2 0 0 1 0-4Z" />
      <path fill={palette.sheet} d="M15 52a8 8 0 0 1 8-8h124a8 8 0 0 1 8 8v68H15V52Z" />
      <path fill={palette.pill} d="M22 59a3 3 0 0 1 3-3h39a3 3 0 0 1 0 6H25a3 3 0 0 1-3-3Z" />
      <path fill={palette.hairline} d="M22 67h65v2H22zM15 76h140v1H15z" />
      <path fill={palette.pill} d="M22 83a3 3 0 0 1 3-3h39a3 3 0 0 1 0 6H25a3 3 0 0 1-3-3Z" />
      <path fill={palette.hairline} d="M22 91h65v2H22zM15 100h140v1H15z" />
      <path fill={palette.pill} d="M22 107a3 3 0 0 1 3-3h39a3 3 0 0 1 0 6H25a3 3 0 0 1-3-3Z" />
      <path fill={palette.hairline} d="M22 115h65v2H22z" />
    </>
  );
}

const LIGHT_ARTWORK = (
  <ModeArtwork
    palette={{
      ground: light.ground,
      sheet: light.sheet,
      pillStrong: light.pillStrong,
      pill: light.pill,
      hairline: light.hairline,
    }}
  />
);

const DARK_ARTWORK = (
  <ModeArtwork
    palette={{
      ground: dark.ground,
      sheet: dark.sheet,
      // The header pills sit on the page ground and the row pills sit on the
      // sheet, so dark's two pill rungs swap roles relative to light's: the
      // brighter rung is the one that has to carry contrast against the sheet.
      pillStrong: dark.pill,
      pill: dark.pillStrong,
      hairline: dark.hairline,
    }}
  />
);

/**
 * System is not a third palette — it is the other two, split down the middle.
 * The drawing is redrawn rather than composed from two halves of `ModeArtwork`
 * because the seam has to fall inside shapes (a pill is half light and half
 * dark), which a clip of two complete drawings cannot produce.
 */
const SystemArtwork: FC = () => {
  // The clip id must be unique per mounted instance: a duplicated DOM id would
  // make a second card's clipPath resolve to the first instance's node.
  const clipId = useId();
  return (
  <>
    <defs>
      <clipPath id={clipId}>
        <path d="M7 42a8 8 0 0 1 8-8h140a8 8 0 0 1 8 8v78H7V42Z" />
      </clipPath>
    </defs>
    <rect x="0" y="0" width="85" height="120" fill={light.ground} />
    <rect x="85" y="0" width="85" height="120" fill={dark.groundSplit} />
    <g clipPath={`url(#${clipId})`}>
      <path fill={light.sheetAlt} d="M7 34h78v86H7z" />
      <path fill={dark.ground} d="M85 34h78v86H85z" />
      <path fill={light.pillStrong} d="M73 59h12v6H73a3 3 0 0 1 0-6Z" />
      <path fill={dark.pillStrong} d="M85 59h9a3 3 0 0 1 0 6h-9Z" />
      <path fill={light.pill} d="M53 68h32v3H53z" />
      <path fill={dark.pill} d="M85 68h32v3H85z" />
      <path fill={light.sheet} d="M26 84a7 7 0 0 1 7-7h52v43H26V84Z" />
      <path fill={dark.sheet} d="M85 77h52a7 7 0 0 1 7 7v36H85V77Z" />
      <path fill={light.pill} d="M32 88a3 3 0 0 1 3-3h29a3 3 0 0 1 0 6H35a3 3 0 0 1-3-3Z" />
      <path fill={dark.pillStrong} d="M103 88a3 3 0 0 1 3-3h29a3 3 0 0 1 0 6h-29a3 3 0 0 1-3-3Z" />
      <path fill={light.hairline} d="M32 96h53v2H32zM26 105h59v1H26z" />
      <path fill={dark.pill} d="M85 96h53v2H85zM85 105h53v2H85z" />
      <path fill={light.pill} d="M32 114a3 3 0 0 1 3-3h29a3 3 0 0 1 0 6H35a3 3 0 0 1-3-3Z" />
      <path fill={dark.pillStrong} d="M103 114a3 3 0 0 1 3-3h29a3 3 0 0 1 0 6h-29a3 3 0 0 1-3-3Z" />
    </g>
  </>
  );
};

const MODE_ARTWORK: Record<ColorMode, FC> = {
  system: SystemArtwork,
  light: () => LIGHT_ARTWORK,
  dark: () => DARK_ARTWORK,
};

/** Card order reads light-to-dark with the deferring option first. */
const CARD_ORDER: readonly ColorMode[] = ["system", "light", "dark"];

export interface ThemePreviewCardsProps {
  value: ColorMode;
  onChange: (mode: ColorMode) => void;
}

export function ThemePreviewCards({ value, onChange }: ThemePreviewCardsProps) {
  // Roving tabindex pattern: the selected radio gets tabIndex={0}, the others
  // get tabIndex={-1}. Keyboard navigation moves both selection and focus.
  const buttonRefs = useRef(new Map<ColorMode, HTMLButtonElement>());

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // A modified arrow is somebody else's chord, not ours: ⌘⌥←/→ are the
    // registered prev/next-tab accelerators. The global dispatcher normally
    // eats those in the capture phase, but an unconsumed chord would otherwise
    // fall through to here and silently retarget the user's theme. WAI-ARIA
    // radio groups ignore modified arrows.
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
      return;
    }

    const currentIndex = CARD_ORDER.indexOf(value);
    let nextIndex: number | undefined;

    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIndex = (currentIndex + 1) % CARD_ORDER.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex = (currentIndex - 1 + CARD_ORDER.length) % CARD_ORDER.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = CARD_ORDER.length - 1;
        break;
    }

    if (nextIndex !== undefined) {
      event.preventDefault();
      const nextMode = CARD_ORDER[nextIndex];
      onChange(nextMode);
      // Selection follows focus: move focus to the newly selected radio.
      buttonRefs.current.get(nextMode)?.focus();
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="grid w-full grid-cols-3 gap-3"
      onKeyDown={handleKeyDown}
    >
      {CARD_ORDER.map((mode) => {
        const selected = value === mode;
        const Artwork = MODE_ARTWORK[mode];
        return (
          <Button
            key={mode}
            ref={(el) => {
              if (el) {
                buttonRefs.current.set(mode, el);
              } else {
                buttonRefs.current.delete(mode);
              }
            }}
            type="button"
            variant="unstyled"
            size="unstyled"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            data-selected={selected ? "" : undefined}
            className="group flex min-w-0 flex-col items-center gap-1.5 rounded-lg text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            onClick={() => onChange(mode)}
          >
            <span
              className={twMerge(
                "relative block w-full overflow-hidden rounded-lg border transition-colors",
                selected ? "border-special" : "border-border group-hover:border-muted-foreground",
              )}
              // 17:12 is the app window's own proportion, so the miniature is a
              // scale model rather than a differently shaped picture of one.
              style={{ aspectRatio: "17 / 12" }}
            >
              {/*
               * The ground is painted by a full-bleed rect INSIDE the svg with
               * `preserveAspectRatio="none"`, not by a background on this span.
               * A backing layer shows through the rounded corners as a rim of
               * the wrong color at exactly the radius the border draws.
               */}
              <svg viewBox="0 0 170 120" preserveAspectRatio="none" className="block h-full w-full" aria-hidden="true">
                <Artwork />
              </svg>
              {selected ? (
                <span className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-special text-background">
                  <Check className="icon-compact" strokeWidth={3} />
                </span>
              ) : null}
            </span>
            <span
              className={twMerge(
                "text-ui-sm transition-colors",
                selected ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {MODE_LABELS[mode]}
            </span>
          </Button>
        );
      })}
    </div>
  );
}
