import { useLocation } from "react-router-dom";
import { APP_ROUTES } from "#product/config/app-routes";
import {
  getSteppedReasoningEffortValue,
  resolveReasoningEffortPresentation,
} from "#product/lib/domain/chat/session-controls/session-reasoning-effort-control";
import {
  appendSessionControlStepHint,
  resolveSessionControlTooltip,
} from "#product/lib/domain/chat/session-controls/session-toggle-control";
import { COMPOSER_COMPACT_HIDDEN_CLASSNAME } from "#product/config/chat-layout";
import type { LiveSessionControlDescriptor } from "#product/lib/domain/chat/session-controls/session-controls";
import { Tooltip } from "#product/primitives/Tooltip";
import { AnimatedSwapText } from "#product/primitives/AnimatedSwapText";
import { ComposerControlButton } from "#product/primitives/patterns/composer/ComposerControlButton";
import { useShortcutHandler } from "#product/hooks/shortcuts/lifecycle/use-shortcut-handler";

interface ComposerEffortStepperProps {
  control: LiveSessionControlDescriptor;
}

// The ladder is a fixed six-bar glyph, not one bar per option: the icon keeps
// the same width whatever ladder the model exposes, so the row never reflows
// when a model with a different option count is selected. Lit count is the
// level's own index + 1 (ruled), so a short ladder simply never lights the top
// bars.
const LADDER_BAR_COUNT = 6;
const LADDER_BAR_PITCH = 4;
const LADDER_BAR_WIDTH = 2;
// Per-bar delay of the lit-state crossfade. Local, not a motion token: it only
// staggers the six bars inside a single 240ms transition, not an
// interaction-scale duration role.
const LADDER_LIT_STAGGER_MS = 30;

/**
 * The composer's reasoning-effort control: a six-bar ladder that steps to the
 * next level on click and wraps at the top; ⌘/Ctrl click steps back and wraps
 * at the bottom (⌃⇧E / ⌃⌥⇧E mirror both from the keyboard). No popover and no
 * menu — the glyph is both the readout and the affordance. Replaces
 * ComposerReasoningEffortBars in the composer row.
 */
export function ComposerEffortStepper({ control }: ComposerEffortStepperProps) {
  const currentIndex = control.options.findIndex((option) => option.selected);
  const effectiveIndex = currentIndex >= 0 ? currentIndex : 0;
  const currentOption = control.options[effectiveIndex] ?? null;
  const currentPresentation = resolveReasoningEffortPresentation(
    currentOption?.value ?? null,
    currentOption?.label,
  );
  const currentLevel =
    currentPresentation.shortLabel ?? control.detail ?? control.label;
  const ariaLabel = `Reasoning: ${currentLevel}`;
  const tooltip = appendSessionControlStepHint(
    resolveSessionControlTooltip(
      "Reasoning",
      currentLevel,
      currentOption?.description ?? null,
    ),
    "step",
  );

  // A one-rung ladder has nowhere to step: stepping it would re-select the
  // level that is already selected. Same guard shape as ComposerModeBadge's
  // `nextValue` — the control renders, reads, and is disabled.
  const canStep = control.options.length >= 2;

  const handleStep = (direction: 1 | -1) => {
    const steppedValue = getSteppedReasoningEffortValue(control.options, direction);
    if (steppedValue !== null) {
      control.onSelect(steppedValue);
    }
  };

  // ⌃⇧E steps the same transition as clicking the ladder, dispatched through
  // the global shortcut registry so it works wherever focus sits — the same
  // main-screen gate as the model selector's ⌃⇧M. ⌃⌥⇧E mirrors it backward.
  const location = useLocation();
  const shortcutEnabled = location.pathname === APP_ROUTES.home && control.settable && canStep;
  useShortcutHandler("workspace.cycle-reasoning-effort", () => handleStep(1), {
    enabled: shortcutEnabled,
    priority: "contextual",
  });
  useShortcutHandler("workspace.cycle-reasoning-effort-back", () => handleStep(-1), {
    enabled: shortcutEnabled,
    priority: "contextual",
  });

  return (
    <Tooltip content={tooltip} keepOpenOnPress>
      <ComposerControlButton
        size="compact"
        icon={<EffortLadderGlyph litCount={effectiveIndex + 1} />}
        label={(
          <AnimatedSwapText
            valueKey={currentOption?.value ?? currentLevel}
            value={currentLevel}
          />
        )}
        // Compact tier: the level word yields, the bars keep reading the level.
        labelWrapperClassName={COMPOSER_COMPACT_HIDDEN_CLASSNAME}
        className="gap-1"
        disabled={!control.settable || !canStep}
        title={tooltip}
        aria-label={ariaLabel}
        data-reasoning-effort-trigger=""
        data-reasoning-effort-selected={currentOption?.value ?? ""}
        onClick={canStep
          ? (event) => handleStep(event.metaKey || event.ctrlKey ? -1 : 1)
          : undefined}
      />
    </Tooltip>
  );
}

// Width derived from the glyph's own viewBox, never authored: the height comes
// from a semantic tier, so the only thing left to say is the ladder's shape.
const LADDER_WIDTH_FROM_HEIGHT = "calc(var(--icon-paired) * 22 / 15)";

function EffortLadderGlyph({ litCount }: { litCount: number }) {
  return (
    <svg
      viewBox="0 0 22 15"
      fill="none"
      // Same semantic sizing idiom as the pressure ring: HEIGHT is the paired
      // icon tier pinned to the composer's own control text (--text-ui), and
      // WIDTH is derived from the 22:15 viewBox rather than authored. At the
      // default scale --text-ui is 13px and --icon-paired is 1.230769em, so the
      // glyph renders 16px tall and 16 × 22/15 = 23.5px wide — the ruled 22×15
      // to within a pixel, at a single uniform 16/15 scale that keeps the bar
      // geometry exact. Every Appearance step moves both dimensions together
      // through the tier, so no 13px divisor survives in this file.
      className="block shrink-0 icon-paired [font-size:var(--text-ui)]"
      style={{ width: LADDER_WIDTH_FROM_HEIGHT }}
      aria-hidden="true"
      data-reasoning-effort-ladder
      data-reasoning-effort-ladder-lit={litCount}
    >
      {Array.from({ length: LADDER_BAR_COUNT }, (_, i) => (
        <rect
          key={i}
          x={i * LADDER_BAR_PITCH}
          y={10 - (i * 2)}
          width={LADDER_BAR_WIDTH}
          height={5 + (i * 2)}
          rx={1}
          fill="currentColor"
          className="composer-effort-ladder-bar"
          // Inline, not a utility: both values are per-bar computations. The
          // stagger exists so the lit edge travels up the ladder instead of
          // the whole icon changing state at once.
          style={{
            opacity: i < litCount ? 1 : 0.3,
            transitionDelay: `${i * LADDER_LIT_STAGGER_MS}ms`,
          }}
        />
      ))}
    </svg>
  );
}
