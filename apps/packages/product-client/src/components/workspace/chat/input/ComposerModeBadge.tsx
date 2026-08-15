import {
  getNextSessionModeValue,
  getPreviousSessionModeValue,
  resolveSessionControlPresentation,
} from "#product/lib/domain/chat/session-controls/session-mode-control";
import {
  appendSessionControlStepHint,
  resolveSessionControlTooltip,
} from "#product/lib/domain/chat/session-controls/session-toggle-control";
import type { LiveSessionControlDescriptor } from "#product/lib/domain/chat/session-controls/session-controls";
import type { ConfiguredSessionControlKey } from "#product/lib/domain/chat/session-controls/presentation";
import { SessionControlIcon } from "#product/components/workspace/chat/session-controls/SessionControlIcon";
import { Tooltip } from "#product/primitives/Tooltip";
import { ComposerControlButton } from "#product/primitives/patterns/composer/ComposerControlButton";
import {
  PendingConfigIndicator,
  showsPendingConfigIndicator,
} from "#product/components/workspace/chat/input/PendingConfigIndicator";

type ModeControlDescriptor = LiveSessionControlDescriptor & {
  key: ConfiguredSessionControlKey;
};

interface ComposerModeBadgeProps {
  agentKind: string | null;
  control: ModeControlDescriptor;
  /** Merged onto the trigger button (e.g. the disabled-state opacity). */
  className?: string;
}

/**
 * The composer's working-mode control: the mode's glyph and nothing else,
 * stepping to the next mode on click. Replaces SessionModeControl's
 * `triggerStyle="value"` trigger in the composer row; the full-menu
 * SessionModeControl survives for the settings surfaces.
 *
 * The badge carries no word at any width, so the mode change has to be
 * legible from the glyph swap alone — hence the keyed remount (drop-in
 * animation) plus a tooltip that stays open through the click and reports the
 * mode you just landed on.
 */
export function ComposerModeBadge({
  agentKind,
  control,
  className = "",
}: ComposerModeBadgeProps) {
  const currentOption = control.options.find((option) => option.selected) ?? null;
  const currentValue = currentOption?.value ?? null;
  const presentation = resolveSessionControlPresentation(
    agentKind,
    control.key,
    currentValue,
  );
  const shortLabel = presentation.shortLabel
    ?? currentOption?.label
    ?? control.detail
    ?? control.label;
  const nextValue = getNextSessionModeValue(control.options, currentValue);
  const previousValue = getPreviousSessionModeValue(control.options, currentValue);
  // `control.label`, not a literal "Permissions": SESSION_CONTROL_LABELS
  // already spells the permissions control "Permissions" and the
  // collaboration control "Mode", so the descriptor's own word is the ruled
  // copy for the one and stays honest for the other.
  // The accessible name carries the mode itself; the pointer hint is a mouse
  // affordance, so it rides only the tooltip and title — same split as
  // ComposerEffortStepper's aria-label.
  const accessibleName = resolveSessionControlTooltip(
    control.label,
    shortLabel,
    currentOption?.description ?? null,
  );
  const tooltip = appendSessionControlStepHint(accessibleName, "switch");

  const badge = (
    <ComposerControlButton
      iconOnly
      disabled={!control.settable || !nextValue}
      className={className}
      icon={(
        // Keyed on the mode value so the glyph remounts (and replays the
        // drop-in) on every step rather than mutating in place.
        <span key={currentValue ?? ""} className="composer-mode-badge-glyph flex">
          <SessionControlIcon
            icon={presentation.icon}
            className="shrink-0 icon-control [font-size:var(--text-body)]"
          />
        </span>
      )}
      label={shortLabel}
      aria-label={accessibleName}
      title={tooltip}
      data-session-mode-trigger=""
      data-session-mode-selected={currentValue ?? ""}
      data-session-mode-next={nextValue ?? ""}
      data-session-mode-previous={previousValue ?? ""}
      onClick={nextValue
        ? (event) => {
          if ((event.metaKey || event.ctrlKey) && previousValue) {
            control.onSelect(previousValue);
            return;
          }
          control.onSelect(nextValue);
        }
        : undefined}
    />
  );

  if (showsPendingConfigIndicator(control.pendingState)) {
    return (
      <Tooltip content={tooltip} keepOpenOnPress>
        <span className="inline-flex items-center gap-1">
          {badge}
          <PendingConfigIndicator pendingState={control.pendingState} />
        </span>
      </Tooltip>
    );
  }

  return <Tooltip content={tooltip} keepOpenOnPress>{badge}</Tooltip>;
}
