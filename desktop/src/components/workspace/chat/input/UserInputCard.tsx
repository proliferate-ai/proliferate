import type { UserInputQuestion, UserInputSubmittedAnswer } from "@anyharness/sdk";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { useActivePendingInteractionState } from "@/hooks/chat/use-active-chat-session-selectors";
import { useChatUserInputActions } from "@/hooks/chat/use-chat-user-input-actions";
import { ComposerAttachedPanel } from "./ComposerAttachedPanel";

const OTHER_OPTION_LABEL = "None of the above";
const BUTTON_CLASSNAME = "rounded-xl px-2.5 text-sm";

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
        <div className="shrink-0 text-xs text-muted-foreground">
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

  if (!currentQuestion) {
    return (
      <ComposerAttachedPanel header={header}>
        <div className="flex items-center justify-end gap-2 p-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className={BUTTON_CLASSNAME}
            onClick={onCancel}
          >
            Cancel
          </Button>
        </div>
      </ComposerAttachedPanel>
    );
  }

  const draft = drafts[currentQuestion.questionId] ?? {
    selectedOptionLabel: null,
    text: "",
  };
  const options = optionsForQuestion(currentQuestion);
  const showTextInput = allowsDraftText(currentQuestion, draft);
  const isFirst = questionIndex === 0;
  const isLast = questionIndex >= questions.length - 1;

  const updateDraft = (patch: Partial<UserInputDraft>) => {
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

  return (
    <ComposerAttachedPanel header={header}>
      <div className="flex max-h-[min(40vh,360px)] flex-col">
        <div className="min-h-0 overflow-y-auto p-3 pb-2">
          <div className="flex flex-col gap-3">
            <div className="space-y-1">
              {currentQuestion.header && currentQuestion.header !== title && (
                <div className="text-sm font-medium text-foreground">
                  {currentQuestion.header}
                </div>
              )}
              <div className="text-sm text-muted-foreground">
                {currentQuestion.question}
              </div>
            </div>

            {options.length > 0 && (
              <div className="flex flex-col gap-2">
                {options.map((option) => {
                  const selected = draft.selectedOptionLabel === option.label;
                  return (
                    <Button
                      key={option.label}
                      type="button"
                      variant={selected ? "primary" : "secondary"}
                      size="sm"
                      className="h-auto justify-start rounded-xl px-3 py-2 text-left"
                      onClick={() =>
                        updateDraft({
                          selectedOptionLabel: option.label,
                          text: option.label === OTHER_OPTION_LABEL ? draft.text : "",
                        })}
                    >
                      <span className="flex flex-col gap-0.5">
                        <span>{option.label}</span>
                        {option.description && (
                          <span
                            className={
                              selected
                                ? "text-primary-foreground/75"
                                : "text-muted-foreground"
                            }
                          >
                            {option.description}
                          </span>
                        )}
                      </span>
                    </Button>
                  );
                })}
              </div>
            )}

            {showTextInput && (
              currentQuestion.isSecret ? (
                <Input
                  type="password"
                  value={draft.text}
                  onChange={(event) =>
                    updateDraft({ text: event.currentTarget.value })}
                  placeholder="Enter your answer"
                  autoComplete="off"
                  data-telemetry-mask="true"
                />
              ) : (
                <Textarea
                  value={draft.text}
                  onChange={(event) =>
                    updateDraft({ text: event.currentTarget.value })}
                  placeholder={draft.selectedOptionLabel === OTHER_OPTION_LABEL
                    ? "Write a custom answer"
                    : "Enter your answer"}
                  rows={3}
                  data-telemetry-mask="true"
                />
              )
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 px-3 pb-3 pt-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className={BUTTON_CLASSNAME}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className={BUTTON_CLASSNAME}
                onClick={() =>
                  setQuestionIndex((index) => Math.max(0, index - 1))}
              >
                Back
              </Button>
            )}
            {isLast ? (
              <Button
                type="button"
                variant="primary"
                size="sm"
                className={BUTTON_CLASSNAME}
                onClick={() => onSubmit(answers)}
              >
                Submit
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                size="sm"
                className={BUTTON_CLASSNAME}
                onClick={() =>
                  setQuestionIndex((index) =>
                    Math.min(questions.length - 1, index + 1))}
              >
                Next
              </Button>
            )}
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
