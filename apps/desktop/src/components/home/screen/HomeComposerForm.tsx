import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { HOME_CHAT_COMPOSER_INPUT } from "@/config/chat";
import { CHAT_COMPOSER_LABELS } from "@/copy/chat/chat-copy";
import { ChatComposerActions } from "@/components/workspace/chat/input/ChatComposerActions";
import { ChatComposerControlRowFrame } from "@proliferate/product-ui/chat/composer/ChatComposerControlRowFrame";
import { ChatComposerSurface } from "@proliferate/product-ui/chat/composer/ChatComposerSurface";
import { ComposerTextarea } from "@proliferate/ui/primitives/ComposerTextarea";
import { DebugProfiler } from "@/components/diagnostics/DebugProfiler";
import { useHomeNextComposerState } from "@/hooks/home/ui/use-home-next-composer-state";
import {
  finishOrCancelMeasurementOperation,
  markOperationForNextCommit,
  startMeasurementOperation,
} from "@/lib/infra/measurement/debug-measurement";
import { recordTypingKeystrokeLatency } from "@/lib/infra/measurement/typing-latency-probe";
import type { MeasurementOperationId } from "@/lib/domain/telemetry/debug-measurement-catalog";
import type {
  HomeLaunchTarget,
  HomeNextModelSelection,
  ModelAvailabilityState,
} from "@/lib/domain/home/home-next-launch";

// Surfaces whose React commits are attributed to a home `composer_typing`
// operation. If the render-isolation is working, only "home-composer" should
// cost anything per keystroke — the controls/target/onboarding surfaces should
// stay at ~0ms because their slot elements keep stable identity.
const HOME_TYPING_SURFACES = [
  "home-screen",
  "home-composer",
  "home-composer-controls",
  "home-target-picker",
  "home-onboarding",
] as const;

/**
 * The draft-owning leaf of the home screen.
 *
 * PERF (render isolation): `draft` state lives HERE, not in `HomeNextScreen`, so a
 * keystroke only re-renders this component — the textarea and the submit button.
 * Everything that does NOT depend on the draft (the model/mode/config pickers, the
 * target picker, the onboarding cards, the availability notice) is passed in as an
 * already-constructed element via the *Slot props below. Those elements are created
 * by the parent, which no longer re-renders while typing, so their identity is stable
 * and React skips re-rendering their subtrees on every character.
 *
 * Rule of thumb this demonstrates: to stop a high-frequency state update from
 * re-rendering the world, push the state down to the smallest component that needs it
 * and hand the rest of the tree in as `children`/element props from a parent that
 * isn't re-rendering.
 */
interface HomeComposerFormProps {
  // --- launch readiness (inputs to the composer state hook) ---
  targetDisabledReason: string | null;
  modelAvailabilityState: ModelAvailabilityState;
  canLaunchTarget: boolean;
  modelSelection: HomeNextModelSelection | null;
  modeId: string | null;
  launchControlValues: Record<string, string>;
  launchTarget: HomeLaunchTarget | null;

  // --- stable slots built by the parent (draft-independent → never re-render on keystroke) ---
  /** Leading control-row content (mode pill), stable across keystrokes. */
  controlsSlot: ReactNode;
  /** Trailing control-row content (model/config selector), stable across keystrokes. */
  controlsTrailingSlot?: ReactNode;
  /** The `HomeTargetPicker` row rendered directly under the composer surface. */
  targetPickerSlot: ReactNode;
  /** Model-availability notice (draft-independent), or null. */
  modelAvailabilityNoticeSlot: ReactNode;
  /** CTA rendered next to a submit-disabled reason (e.g. "Configure"), or null. */
  submitDisabledReasonCtaSlot: ReactNode;
  /** The onboarding cards block at the bottom of the screen. */
  onboardingSlot: ReactNode;
}

