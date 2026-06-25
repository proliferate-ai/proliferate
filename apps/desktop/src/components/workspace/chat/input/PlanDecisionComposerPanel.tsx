import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { twMerge } from "tailwind-merge";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { ChatComposerSurface } from "@proliferate/product-ui/chat/composer/ChatComposerSurface";
import { ArrowUp } from "@proliferate/ui/icons";
import { useResolvePlanNativeOptionMutation } from "@anyharness/sdk-react";
import { useSessionCancelActions } from "@/hooks/sessions/workflows/use-session-cancel-actions";
import { useSessionPromptActions } from "@/hooks/sessions/workflows/use-session-prompt-actions";
import type { ActivePlanDecision } from "@/hooks/chat/derived/use-active-plan-decision";
import { buildPlanDecisionEntries, type PlanDecisionEntry } from "@/lib/domain/chat/composer/plan-decision-options";
import { useToastStore } from "@/stores/toast/toast-store";

interface PlanDecisionComposerPanelProps {
  decision: ActivePlanDecision;
}

export function PlanDecisionComposerPanel({
  decision,
}: PlanDecisionComposerPanelProps) {
  const resolvePlanNativeOption = useResolvePlanNativeOptionMutation();
  const { promptSessionById } = useSessionPromptActions();
  const { cancelActiveSession } = useSessionCancelActions();
  const showToast = useToastStore((state) => state.show);
  const entries = useMemo(
    () => buildPlanDecisionEntries(decision.actions),
    [decision.actions],
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [feedbackDraft, setFeedbackDraft] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const panelFocusRef = useRef<HTMLDivElement | null>(null);
  const feedbackInputRef = useRef<HTMLInputElement | null>(null);
  const selectedEntry = entries[selectedIndex] ?? null;

  useEffect(() => {
    setSelectedIndex(0);
    setFeedbackDraft("");
  }, [decision.pendingApproval.requestId]);

  useEffect(() => {
    if (selectedEntry?.type === "feedback") {
      feedbackInputRef.current?.focus({ preventScroll: true });
    } else {
      panelFocusRef.current?.focus({ preventScroll: true });
    }
  }, [selectedEntry?.type]);

  const selectRelative = useCallback((delta: number) => {
    setSelectedIndex((current) => {
      if (entries.length === 0) return 0;
      return (current + delta + entries.length) % entries.length;
    });
  }, [entries.length]);

  const dismiss = useCallback(() => {
    void cancelActiveSession().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      showToast(`Failed to dismiss plan: ${message}`);
    });
  }, [cancelActiveSession, showToast]);

  const submitEntry = useCallback((entry: PlanDecisionEntry | null) => {
    if (!entry || isSubmitting) {
      return;
    }
    const trimmedFeedback = feedbackDraft.trim();
    if (entry.type === "feedback" && !trimmedFeedback) {
      feedbackInputRef.current?.focus({ preventScroll: true });
      return;
    }
    void (async () => {
      setIsSubmitting(true);
      const feedbackText = entry.type === "feedback" ? trimmedFeedback : undefined;
      await resolvePlanNativeOption.mutateAsync({
        planId: decision.plan.id,
        expectedDecisionVersion: decision.plan.decisionVersion,
        optionId: entry.action.optionId,
      });
      if (feedbackText) {
        await promptSessionById(decision.plan.sourceSessionId, feedbackText);
      }
    })().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      showToast(`Failed to submit plan decision: ${message}`);
      setIsSubmitting(false);
    });
  }, [
    decision.plan.decisionVersion,
    decision.plan.id,
    decision.plan.sourceSessionId,
    decision.pendingApproval.requestId,
    feedbackDraft,
    isSubmitting,
    promptSessionById,
    resolvePlanNativeOption,
    showToast,
  ]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      dismiss();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      selectRelative(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      selectRelative(-1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      submitEntry(selectedEntry);
      return;
    }
    if (/^[1-9]$/u.test(event.key)) {
      const nextIndex = Number(event.key) - 1;
      if (nextIndex >= 0 && nextIndex < entries.length) {
        event.preventDefault();
        setSelectedIndex(nextIndex);
      }
    }
  }, [dismiss, entries.length, selectRelative, selectedEntry, submitEntry]);

  const canSubmit = selectedEntry?.type === "feedback"
    ? feedbackDraft.trim().length > 0
    : Boolean(selectedEntry);

  return (
    <ChatComposerSurface
      className="[--radius-composer:1.25rem]"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      data-telemetry-mask
    >
      <div
        ref={panelFocusRef}
        className="flex flex-col gap-3 px-4 py-4 focus:outline-none"
        tabIndex={-1}
      >
        <div className="text-base font-medium leading-6 text-foreground">
          {decision.pendingApproval.title}
        </div>
        <div className="flex flex-col gap-1.5">
          {entries.length === 0 ? (
            <div className="rounded-xl bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
              Waiting for plan options...
            </div>
          ) : entries.map((entry, index) => (
            <PlanDecisionRow
              key={entry.action.optionId}
              entry={entry}
              number={index + 1}
              selected={index === selectedIndex}
              feedbackDraft={feedbackDraft}
              feedbackInputRef={feedbackInputRef}
              disabled={isSubmitting}
              onSelect={() => setSelectedIndex(index)}
              onSubmit={() => submitEntry(entry)}
              onFeedbackChange={setFeedbackDraft}
            />
          ))}
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={dismiss}
            disabled={isSubmitting}
            className="rounded-md px-2.5 text-sm"
          >
            Dismiss <kbd className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-foreground">ESC</kbd>
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            loading={isSubmitting}
            disabled={!canSubmit}
            onClick={() => submitEntry(selectedEntry)}
            className="rounded-md px-3 text-sm"
          >
            Submit
            <ArrowUp className="size-3.5" />
          </Button>
        </div>
      </div>
    </ChatComposerSurface>
  );
}

