import type { UserInputQuestion, UserInputSubmittedAnswer } from "@anyharness/sdk";
import { useMemo, useState } from "react";
import { ArrowUp } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Textarea } from "@proliferate/ui/primitives/Textarea";
import { useActivePendingInteractionState } from "@/hooks/chat/derived/use-active-pending-session-interactions";
import { useChatUserInputActions } from "@/hooks/chat/workflows/use-chat-user-input-actions";
import { ComposerAttachedPanel } from "./ComposerAttachedPanel";
import {
  ComposerOptionRow,
  useComposerOptionNumberKeys,
} from "./ComposerOptionRow";

// Superset-style agent input (UX_SPEC §5): option rows with number-key
// badges (1–9 selects), an inset free-text row on --control with an inset
// ring, outline chips for secondary actions, and a circular solid submit.

const OTHER_OPTION_LABEL = "None of the above";
const CHIP_BUTTON_CLASSNAME =
  "rounded-md border border-input px-3 py-1 text-base font-medium text-muted-foreground transition-colors hover:border-border-heavy hover:text-foreground";

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

  const header = (
    <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
      <div className="text-chat min-w-0 truncate font-medium leading-[var(--text-chat--line-height)] text-foreground">
        {title}
      </div>
      {progressLabel && (
        <div className="shrink-0 text-base text-faint">
          {progressLabel}
        </div>
      )}
    </div>
  );

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

  const selectOptionAtIndex = (index: number) => {
    const option = options[index];
    if (!option) return;
    updateDraft({
      selectedOptionLabel: option.label,
      text: option.label === OTHER_OPTION_LABEL ? draft.text : "",
    });
  };

  useComposerOptionNumberKeys(
    options.length,
    selectOptionAtIndex,
    !!currentQuestion,
  );

  if (!currentQuestion) {
    return (
      <ComposerAttachedPanel header={header}>
        <div className="flex items-center justify-end gap-2 px-3 pb-3">
          <Button type="button" variant="unstyled" size="unstyled" className={CHIP_BUTTON_CLASSNAME} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </ComposerAttachedPanel>
    );
  }

  const showTextInput = allowsDraftText(currentQuestion, draft);
  const isFirst = questionIndex === 0;
  const isLast = questionIndex >= questions.length - 1;
  const handleAdvance = () => {
    if (isLast) {
      onSubmit(answers);
      return;
    }
    setQuestionIndex((index) => Math.min(questions.length - 1, index + 1));
  };

  return (
    <ComposerAttachedPanel header={header}>
      <div className="flex max-h-[300px] flex-col">
        <div className="min-h-0 overflow-y-auto px-2">
          {(currentQuestion.header && currentQuestion.header !== title)
            || currentQuestion.question ? (
              <div className="space-y-1 px-1 pb-2">
                {currentQuestion.header && currentQuestion.header !== title && (
                  <div className="text-chat font-medium leading-[var(--text-chat--line-height)] text-foreground">
                    {currentQuestion.header}
                  </div>
                )}
                <div className="text-chat leading-[var(--text-chat--line-height)] text-muted-foreground">
                  {currentQuestion.question}
                </div>
              </div>
            ) : null}

          {options.map((option, index) => (
            <ComposerOptionRow
              key={option.label}
              index={index}
              label={option.label}
              description={option.description}
              selected={draft.selectedOptionLabel === option.label}
              onSelect={() => selectOptionAtIndex(index)}
            />
          ))}
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
                className="flex-1 cursor-text border-0 bg-transparent px-0 py-1 text-chat text-foreground shadow-none outline-none placeholder:text-[color:color-mix(in_oklab,var(--color-muted-foreground)_40%,transparent)] focus:ring-0"
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
                className="flex-1 cursor-text px-0 py-1 text-chat text-foreground placeholder:text-[color:color-mix(in_oklab,var(--color-muted-foreground)_40%,transparent)]"
              />
            )}
          </div>
        )}

        <div className="flex shrink-0 items-center justify-between gap-2 px-3 pb-3 pt-1">
          <Button type="button" variant="unstyled" size="unstyled" className={CHIP_BUTTON_CLASSNAME} onClick={onCancel}>
            Cancel
          </Button>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <Button
                type="button"
                variant="unstyled"
                size="unstyled"
                className={CHIP_BUTTON_CLASSNAME}
                onClick={() =>
                  setQuestionIndex((index) => Math.max(0, index - 1))}
              >
                Back
              </Button>
            )}
            <Button
              type="button"
              variant="unstyled"
              size="unstyled"
              aria-label={isLast ? "Submit" : "Next"}
              onClick={handleAdvance}
              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-80"
            >
              <ArrowUp className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </ComposerAttachedPanel>
  );
}

export function ConnectedUserInputCard() {
  const { pendingUserInput } = useActivePendingInteractionState();
  const { handleSubmitUserInput, handleCancelUserInput } = useChatUserInputActions();

  if (!pendingUserInput) {
    return null;
  }

  return (
    <UserInputCard
      key={pendingUserInput.requestId}
      title={pendingUserInput.title}
      questions={pendingUserInput.questions}
      onSubmit={handleSubmitUserInput}
      onCancel={handleCancelUserInput}
    />
  );
}
