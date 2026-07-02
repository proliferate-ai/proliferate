import type { UserInputQuestion, UserInputSubmittedAnswer } from "@anyharness/sdk";
import { useMemo, useState } from "react";
import { Input } from "@proliferate/ui/primitives/Input";
import { Textarea } from "@proliferate/ui/primitives/Textarea";
import { twMerge } from "@proliferate/ui/utils/tw-merge";
import { useActivePendingInteractionState } from "@/hooks/chat/derived/use-active-pending-session-interactions";
import { useHeldInteractionPayload } from "@/hooks/chat/ui/use-composer-dock-card-presence";
import { useChatUserInputActions } from "@/hooks/chat/workflows/use-chat-user-input-actions";
import {
  ComposerAttachedPanel,
  ComposerCardFooter,
} from "./ComposerAttachedPanel";
import {
  ComposerOptionKeyBadge,
  ComposerOptionRow,
  useComposerOptionNumberKeys,
} from "./ComposerOptionRow";

// Agent question wizard on the shared interaction-card anatomy: header/type
// grammar from ComposerAttachedPanel (text-ui title + text-ui-sm progress
// context), codex-style option rows with number-key badges (1–9 selects), an
// inset free-text row on --control with an inset ring, and the shared
// ComposerCardFooter (secondary chips left, primary chip right).
//
// Selecting a real (agent-provided) option auto-advances to the next question
// — or submits on the last one — so single-select questions resolve in one
// click like the approval card; Back is still available in the footer. The
// synthetic "None of the above" row is the exception: it opens the free-text
// field instead of advancing, and renders under a hairline separator with a
// muted tone so it never reads like one of the agent's real options.

const OTHER_OPTION_LABEL = "None of the above";

function optionsForQuestion(question: UserInputQuestion) {
  return [
    ...(question.options ?? []),
    ...(question.isOther
      ? [{ label: OTHER_OPTION_LABEL, description: "Write a custom answer" }]
      : []),
  ];
}

function allowsDraftText(question: UserInputQuestion, draft: UserInputDraft): boolean {
  const options = optionsForQuestion(question);
  if (options.length === 0) {
    return true;
  }
  return question.isOther && draft.selectedOptionLabel === OTHER_OPTION_LABEL;
}

function buildSubmittedAnswer(
  question: UserInputQuestion,
  draft: UserInputDraft,
): UserInputSubmittedAnswer {
  const text = allowsDraftText(question, draft) ? draft.text.trim() : "";
  return {
    questionId: question.questionId,
    selectedOptionLabel: draft.selectedOptionLabel ?? undefined,
    text: text.length > 0 ? text : undefined,
  };
}

interface UserInputDraft {
  selectedOptionLabel: string | null;
  text: string;
}

export interface UserInputCardProps {
  title: string;
  questions: UserInputQuestion[];
  onSubmit: (answers: UserInputSubmittedAnswer[]) => void;
  onCancel: () => void;
}

