import { useState } from "react";
import type { WorkflowArgSpec, WorkflowSetup } from "@proliferate/product-domain/workflows/definition";
import { WorkflowMetaCard } from "@/components/workflows/editor/WorkflowMetaCard";
import { WorkflowSetupCard } from "@/components/workflows/editor/WorkflowSetupCard";
import type { EditorAgent } from "@/components/workflows/editor/WorkflowStepPanel";

const AGENTS: EditorAgent[] = [
  { kind: "claude", displayName: "Claude Code", models: [{ id: "opus", label: "Opus 4.8" }] },
  { kind: "codex", displayName: "Codex", models: [{ id: "gpt", label: "GPT-5" }] },
];

/**
 * Setup / meta cards — exercises the swept Input/Textarea primitives and the
 * WorkflowSelect popover pickers (arg type, session) on the card surface.
 */
export function WorkflowFormsFixtures() {
  const [name, setName] = useState("Fix until green");
  const [description, setDescription] = useState("Investigate and fix failing tests until the suite passes.");
  const [setup, setSetup] = useState<WorkflowSetup>({ harness: "claude", model: "opus", sessionBinding: "fresh" });
  const [args, setArgs] = useState<WorkflowArgSpec[]>([
    { name: "pr_number", type: "number", required: true },
    { name: "env", type: "enum", enum: ["staging", "prod"], required: false, default: "staging" },
  ]);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-ui-sm font-semibold text-muted-foreground">Meta &amp; Setup cards — inputs + pickers</h2>
      <div className="flex w-[560px] flex-col gap-3">
        <WorkflowMetaCard
          name={name}
          description={description}
          onNameChange={setName}
          onDescriptionChange={setDescription}
        />
        <WorkflowSetupCard setup={setup} args={args} agents={AGENTS} onSetupChange={setSetup} onArgsChange={setArgs} />
      </div>
    </section>
  );
}