function PlanDecisionRow({
  entry,
  number,
  selected,
  feedbackDraft,
  feedbackInputRef,
  disabled,
  onSelect,
  onSubmit,
  onFeedbackChange,
}: {
  entry: PlanDecisionEntry;
  number: number;
  selected: boolean;
  feedbackDraft: string;
  feedbackInputRef: RefObject<HTMLInputElement | null>;
  disabled: boolean;
  onSelect: () => void;
  onSubmit: () => void;
  onFeedbackChange: (value: string) => void;
}) {
  if (entry.type === "feedback") {
    return (
      <div
        className={twMerge(
          "flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 transition-colors",
          selected ? "bg-muted" : "hover:bg-muted/70",
        )}
        onClick={onSelect}
      >
        <span className={numberBadgeClassName(selected)}>{number}</span>
        <Input
          ref={feedbackInputRef}
          value={feedbackDraft}
          disabled={disabled}
          onFocus={onSelect}
          onChange={(event) => onFeedbackChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.stopPropagation();
              onSubmit();
            }
          }}
          placeholder={entry.action.presentation?.placeholder ?? entry.action.label}
          className="h-auto flex-1 border-none bg-transparent px-0 py-0 text-base shadow-none focus:ring-0"
        />
      </div>
    );
  }

  return (
    <Button
      type="button"
      variant="unstyled"
      size="unstyled"
      disabled={disabled}
      onClick={onSelect}
      className={twMerge(
        "flex min-h-11 w-full items-center justify-start gap-3 rounded-xl px-3 py-2 text-left text-base font-medium text-foreground transition-colors",
        selected ? "bg-muted" : "hover:bg-muted/70",
      )}
    >
      <span className={numberBadgeClassName(selected)}>{number}</span>
      <span className="min-w-0 flex-1 truncate">{entry.action.label}</span>
    </Button>
  );
}

function numberBadgeClassName(selected: boolean): string {
  return twMerge(
    "grid size-7 shrink-0 place-items-center rounded-full text-sm font-semibold",
    selected
      ? "bg-foreground text-background"
      : "bg-foreground/10 text-foreground",
  );
}
