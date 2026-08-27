import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { HOME_CHAT_COMPOSER_INPUT } from "#product/config/chat";
import { CHAT_COMPOSER_LABELS } from "#product/copy/chat/chat-copy";
import { ChatComposerActions } from "#product/components/workspace/chat/input/ChatComposerActions";
import { ChatComposerControlRowFrame } from "#product/components/workspace/chat/composer/ChatComposerControlRowFrame";
import { ChatComposerSurface } from "#product/components/workspace/chat/composer/ChatComposerSurface";
import { DebugProfiler } from "#product/components/diagnostics/DebugProfiler";
import { DraftAttachmentPreviewList } from "#product/components/workspace/chat/content/PromptContentRenderer";
import { HomeComposerCommandEditor } from "#product/components/home/screen/HomeComposerCommandEditor";
import { focusChatInputOnActivation } from "#product/lib/domain/focus-zone";
import type { PromptAttachmentController } from "#product/hooks/chat/ui/use-chat-prompt-attachments";
import { useChatInputPaste } from "#product/hooks/chat/ui/use-chat-input-paste";
import { useHomeAvailableSlashCommands } from "#product/hooks/home/derived/use-home-available-slash-commands";
import { useHomeNextComposerState } from "#product/hooks/home/ui/use-home-next-composer-state";
import {
  finishOrCancelMeasurementOperation,
  markOperationForNextCommit,
  startMeasurementOperation,
} from "#product/lib/infra/measurement/measurement-port";
import { recordTypingKeystrokeLatency } from "#product/lib/infra/measurement/measurement-port";
import type { MeasurementOperationId } from "#product/lib/domain/telemetry/debug-measurement-catalog";
import type { HomeModelGate } from "#product/lib/domain/home/home-model-gate";
import type {
  HomeLaunchTarget,
  HomeNextModelSelection,
} from "#product/lib/domain/home/home-next-launch";
import type { ChatComposerEditorSnapshot } from "#product/lib/domain/chat/composer/file-mention-draft-model";

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
 * target picker and availability notice) is passed in as an
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
  modelGate: HomeModelGate;
  canLaunchTarget: boolean;
  modelSelection: HomeNextModelSelection | null;
  launchControlValues: Record<string, string>;
  launchTarget: HomeLaunchTarget | null;
  /** Home-scoped attachment controller owned by `HomeNextScreen` (which also
   * owns the drop target and the hidden file input the `+` button clicks). */
  attachments: PromptAttachmentController;

  // --- stable slots built by the parent (draft-independent → never re-render on keystroke) ---
  /** Leading control-row content (mode pill), stable across keystrokes. */
  controlsSlot: ReactNode;
  /** Trailing control-row content (model/config selector), stable across keystrokes. */
  controlsTrailingSlot?: ReactNode;
  /** The `HomeTargetPicker` row rendered in the utility bar above the composer surface. */
  targetPickerSlot: ReactNode;
  /** Model-availability notice (draft-independent), or null. */
  modelAvailabilityNoticeSlot: ReactNode;
  /** CTA rendered next to a submit-disabled reason (e.g. "Configure"), or null. */
  submitDisabledReasonCtaSlot: ReactNode;
}

