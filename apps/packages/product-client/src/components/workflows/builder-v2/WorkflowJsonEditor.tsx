import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkflowDefinitionV2 } from "@proliferate/cloud-sdk";
import {
  formatWorkflowDefinitionJson,
  parseWorkflowDefinitionJson,
} from "#product/lib/domain/workflows/workflow-builder-json";
import { Button } from "#product/primitives/Button";
import { StatusDot } from "#product/primitives/StatusDot";
import { Textarea } from "#product/primitives/Textarea";

export function WorkflowJsonEditor({
  definition,
  active,
  disabled,
  onApply,
  onValidityChange,
}: {
  definition: WorkflowDefinitionV2;
  active: boolean;
  disabled: boolean;
  onApply: (definition: WorkflowDefinitionV2) => void;
  onValidityChange: (valid: boolean) => void;
}) {
  const [source, setSource] = useState(() => formatWorkflowDefinitionJson(definition));
  const [error, setError] = useState<string | null>(() => {
    const initial = parseWorkflowDefinitionJson(formatWorkflowDefinitionJson(definition));
    return initial.ok ? null : initial.message;
  });
  const wasActive = useRef(false);
  const seededSource = useRef(source);

  /**
   * Replace the pane with the graph's own document. An incomplete draft does
   * not parse (a step still needs a title or a prompt), and that is the
   * builder's issue to report, not this pane's: the validity flag the save
   * gate reads describes JSON the author typed, so seeding always clears it.
   */
  const seedFromDefinition = useCallback(() => {
    const nextSource = formatWorkflowDefinitionJson(definition);
    const parsed = parseWorkflowDefinitionJson(nextSource);
    seededSource.current = nextSource;
    setSource(nextSource);
    setError(parsed.ok ? null : parsed.message);
    onValidityChange(true);
  }, [definition, onValidityChange]);

  useEffect(() => {
    const becameActive = active && !wasActive.current;
    wasActive.current = active;
    // Unparseable text the author typed is theirs to fix rather than ours to
    // discard; text this pane seeded is not an edit at all and keeps tracking
    // the graph even while the draft is still incomplete.
    if (!becameActive) return;
    if (source !== seededSource.current && !parseWorkflowDefinitionJson(source).ok) return;
    seedFromDefinition();
  }, [active, seedFromDefinition, source]);

  const update = (next: string) => {
    setSource(next);
    const parsed = parseWorkflowDefinitionJson(next);
    if (!parsed.ok) {
      setError(parsed.message);
      onValidityChange(false);
      return;
    }
    setError(null);
    onValidityChange(true);
    onApply(parsed.definition);
  };

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-surface-editor">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <span className="font-mono text-ui-sm text-muted-foreground">workflow-definition.json</span>
        <span className="flex items-center gap-1.5 text-ui-sm text-muted-foreground" role="status">
          <StatusDot tone={error ? "warning" : "success"} />
          {error ?? "Valid WorkflowDefinitionV2"}
        </span>
      </div>
      <Textarea
        variant="flush"
        aria-label="Workflow definition JSON"
        aria-invalid={error ? "true" : undefined}
        value={source}
        disabled={disabled}
        className="min-h-0 flex-1 resize-none font-mono text-readable-code"
        onChange={(event) => update(event.currentTarget.value)}
      />
      <div className="flex justify-end gap-2 border-t border-border px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || error !== null}
          onClick={() => {
            const parsed = parseWorkflowDefinitionJson(source);
            if (parsed.ok) setSource(formatWorkflowDefinitionJson(parsed.definition));
          }}
        >
          Format
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={seedFromDefinition}
        >
          Revert
        </Button>
      </div>
    </section>
  );
}