export function UserInputCard({
  title,
  questions,
  onSubmit,
  onCancel,
}: UserInputCardProps) {
  const [questionIndex, setQuestionIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, UserInputDraft>>(() =>
    Object.fromEntries(
      questions.map((question) => [
        question.questionId,
        { selectedOptionLabel: null, text: "" },
      ]),
    ),
  );

  const currentQuestion = questions[questionIndex] ?? null;
  const progressLabel = questions.length > 1
    ? `${Math.min(questionIndex + 1, questions.length)} of ${questions.length}`
    : null;

  const answers = useMemo<UserInputSubmittedAnswer[]>(() =>
    questions.map((question) => {
      const draft = drafts[question.questionId] ?? {
        selectedOptionLabel: null,
        text: "",
      };
      return buildSubmittedAnswer(question, draft);
    }), [drafts, questions]);

  const options = currentQuestion ? optionsForQuestion(currentQuestion) : [];
  const draft: UserInputDraft = (currentQuestion && drafts[currentQuestion.questionId]) ?? {
    selectedOptionLabel: null,
    text: "",
  };
  const isFirst = questionIndex === 0;
  const isLast = questionIndex >= questions.length - 1;

  const updateDraft = (patch: Partial<UserInputDraft>) => {
    if (!currentQuestion) return;
    setDrafts((current) => ({
      ...current,
      [currentQuestion.questionId]: {
        ...(current[currentQuestion.questionId] ?? {
          selectedOptionLabel: null,
          text: "",
        }),
        ...patch,
      },
    }));
  };

  // Answers with an override draft for the current question, so an auto-advance
  // click can submit the just-selected option without waiting for the drafts
  // state update to flush.
  const answersWithCurrentDraft = (nextDraft: UserInputDraft): UserInputSubmittedAnswer[] =>
    questions.map((question) => {
      const source = currentQuestion && question.questionId === currentQuestion.questionId
        ? nextDraft
        : drafts[question.questionId] ?? { selectedOptionLabel: null, text: "" };
      return buildSubmittedAnswer(question, source);
    });

  const chooseOption = (index: number) => {
    const option = options[index];
    if (!option || !currentQuestion) return;
    const isSynthetic = option.label === OTHER_OPTION_LABEL;
    const nextDraft: UserInputDraft = {
      selectedOptionLabel: option.label,
      text: isSynthetic ? draft.text : "",
    };
    updateDraft(nextDraft);
    if (isSynthetic) {
      // Synthetic "None of the above" opens the free-text field instead of
      // advancing — the user still has to type a custom answer.
      return;
    }
    // A concrete agent option is a complete answer: advance to the next
    // question, or submit when this is the last one.
    if (isLast) {
      onSubmit(answersWithCurrentDraft(nextDraft));
    } else {
      setQuestionIndex((current) => Math.min(questions.length - 1, current + 1));
    }
  };

  useComposerOptionNumberKeys(
    options.length,
    chooseOption,
    !!currentQuestion,
  );

  if (!currentQuestion) {
    return (
      <ComposerAttachedPanel title={title} context={progressLabel}>
        <ComposerCardFooter
          secondaryActions={[{ label: "Cancel", onSelect: onCancel }]}
        />
      </ComposerAttachedPanel>
    );
  }

  const agentOptionCount = currentQuestion.options?.length ?? 0;
  const hasSyntheticOption = currentQuestion.isOther;
  const syntheticIndex = agentOptionCount;
  const showTextInput = allowsDraftText(currentQuestion, draft);
  const handleAdvance = () => {
    if (isLast) {
      onSubmit(answers);
      return;
    }
    setQuestionIndex((index) => Math.min(questions.length - 1, index + 1));
  };

  return (
    <ComposerAttachedPanel title={title} context={progressLabel}>
      <div className="flex max-h-[300px] flex-col">
        <div className="min-h-0 overflow-y-auto px-2">
          {(currentQuestion.header && currentQuestion.header !== title)
            || currentQuestion.question ? (
              <div className="space-y-1 px-1 pb-2">
                {currentQuestion.header && currentQuestion.header !== title && (
                  <div className="text-ui font-medium text-foreground">
                    {currentQuestion.header}
                  </div>
                )}
                <div className="text-ui text-muted-foreground">
                  {currentQuestion.question}
                </div>
              </div>
            ) : null}

          {(currentQuestion.options ?? []).map((option, index) => (
            <ComposerOptionRow
              key={option.label}
              index={index}
              label={option.label}
              description={option.description}
              selected={draft.selectedOptionLabel === option.label}
              onSelect={() => chooseOption(index)}
            />
          ))}

          {hasSyntheticOption && (
            <SyntheticOptionRow
              index={syntheticIndex}
              hasAgentOptions={agentOptionCount > 0}
              selected={draft.selectedOptionLabel === OTHER_OPTION_LABEL}
              onSelect={() => chooseOption(syntheticIndex)}
            />
          )}
        </div>

        {showTextInput && (
          <div className="mx-2 mb-2 mt-1 flex shrink-0 cursor-text items-start gap-3 rounded-lg bg-surface-control px-2.5 py-2 ring-1 ring-inset ring-input">
            {currentQuestion.isSecret ? (
              <Input
                variant="unstyled"
                type="password"
                value={draft.text}
                onChange={(event) =>
                  updateDraft({ text: event.currentTarget.value })}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleAdvance();
                  }
                }}
                placeholder={draft.selectedOptionLabel === OTHER_OPTION_LABEL
                  ? "Write a custom answer"
                  : "Enter your answer"}
                autoComplete="off"
                data-telemetry-mask="true"
                className="flex-1 cursor-text border-0 bg-transparent px-0 py-1 text-ui text-foreground shadow-none outline-none placeholder:text-[color:color-mix(in_oklab,var(--color-muted-foreground)_40%,transparent)] focus:ring-0"
              />
            ) : (
              <Textarea
                variant="ghost"
                rows={3}
                value={draft.text}
                onChange={(event) =>
                  updateDraft({ text: event.currentTarget.value })}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    handleAdvance();
                  }
                }}
                placeholder={draft.selectedOptionLabel === OTHER_OPTION_LABEL
                  ? "Write a custom answer"
                  : "Enter your answer"}
                autoComplete="off"
                data-telemetry-mask="true"
                className="flex-1 cursor-text px-0 py-1 text-ui text-foreground placeholder:text-[color:color-mix(in_oklab,var(--color-muted-foreground)_40%,transparent)]"
              />
            )}
          </div>
        )}

        <ComposerCardFooter
          secondaryActions={[
            { label: "Cancel", onSelect: onCancel },
            ...(!isFirst
              ? [{
                label: "Back",
                onSelect: () =>
                  setQuestionIndex((index) => Math.max(0, index - 1)),
              }]
              : []),
          ]}
          primaryAction={{
            label: isLast ? "Submit" : "Next",
            onSelect: handleAdvance,
          }}
        />
      </div>
    </ComposerAttachedPanel>
  );
}