export function HomeComposerForm({
  targetDisabledReason,
  modelGate,
  canLaunchTarget,
  modelSelection,
  launchControlValues,
  launchTarget,
  attachments,
  controlsSlot,
  controlsTrailingSlot,
  targetPickerSlot,
  modelAvailabilityNoticeSlot,
  submitDisabledReasonCtaSlot,
}: HomeComposerFormProps) {
  const composer = useHomeNextComposerState({
    targetDisabledReason,
    modelGate,
    canLaunchTarget,
    modelSelection,
    launchControlValues,
    launchTarget,
    attachments,
  });
  const { handleFilePasteCapture, handlePaste } = useChatInputPaste({
    attachments,
    canAcceptPastedAttachments: attachments.canAttachFiles,
  });
  // Cap at maxRows of composer text. Uses the --text-composer--line-height
  // token so the cap tracks the "UI font size" preference at runtime.
  const homeComposerInputMaxHeight =
    `calc(var(--text-composer--line-height) * ${HOME_CHAT_COMPOSER_INPUT.maxRows})`;

  // The slash-command menu's source: the persisted catalog last streamed by a
  // session of the harness this composer will launch (PRO-228).
  const availableCommands = useHomeAvailableSlashCommands(modelSelection?.kind ?? null);
  const [composerOverlayHost, setComposerOverlayHost] = useState<HTMLDivElement | null>(null);

  // Measure home-composer typing latency + per-surface commit attribution
  // (no-op unless VITE_PROLIFERATE_DEBUG_MAIN_THREAD is enabled).
  const typingOperationRef = useRef<MeasurementOperationId | null>(null);
  const setDraft = composer.setDraft;
  const handleDraftChange = useCallback((
    value: string,
    eventTimeStampMs: number | undefined,
    snapshot: ChatComposerEditorSnapshot,
  ) => {
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
    setDraft(value, snapshot);
  }, [setDraft]);
  useEffect(() => () => {
    finishOrCancelMeasurementOperation(typingOperationRef.current, "unmount");
    typingOperationRef.current = null;
  }, []);

  // The home screen opens ready to type: focus the composer on mount, the
  // same contract as the workspace composer's mount focus in `ChatInput`. The
  // activation variant keeps the focus-ownership and hidden-route guards.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      focusChatInputOnActivation();
    }, 50);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <>
      <DebugProfiler id="home-target-picker">
        <div
          className="relative z-0 mx-4 -mb-[18px] flex min-w-0 flex-wrap items-center justify-start gap-1 overflow-hidden rounded-t-2xl bg-surface-elevated-secondary px-2 pb-[25px] pt-1.5"
          data-home-launch-utility-bar
        >
          {targetPickerSlot}
        </div>
      </DebugProfiler>

      <DebugProfiler id="home-composer">
        {/* @container: Home has no ChatComposerDock column, so the composer
            wrapper itself anchors the control row's compact-tier container
            queries (see chat-layout.ts). */}
        <div className="relative z-10 @container" data-focus-zone="chat">
          {/* Slash-menu anchor. Unlike the chat dock (bottom-anchored, grows
              upward in normal flow), the home composer sits mid-screen, so the
              tray is absolutely anchored above the surface to keep the composer
              from shifting while a menu opens. */}
          <div
            ref={setComposerOverlayHost}
            className="absolute inset-x-0 bottom-full z-popover flex flex-col"
          />
          <ChatComposerSurface
            onPasteCapture={handleFilePasteCapture}
            onPaste={handlePaste}
          >
            <form
              className="relative flex flex-col"
              onSubmit={(event) => {
                event.preventDefault();
                if (composer.canSubmit) void composer.submit();
              }}
            >
              <DraftAttachmentPreviewList
                attachments={attachments.attachments}
                onRemove={attachments.removeAttachment}
              />
              <div
                className={`${attachments.hasAttachments ? "" : "mt-3 "}mb-2 flex-grow select-text overflow-y-auto px-4`}
                style={{
                  minHeight: `${HOME_CHAT_COMPOSER_INPUT.minHeightRem}rem`,
                  maxHeight: homeComposerInputMaxHeight,
                }}
              >
                <HomeComposerCommandEditor
                  value={composer.draft}
                  snapshot={composer.editorSnapshot}
                  onChange={handleDraftChange}
                  onKeyDown={composer.handleKeyDown}
                  canSubmit={composer.canSubmit}
                  onSubmit={() => { void composer.submit(); }}
                  onSubmitRefused={composer.refuseSubmit}
                  placeholder={CHAT_COMPOSER_LABELS.placeholder}
                  availableCommands={availableCommands}
                  overlayHostElement={composerOverlayHost}
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
                    isEmpty={composer.isEmpty}
                    isDisabled={!composer.canSubmit}
                    disabledReason={composer.sendBlockedReason}
                    onSubmit={() => { void composer.submit(); }}
                    onCancel={composer.cancel}
                  />
                )}
              />
            </form>
          </ChatComposerSurface>
        </div>
      </DebugProfiler>

      {/* selection_required has no visible notice (owner revision r2), so this
          region is the ONLY thing that reports a refused Enter. It is mounted
          unconditionally: a live region created at the same moment its text
          appears is not reliably announced. */}
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        data-home-model-gate-announcement
      >
        {composer.refusalAnnouncement}
      </div>

      {modelAvailabilityNoticeSlot}

      {composer.submitDisabledReason ? (
        <div className="mx-auto mt-2 flex max-w-2xl items-center justify-center gap-2 px-2 text-center text-ui-sm text-muted-foreground">
          <span>{composer.submitDisabledReason}</span>
          {submitDisabledReasonCtaSlot}
        </div>
      ) : null}
    </>
  );
}
