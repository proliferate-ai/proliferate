import { Plus, X } from "@proliferate/ui/icons";
import { ProviderIcon } from "@proliferate/ui/provider-icons";
import { twMerge } from "@proliferate/ui/utils/tw-merge";
import { MOCK_CATALOG, type MockBlocker, type MockDefinition, type MockStage } from "./fixtures";
import { PropertyMenu } from "./atoms";

/**
 * The workflow rendered as a document: per harness, a quiet byline
 * (harness · model · reasoning) over a hero prompt block with {{inputs.*}}
 * tokens highlighted in place. Chained harnesses read as prose: "then".
 */

export const TOKEN_PATTERN = /\{\{\s*inputs\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

const DOC_TEXT = "whitespace-pre-wrap break-words text-sm leading-7";

function renderTokens(value: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const match of value.matchAll(TOKEN_PATTERN)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push(value.slice(last, start));
    nodes.push(
      <span key={i++} className="rounded-[4px] bg-foreground/[0.08] text-muted-foreground">
        {match[0]}
      </span>,
    );
    last = start + match[0].length;
  }
  if (last < value.length) nodes.push(value.slice(last));
  return nodes;
}

/** Transparent textarea over a token-highlighted mirror — same metrics. */
function TokenTextarea({
  value,
  placeholder,
  onChange,
  className,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={twMerge("relative", className)}>
      <div aria-hidden className={twMerge(DOC_TEXT, "min-h-7 text-foreground")}>
        {value ? renderTokens(value) : <span className="text-faint">{placeholder}</span>}
        {"​"}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className={twMerge(
          DOC_TEXT,
          "absolute inset-0 h-full w-full resize-none overflow-hidden bg-transparent text-transparent caret-current outline-none",
        )}
      />
    </div>
  );
}

function blockerAt(blockers: MockBlocker[], path: string) {
  return blockers.filter((b) => b.path === path);
}

function BlockerLine({ blocker }: { blocker: MockBlocker }) {
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <span className="shrink-0 font-mono text-xs text-muted-foreground">{blocker.code}</span>
      <span className="min-w-0 text-xs text-faint">{blocker.message}</span>
    </div>
  );
}

