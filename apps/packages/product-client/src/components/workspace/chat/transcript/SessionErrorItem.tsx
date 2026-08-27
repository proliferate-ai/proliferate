import { useState } from "react";
import type { ErrorItem } from "@anyharness/sdk";
import { Button } from "#product/primitives/Button";
import { CircleAlert } from "#product/primitives/icons/status";
import { CircleQuestion } from "#product/primitives/icons/core";
import { RefreshCw } from "#product/primitives/icons/platform";
import { useSessionModelFallbackAction } from "#product/hooks/sessions/workflows/use-session-model-fallback-action";
import { useSessionCreationActions } from "#product/hooks/sessions/workflows/use-session-creation-actions";
import { presentSessionError } from "#product/domain/chats/transcript/session-error-presentation";
import { useToastStore } from "#product/stores/toast/toast-store";
import { useChatInputStore } from "#product/stores/chat/chat-input-store";
import { useModelSupportStore } from "#product/stores/chat/model-support-store";
import { getSessionRecord } from "#product/stores/sessions/session-records";
import { useConnectivityStore } from "#product/stores/infra/connectivity-store";

export function SessionErrorItem({
  item,
  sessionId,
}: {
  item: ErrorItem;
  sessionId: string | null;
}) {
  const fallback = providerRateLimitFallback(item);
  const presentation = presentSessionError(item);
  const setFallbackModel = useSessionModelFallbackAction();
  const { createEmptySessionWithResolvedConfig } = useSessionCreationActions();
  const showToast = useToastStore((state) => state.show);
  const showErrorToast = useToastStore((state) => state.showError);
  const requestModelPicker = useModelSupportStore((state) => state.requestPicker);
  const [isApplyingFallback, setIsApplyingFallback] = useState(false);
  const [isRelaunching, setIsRelaunching] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);

  const isOnline = useConnectivityStore((state) => state.isOnline);
  const isNetworkError = (item.details as { kind?: string } | null)?.kind === "network_connection";

  const handleRetryNetworkError = () => {
    if (!sessionId) {
      return;
    }
    const record = getSessionRecord(sessionId);
    if (!record) {
      return;
    }
    // Find the last user message in the transcript for this turn.
    const turnId = item.turnId;
    const turn = turnId ? record.transcript.turnsById[turnId] : null;
    let lastUserText: string | null = null;
    if (turn) {
      for (const itemId of turn.itemOrder) {
        const transcriptItem = record.transcript.itemsById[itemId];
        if (transcriptItem?.kind === "user_message") {
          lastUserText = transcriptItem.text;
        }
      }
    }
    // If we couldn't find it in the turn, scan all items for the last user message.
    if (!lastUserText) {
      const allItems = Object.values(record.transcript.itemsById);
      for (const ti of allItems) {
        if (ti.kind === "user_message" && ti.text) {
          lastUserText = ti.text;
        }
      }
    }
    if (!lastUserText) {
      showToast("Could not find the original prompt to retry.", "info");
      return;
    }
    const workspaceId = record.workspaceId;
    if (!workspaceId) {
      return;
    }
    // Pre-fill the composer and focus it so the user can re-send with one click.
    useChatInputStore.getState().setDraftText(workspaceId, lastUserText);
    useChatInputStore.getState().requestFocus();
  };

  // One-click relaunch after a seat plan-limit death (agent_auth flow 5): a
  // NEW session on the same workspace/harness/model through the ordinary
  // create path. The client only relaunches — the launch lands on the next
  // non-cooling login via the runtime's ordinary seat ladder.
  const handleRelaunch = () => {
    if (!sessionId || isRelaunching) {
      return;
    }
    const record = getSessionRecord(sessionId);
    if (!record) {
      return;
    }
    setIsRelaunching(true);
    void createEmptySessionWithResolvedConfig({
      agentKind: record.agentKind,
      modelId: record.modelId ?? record.requestedModelId ?? record.agentKind,
      ...(record.workspaceId ? { workspaceId: record.workspaceId } : {}),
    })
      .catch((error: unknown) => {
        showErrorToast({
          headline: "Session not relaunched",
          consequence: "No new session was started.",
          cause: errorMessage(error),
          retry: handleRelaunch,
        });
      })
      .finally(() => {
        setIsRelaunching(false);
      });
  };

  const handleFallback = () => {
    if (!fallback || !sessionId || isApplyingFallback) {
      return;
    }
    setIsApplyingFallback(true);
    void setFallbackModel(sessionId, fallback.fallbackModelId)
      .then(() => {
        showToast(
          `Session model changed to ${presentation.fallbackModelLabel ?? "the fallback model"}.`,
          "info",
        );
      })
      .catch((error) => {
        showErrorToast({
          headline: "Model not switched",
          // Names the model the button offered rather than saying "the model":
          // the system knows which one the user pressed, so the copy says which.
          consequence: presentation.fallbackModelLabel
            ? `This session is still on the model that was rate limited, not ${presentation.fallbackModelLabel}.`
            : "This session is still on the model that was rate limited.",
          cause: errorMessage(error),
          retry: handleFallback,
        });
      })
      .finally(() => {
        setIsApplyingFallback(false);
      });
  };

  return (
    <div className="rounded-lg border border-destructive/20 bg-destructive/[0.04] px-3 py-2 text-chat">
      <div className="flex min-w-0 items-start gap-2">
        <CircleAlert className="mt-0.5 icon-paired shrink-0 text-destructive/80" />
        <div className="min-w-0 flex-1">
          <div className="font-[520] text-destructive">{presentation.title}</div>
          <div className="mt-0.5 text-muted-foreground">{presentation.description}</div>
        </div>
      </div>
      {(fallback && sessionId)
        || isNetworkError
        || presentation.recoveryAction
        || presentation.technicalDetail ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
          {isNetworkError && sessionId && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!isOnline}
              title={!isOnline ? "You are offline" : undefined}
              onClick={handleRetryNetworkError}
              className="px-2.5 text-chat"
            >
              <RefreshCw className="icon-paired" />
              Retry
            </Button>
          )}
          {fallback && sessionId && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={isApplyingFallback}
              onClick={handleFallback}
              className="px-2.5 text-chat"
            >
              <RefreshCw className="icon-paired" />
              Switch to {presentation.fallbackModelLabel ?? "fallback model"}
            </Button>
          )}
          {presentation.recoveryAction === "choose_model" && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={requestModelPicker}
              className="px-2.5 text-chat"
            >
              Choose model
            </Button>
          )}
          {presentation.recoveryAction === "relaunch_session" && sessionId && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={isRelaunching}
              onClick={handleRelaunch}
              className="px-2.5 text-chat"
            >
              <RefreshCw className="icon-paired" />
              Relaunch session
            </Button>
          )}
          {presentation.technicalDetail && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDetailsExpanded((value) => !value)}
              className="gap-1 px-1.5 text-chat text-muted-foreground hover:text-foreground"
              aria-expanded={detailsExpanded}
            >
              <CircleQuestion
                aria-hidden="true"
                className={`icon-compact transition-colors ${detailsExpanded ? "text-foreground/70" : "text-faint"}`}
              />
              Details
            </Button>
          )}
        </div>
      ) : null}
      {detailsExpanded && presentation.technicalDetail && (
        // Recorded exclusion (DESIGN_SYSTEM.md § UI-conformance review,
        // check 1): the technical detail deliberately recedes to a translucent
        // `bg-background/70` — below the error block it sits inside, not above
        // it. `Card`'s fills both read as raised surfaces, so neither expresses
        // a recessed well. Needs a ruling on `Card` rather than a repaint here.
        <div className="mt-2 whitespace-pre-wrap rounded-md border border-border/70 bg-background/70 px-2.5 py-2 font-mono text-chat leading-5 text-muted-foreground select-text">
          {presentation.technicalDetail}
        </div>
      )}
    </div>
  );
}

function providerRateLimitFallback(item: ErrorItem): { fallbackModelId: string } | null {
  const details = item.details;
  if (!details || details.kind !== "provider_rate_limit") {
    return null;
  }
  return { fallbackModelId: details.fallbackModelId };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