export function HomeComposerForm({
  targetDisabledReason,
  modelAvailabilityState,
  canLaunchTarget,
  modelSelection,
  modeId,
  launchControlValues,
  launchTarget,
  controlsSlot,
  controlsTrailingSlot,
  targetPickerSlot,
  modelAvailabilityNoticeSlot,
  submitDisabledReasonCtaSlot,
  onboardingSlot,
}: HomeComposerFormProps) {
  const composer = useHomeNextComposerState({
    targetDisabledReason,
    modelAvailabilityState,
    canLaunchTarget,
    modelSelection,
    modeId,
    launchControlValues,
    launchTarget,
  });
  // Cap at maxRows of composer text. Uses the --text-composer--line-height
  // token so the cap tracks the "UI font size" preference at runtime.
  const homeComposerInputMaxHeight =
    `calc(var(--text-composer--line-height) * ${HOME_CHAT_COMPOSER_INPUT.maxRows})`;

  // Measure home-composer typing latency + per-surface commit attribution
  // (no-op unless VITE_PROLIFERATE_DEBUG_MAIN_THREAD is enabled).
  const typingOperationRef = useRef<MeasurementOperationId | null>(null);
  const setDraft = composer.setDraft;
  const handleDraftChange = useCallback((value: string, eventTimeStampMs?: number) => {
    const operationId = startMeasurementOperation({
      kind: "composer_typing",
      sampleKey: "composer",
      surfaces: [...HOME_TYPING_SURFACES],
      idleTimeoutMs: 1500,
      maxDurationMs: 8000,
      cooldownMs: 2000,
    });
    if (operationId) {
      typingOperationRef.current = operationId;
      markOperationForNextCommit(operationId, [...HOME_TYPING_SURFACES]);
    }
    recordTypingKeystrokeLatency({
      operationId,
      surface: "home-composer",
      eventTimeStampMs,
    });
    setDraft(value);
  }, [setDraft]);
  useEffect(() => () => {
    finishOrCancelMeasurementOperation(typingOperationRef.current, "unmount");
    typingOperationRef.current = null;
  }, []);

  return (
    <>
      <DebugProfiler id="home-composer">
        <div className="relative z-10">
        <ChatComposerSurface>
          <form
            className="relative flex flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              if (composer.canSubmit) void composer.submit();
            }}
          >
            <div
              className="mt-3 mb-2 flex-grow select-text overflow-y-auto px-4"
              style={{
                minHeight: `${HOME_CHAT_COMPOSER_INPUT.minHeightRem}rem`,
                maxHeight: homeComposerInputMaxHeight,
              }}
            >
              <ComposerTextarea
                data-telemetry-mask
                data-home-composer-editor
                ref={composer.textareaRef}
                rows={2}
                value={composer.draft}
                onChange={(event) => handleDraftChange(event.target.value, event.timeStamp)}
                onKeyDown={composer.handleKeyDown}
                placeholder={CHAT_COMPOSER_LABELS.placeholder}
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                style={{
                  minHeight: `${HOME_CHAT_COMPOSER_INPUT.minHeightRem}rem`,
                  maxHeight: homeComposerInputMaxHeight,
                }}
              />
            </div>

            <ChatComposerControlRowFrame
              leading={(
                <DebugProfiler id="home-composer-controls">
                  {controlsSlot}
                </DebugProfiler>
              )}
              trailing={controlsTrailingSlot}
              action={(
                <ChatComposerActions
                  isRunning={false}
                  isEmpty={composer.draft.trim().length === 0}
                  isDisabled={!composer.canSubmit}
                  onSubmit={() => { void composer.submit(); }}
                  onCancel={composer.cancel}
                />
              )}
            />
          </form>
        </ChatComposerSurface>
        </div>
      </DebugProfiler>

      <DebugProfiler id="home-target-picker">
        {/* Codex home footer: a tray tucked under the composer (rounded-b,
            sidebar bg) so the selectors read as attached, not floating. */}
        <div className="relative z-0 -mx-px -mt-[18px] flex min-w-0 flex-wrap items-center justify-start gap-1 overflow-hidden rounded-b-2xl bg-sidebar px-2 pb-2 pt-[25px]">
          {targetPickerSlot}
        </div>
      </DebugProfiler>

      {modelAvailabilityNoticeSlot}

      {composer.submitDisabledReason ? (
        <div className="mx-auto mt-2 flex max-w-2xl items-center justify-center gap-2 px-2 text-center text-ui-sm text-muted-foreground">
          <span>{composer.submitDisabledReason}</span>
          {submitDisabledReasonCtaSlot}
        </div>
      ) : null}

      <DebugProfiler id="home-onboarding">
        {onboardingSlot}
      </DebugProfiler>
    </>
  );
}