function HarnessByline({
  stage,
  onChange,
  onRemove,
  canRemove,
}: {
  stage: MockStage;
  onChange: (next: MockStage) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const catalog = MOCK_CATALOG[stage.agentKind];
  const efforts = stage.modelId ? (catalog.efforts[stage.modelId] ?? []) : [];
  return (
    <div className="group flex items-center gap-1">
      <ProviderIcon kind={stage.agentKind} className="mr-1 size-3.5 shrink-0 text-muted-foreground" />
      <PropertyMenu
        value={stage.agentKind}
        display={stage.agentKind === "claude" ? "Claude" : "Codex"}
        options={[
          { value: "claude", label: "Claude" },
          { value: "codex", label: "Codex" },
        ]}
        onSelect={(v) =>
          onChange({
            ...stage,
            agentKind: v as MockStage["agentKind"],
            modelId: undefined,
            effort: undefined,
          })
        }
        emphasize
      />
      <span aria-hidden className="text-xs text-faint">·</span>
      <PropertyMenu
        value={stage.modelId ?? ""}
        display={stage.modelId ?? "target default"}
        options={[
          { value: "", label: "Target default" },
          ...catalog.models.map((m) => ({ value: m, label: m })),
        ]}
        onSelect={(v) => onChange({ ...stage, modelId: v || undefined, effort: undefined })}
      />
      {stage.modelId ? (
        <>
          <span aria-hidden className="text-xs text-faint">·</span>
          <PropertyMenu
            value={stage.effort ?? ""}
            display={stage.effort ? `${stage.effort} reasoning` : "default reasoning"}
            options={[
              { value: "", label: "Default reasoning" },
              ...efforts.map((e) => ({ value: e, label: e })),
            ]}
            onSelect={(v) => onChange({ ...stage, effort: v || undefined })}
          />
        </>
      ) : null}
      <span className="min-w-0 flex-1" />
      <span className="shrink-0 text-xs text-faint">one session</span>
      {canRemove ? (
        <button
          type="button"
          aria-label="Remove harness"
          onClick={onRemove}
          className="rounded p-0.5 text-faint opacity-0 transition-all hover:bg-surface-elevated-secondary hover:text-muted-foreground group-hover:opacity-100"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  );
}

export function MockPromptDocument({
  definition,
  blockers,
  onChange,
}: {
  definition: MockDefinition;
  blockers: MockBlocker[];
  onChange: (next: MockDefinition) => void;
}) {
  function updateStage(index: number, next: MockStage) {
    onChange({ ...definition, stages: definition.stages.map((s, i) => (i === index ? next : s)) });
  }

  return (
    <div className="flex flex-col">
      {blockerAt(blockers, "stages").map((b) => (
        <BlockerLine key={b.code} blocker={b} />
      ))}
      {definition.stages.map((stage, si) => (
        <div key={si} className="flex flex-col">
          {si > 0 ? <div className="py-2 text-xs text-faint">then</div> : null}
          <HarnessByline
            stage={stage}
            onChange={(next) => updateStage(si, next)}
            onRemove={() =>
              onChange({ ...definition, stages: definition.stages.filter((_, i) => i !== si) })
            }
            canRemove={definition.stages.length > 1}
          />
          <div className="group/doc mt-1.5 flex flex-col gap-2 rounded-lg bg-foreground/[0.025] px-4 py-3.5">
            {stage.steps.map((step, pi) => (
              <div key={pi} className="group/step flex flex-col gap-1">
                {pi > 0 ? <div className="h-px bg-foreground/[0.06]" aria-hidden /> : null}
                <div className="flex items-start gap-2">
                  <TokenTextarea
                    value={step.prompt}
                    placeholder="Prompt the agent — reference inputs as {{inputs.name}}"
                    onChange={(prompt) =>
                      updateStage(si, {
                        ...stage,
                        steps: stage.steps.map((s, i) => (i === pi ? { ...s, prompt } : s)),
                      })
                    }
                    className="min-w-0 flex-1"
                  />
                  {stage.steps.length > 1 ? (
                    <button
                      type="button"
                      aria-label="Remove prompt"
                      onClick={() =>
                        updateStage(si, {
                          ...stage,
                          steps: stage.steps.filter((_, i) => i !== pi),
                        })
                      }
                      className="mt-1.5 rounded p-0.5 text-faint opacity-0 transition-all hover:bg-surface-elevated-secondary hover:text-muted-foreground group-hover/step:opacity-100"
                    >
                      <X className="size-3" />
                    </button>
                  ) : null}
                </div>
                {step.goal ? (
                  <div className="flex items-start gap-2">
                    <span aria-hidden className="pt-0.5 font-mono text-xs text-faint">◎ until</span>
                    <TokenTextarea
                      value={step.goal.objective}
                      placeholder="a goal the agent iterates toward"
                      onChange={(objective) =>
                        updateStage(si, {
                          ...stage,
                          steps: stage.steps.map((s, i) =>
                            i === pi ? { ...s, goal: { objective } } : s,
                          ),
                        })
                      }
                      className="min-w-0 flex-1 [&>div]:text-xs [&>div]:leading-6 [&>textarea]:text-xs [&>textarea]:leading-6"
                    />
                    {blockerAt(blockers, `stages[${si}].steps[${pi}].goal`).map((b) => (
                      <span key={b.code} className="pt-0.5 font-mono text-xs text-faint" title={b.message}>
                        {b.code}
                      </span>
                    ))}
                    <button
                      type="button"
                      aria-label="Remove goal"
                      onClick={() =>
                        updateStage(si, {
                          ...stage,
                          steps: stage.steps.map((s, i) =>
                            i === pi ? { ...s, goal: undefined } : s,
                          ),
                        })
                      }
                      className="rounded p-0.5 text-faint opacity-0 transition-all hover:bg-surface-elevated-secondary hover:text-muted-foreground group-hover/step:opacity-100"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      updateStage(si, {
                        ...stage,
                        steps: stage.steps.map((s, i) =>
                          i === pi ? { ...s, goal: { objective: "" } } : s,
                        ),
                      })
                    }
                    className="flex w-fit items-center gap-1.5 text-xs text-faint opacity-0 transition-opacity hover:text-muted-foreground group-hover/step:opacity-100"
                  >
                    <span aria-hidden className="font-mono">◎</span>
                    until…
                  </button>
                )}
              </div>
            ))}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() =>
                  updateStage(si, {
                    ...stage,
                    steps: [...stage.steps, { kind: "agent.prompt", prompt: "" }],
                  })
                }
                className="flex w-fit items-center gap-1 text-xs text-faint opacity-0 transition-opacity hover:text-muted-foreground group-hover/doc:opacity-100"
              >
                <Plus className="size-3" />
                prompt
              </button>
              {blockerAt(blockers, `stages[${si}].steps`).map((b) => (
                <BlockerLine key={b.code} blocker={b} />
              ))}
            </div>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange({
            ...definition,
            stages: [
              ...definition.stages,
              { agentKind: "claude", steps: [{ kind: "agent.prompt", prompt: "" }] },
            ],
          })
        }
        className="flex w-fit items-center gap-1.5 pt-3 text-xs text-faint transition-colors hover:text-muted-foreground"
      >
        <Plus className="size-3" />
        then…
      </button>
    </div>
  );
}
