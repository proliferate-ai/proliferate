import { type ReactNode } from "react";
import {
  CHAT_COMPOSER_INPUT_LINE_HEIGHT_CSS,
  HOME_CHAT_COMPOSER_INPUT,
} from "@/config/chat";
import { ChatComposerActions } from "@/components/workspace/chat/input/ChatComposerActions";
import { ChatComposerSurface } from "@proliferate/product-ui/chat/composer/ChatComposerSurface";
import { ComposerTextarea } from "@proliferate/ui/primitives/ComposerTextarea";
import { UserMessage } from "@/components/workspace/chat/transcript/UserMessage";
import { useHomeNextComposerState } from "@/hooks/home/ui/use-home-next-composer-state";
import type {
  HomeLaunchTarget,
  HomeNextModelSelection,
  ModelAvailabilityState,
} from "@/lib/domain/home/home-next-launch";

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
  /** Model / mode / session-config pickers rendered on the left of the control row. */
  controlsSlot: ReactNode;
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
  const homeComposerInputMaxHeight =
    `calc(${CHAT_COMPOSER_INPUT_LINE_HEIGHT_CSS} * ${HOME_CHAT_COMPOSER_INPUT.maxRows})`;

  return (
    <>
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
              rows={4}
              value={composer.draft}
              onChange={(event) => composer.setDraft(event.target.value)}
              onKeyDown={composer.handleKeyDown}
              placeholder="Describe a task"
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

          <div className="mb-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-[5px] px-2">
            <div className="flex min-w-0 flex-wrap items-center gap-[5px]">
              {controlsSlot}
            </div>

            <div className="flex items-center">
              <ChatComposerActions
                isRunning={false}
                isEmpty={composer.draft.trim().length === 0}
                isDisabled={!composer.canSubmit}
                onSubmit={() => { void composer.submit(); }}
                onCancel={composer.cancel}
              />
            </div>
          </div>
        </form>
      </ChatComposerSurface>

      <div className="mt-2 flex min-w-0 flex-wrap items-center justify-start gap-[5px] px-2">
        {targetPickerSlot}
      </div>

      {composer.submittedPreview ? (
        <div
          key={composer.submittedPreview.id}
          className="mt-5"
          data-home-submit-preview
        >
          <UserMessage
            sessionId={null}
            content={composer.submittedPreview.text}
            contentParts={[{ type: "text", text: composer.submittedPreview.text }]}
          />
        </div>
      ) : null}

      {modelAvailabilityNoticeSlot}

      {composer.submitDisabledReason ? (
        <div className="mx-auto mt-2 flex max-w-2xl items-center justify-center gap-2 px-2 text-center text-sm text-muted-foreground">
          <span>{composer.submitDisabledReason}</span>
          {submitDisabledReasonCtaSlot}
        </div>
      ) : null}

      {onboardingSlot}
    </>
  );
}