/**
 * The synthetic "None of the above" row. Shares the option-row anatomy (same
 * number-key badge, hover fill, and paddings) but sits under a hairline
 * separator and renders in a muted --faint tone so it reads as an escape hatch
 * rather than one of the agent's real answers.
 */
function SyntheticOptionRow({
  index,
  hasAgentOptions,
  selected,
  onSelect,
}: {
  index: number;
  hasAgentOptions: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <div className={hasAgentOptions ? "mt-1 border-t border-border/60 pt-1" : ""}>
      <button
        type="button"
        onClick={onSelect}
        className={twMerge(
          "group/option flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent",
          selected ? "bg-accent" : "",
        )}
      >
        <ComposerOptionKeyBadge>{index + 1}</ComposerOptionKeyBadge>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            className={twMerge(
              "text-ui transition-colors",
              selected
                ? "text-muted-foreground"
                : "text-faint group-hover/option:text-muted-foreground",
            )}
          >
            {OTHER_OPTION_LABEL}
          </span>
          <span className="text-ui-sm text-faint">Write a custom answer</span>
        </span>
      </button>
    </div>
  );
}

export function ConnectedUserInputCard() {
  const { pendingUserInput } = useActivePendingInteractionState();
  // Hold the last payload so the card can still render while the dock slot
  // plays its 150ms exit fade after the request resolves.
  const held = useHeldInteractionPayload(pendingUserInput);
  const { handleSubmitUserInput, handleCancelUserInput } = useChatUserInputActions();

  if (!held) {
    return null;
  }

  return (
    <UserInputCard
      key={held.requestId}
      title={held.title}
      questions={held.questions}
      onSubmit={handleSubmitUserInput}
      onCancel={handleCancelUserInput}
    />
  );
}
