import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import {
  CHAT_COMPOSER_INPUT,
  CHAT_COMPOSER_INPUT_LINE_HEIGHT_REM,
  CHAT_COMPOSER_LABELS,
} from "@/config/chat";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useActiveChatSessionState } from "@/hooks/chat/use-active-chat-session-state";
import { useChatAvailabilityState } from "@/hooks/chat/use-chat-availability-state";
import { useChatComposerKeyboard } from "@/hooks/chat/use-chat-composer-keyboard";
import { useChatDraftState } from "@/hooks/chat/use-chat-draft-state";
import { useChatModelSelectorState } from "@/hooks/chat/use-chat-model-selector-state";
import { useChatPermissionActions } from "@/hooks/chat/use-chat-permission-actions";
import { useChatPromptActions } from "@/hooks/chat/use-chat-prompt-actions";
import { useChatSessionControls } from "@/hooks/chat/use-chat-session-controls";
import { useActivePlan } from "@/hooks/chat/use-active-plan";
import { ChatComposerActions } from "./ChatComposerActions";
import { ModelSelector } from "./ModelSelector";
import { InlinePermissionPrompt } from "@/components/workspace/chat/session/PermissionOverlay";
import { SessionConfigControls } from "./SessionConfigControls";
import { Textarea } from "@/components/ui/Textarea";
import { ChatComposerSurface } from "./ChatComposerSurface";
import { resolvePermissionPromptPresentation } from "@/lib/domain/chat/permission-prompt";

interface ChatInputProps {
  topSlot?: ReactNode;
}

export function ChatInput({ topSlot }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const workspaceSelectionNonce = useHarnessStore((state) => state.workspaceSelectionNonce);
  const {
    activeSessionId,
    currentModeLabel,
    isRunning,
    pendingApproval,
    pendingApprovalActions,
  } = useActiveChatSessionState();
  const { selectedWorkspaceId, draft, setDraft, isEmpty } = useChatDraftState();
  const { isDisabled, areRuntimeControlsDisabled } = useChatAvailabilityState();
  const modelSelectorProps = useChatModelSelectorState();
  const { agentKind, controls: sessionConfigControls, modeControl } = useChatSessionControls();
  const { handleSubmit, handleCancel } = useChatPromptActions();
  const activePlan = useActivePlan();
  const {
    handleSelectPermissionOption,
    handleAllowPermission,
    handleDenyPermission,
  } = useChatPermissionActions();
  const canSubmit = !isEmpty && !isDisabled && !isRunning;
  const { handleKeyDown } = useChatComposerKeyboard({
    handleSubmit,
    handleCancel,
    isRunning,
    canSubmit,
    modeControl,
  });
  const permissionPresentation = pendingApproval
    ? resolvePermissionPromptPresentation({
      title: pendingApproval.title,
      toolCallId: pendingApproval.toolCallId ?? null,
      currentModeLabel,
    })
    : null;
  const shouldReplaceComposerWithPermission =
    pendingApproval !== null
    && permissionPresentation?.replaceComposer === true;
  const shouldMergePermissionIntoPlanPanel =
    !!topSlot
    && pendingApproval !== null
    && activePlan?.sourceKind === "mode_switch";

  useEffect(() => {
    if ((!selectedWorkspaceId && !activeSessionId) || isDisabled || shouldReplaceComposerWithPermission) {
      return;
    }

    const timer = window.setTimeout(() => {
      textareaRef.current?.focus({ preventScroll: true });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [
    activeSessionId,
    isDisabled,
    selectedWorkspaceId,
    shouldReplaceComposerWithPermission,
    workspaceSelectionNonce,
  ]);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }

    const lineHeightPx = parseFloat(getComputedStyle(el).lineHeight);
    if (!Number.isFinite(lineHeightPx) || lineHeightPx <= 0) {
      return;
    }

    const minPx = lineHeightPx * CHAT_COMPOSER_INPUT.minRows;
    const maxPx = lineHeightPx * CHAT_COMPOSER_INPUT.maxRows;
    el.style.height = "auto";
    const contentHeight = el.scrollHeight;
    const next = Math.min(maxPx, Math.max(minPx, contentHeight));
    el.style.height = `${next}px`;
    el.style.overflowY = contentHeight > maxPx ? "auto" : "hidden";
  }, [draft]);

  return (
    <div className="pb-4 px-4 relative shrink-0" data-telemetry-block data-focus-zone="chat">
      <div className="relative max-w-3xl mx-auto @container">
        {pendingApproval && !shouldReplaceComposerWithPermission && !shouldMergePermissionIntoPlanPanel && (
          <InlinePermissionPrompt
            title={pendingApproval.title}
            toolCallId={pendingApproval.toolCallId ?? null}
            modeLabel={currentModeLabel}
            actions={pendingApprovalActions}
            onSelectOption={handleSelectPermissionOption}
            onAllow={handleAllowPermission}
            onDeny={handleDenyPermission}
          />
        )}

        {topSlot && <div className="relative z-10">{topSlot}</div>}
        <ChatComposerSurface flatTop={!!topSlot} onClick={() => textareaRef.current?.focus()}>
          {shouldReplaceComposerWithPermission && pendingApproval ? (
            <InlinePermissionPrompt
              title={pendingApproval.title}
              toolCallId={pendingApproval.toolCallId ?? null}
              modeLabel={currentModeLabel}
              actions={pendingApprovalActions}
              onSelectOption={handleSelectPermissionOption}
              onAllow={handleAllowPermission}
              onDeny={handleDenyPermission}
              embeddedInComposer
            />
          ) : (
            <form className="relative flex flex-col">
              <div
                className="mb-2 flex-grow select-text overflow-y-auto px-5 pt-3.5"
                style={{
                  minHeight: `${CHAT_COMPOSER_INPUT.minRows * CHAT_COMPOSER_INPUT_LINE_HEIGHT_REM}rem`,
                  maxHeight: `${CHAT_COMPOSER_INPUT.maxRows * CHAT_COMPOSER_INPUT_LINE_HEIGHT_REM}rem`,
                }}
              >
                <Textarea
                  data-telemetry-mask
                  ref={textareaRef}
                  variant="ghost"
                  rows={CHAT_COMPOSER_INPUT.minRows}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={CHAT_COMPOSER_LABELS.placeholder}
                  spellCheck={false}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  style={{
                    maxHeight: `${CHAT_COMPOSER_INPUT.maxRows * CHAT_COMPOSER_INPUT_LINE_HEIGHT_REM}rem`,
                  }}
                  className="min-h-0 px-0 py-0 text-base leading-relaxed text-foreground placeholder:text-muted-foreground/70"
                />
              </div>

              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1 px-2 pb-2">
                <div
                  className={`flex min-w-0 flex-nowrap items-center gap-1 ${
                    areRuntimeControlsDisabled ? "pointer-events-none opacity-55" : ""
                  }`}
                >
                  <ModelSelector {...modelSelectorProps} />
                  <SessionConfigControls agentKind={agentKind} controls={sessionConfigControls} />
                </div>

                <div className="flex items-center">
                  <ChatComposerActions
                    isRunning={isRunning}
                    isEmpty={isEmpty}
                    isDisabled={isDisabled}
                    onSubmit={handleSubmit}
                    onCancel={handleCancel}
                  />
                </div>
              </div>
            </form>
          )}
        </ChatComposerSurface>
      </div>
    </div>
  );
}
