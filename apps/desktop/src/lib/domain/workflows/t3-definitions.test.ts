import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createWorkflowStep,
  parseWorkflowDefinition,
  serializeWorkflowDefinition,
  type AgentEmitStep,
  type AgentPromptStep,
  type WorkflowAgentNode,
  type WorkflowDefinition,
  type WorkflowInputSpec,
  type WorkflowStep,
} from "@proliferate/product-domain/workflows/definition";
import { parallelizeSpineEntry } from "@proliferate/product-domain/workflows/spine-editing";
import { validateSchemaProfile } from "@proliferate/product-domain/workflows/contracts/schema-profile";
import { validateWorkflowDefinition } from "@proliferate/product-domain/workflows/validation";
import { emitSchemaToModel, fieldsToEmitSchema } from "./emit-schema-model";

/**
 * WS9b acceptance: "a blank editor creates every definition used by T3-WF-1
 * through T3-WF-10" and "save/reload exactly round-trips". These are the
 * version-pinned tier-3 fixtures (`tests/release/fixtures/workflows/*.json`).
 * WF-8 (agent comms) is cut; WF-9/WF-10 fixtures are owned by WS10b and not yet
 * in this branch — the seven present fixtures cover WF-1..WF-7.
 */
const FIXTURE_DIR = fileURLToPath(
  new URL("../../../../../../tests/release/fixtures/workflows/", import.meta.url),
);
const FIXTURES = [
  "wf-emit-gate",
  "wf-invoke-allowed",
  "wf-invoke-denied",
  "wf-integration-denied",
  "wf-parallel-review",
  "wf-poll-feed",
  "wf-schedule-cloud",
] as const;

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(`${FIXTURE_DIR}${name}.json`, "utf8"));
}

/** Every emit step's authored output schema in run order. */
function emitSchemas(definition: WorkflowDefinition): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const entry of definition.agents) {
    const nodes = "parallel" in entry ? entry.parallel : [entry];
    for (const node of nodes as WorkflowAgentNode[]) {
      for (const step of node.steps) {
        if (step.kind === "agent.emit" && step.outputSchema) {
          out.push(step.outputSchema);
        }
      }
    }
  }
  return out;
}

describe("T3-WF fixtures — editor authoring round-trip (WS9b item 8)", () => {
  for (const name of FIXTURES) {
    it(`${name}: parse → serialize → parse is an exact round-trip`, () => {
      const raw = loadFixture(name);
      const canonical = parseWorkflowDefinition(raw);
      const round = parseWorkflowDefinition(serializeWorkflowDefinition(canonical));
      expect(round).toEqual(canonical);
      // And the definition is valid under the shared strict validator.
      expect(validateWorkflowDefinition(canonical)).toEqual([]);
    });

    it(`${name}: every authored emit schema is v1-profile valid and editor-authorable`, () => {
      const canonical = parseWorkflowDefinition(loadFixture(name));
      for (const schema of emitSchemas(canonical)) {
        expect(() => validateSchemaProfile(schema)).not.toThrow();
        const model = emitSchemaToModel(schema);
        if (model.beyondStructured) {
          // Rich schema (enum/bounds) — authored through the raw JSON escape
          // hatch; the structured builder correctly declines to model it.
          continue;
        }
        // Simple schema — the structured builder reproduces it byte-for-byte.
        expect(fieldsToEmitSchema(model.fields)).toEqual(schema);
      }
    });
  }

  it("required invocations parse to the exact {provider, tool} wire shape", () => {
    const emitGate = parseWorkflowDefinition(loadFixture("wf-emit-gate"));
    const promptStep = (emitGate.agents[0] as WorkflowAgentNode).steps[0] as AgentPromptStep;
    expect(promptStep.requiredInvocation).toEqual({ provider: "functions", tool: "record_lookup" });

    const invokeAllowed = parseWorkflowDefinition(loadFixture("wf-invoke-allowed"));
    const caller = (invokeAllowed.agents[0] as WorkflowAgentNode).steps[0] as AgentPromptStep;
    expect(caller.requiredInvocation).toEqual({ provider: "functions", tool: "capture_event" });
  });

  it("builds wf-parallel-review from authoring primitives → same wire as the fixture", () => {
    const canonical = parseWorkflowDefinition(loadFixture("wf-parallel-review"));

    const input: WorkflowInputSpec = { name: "change", type: "text", required: true };
    const emit = (name: string, label: string, prompt: string, schema: Record<string, unknown>): AgentEmitStep => {
      const step = createWorkflowStep("agent.emit") as AgentEmitStep;
      return { ...step, label, name, prompt, outputSchema: schema };
    };
    // Pull only the free-text prose from the parsed fixture; every structural
    // element (kinds, names, labels, parallel group, schemas) is authored here.
    const promptOf = (spineIndex: number, laneIndex: number | null, stepIndex: number): string => {
      const entry = canonical.agents[spineIndex]!;
      const node = laneIndex === null ? (entry as WorkflowAgentNode) : (entry as { parallel: WorkflowAgentNode[] }).parallel[laneIndex]!;
      return (node.steps[stepIndex] as AgentEmitStep).prompt;
    };
    const strSchema = (fields: { name: string; required: boolean }[]) =>
      fieldsToEmitSchema(fields.map((f) => ({ name: f.name, type: "string" as const, required: f.required })))!;

    const intake: WorkflowAgentNode = {
      slot: "intake",
      harness: "claude",
      model: "haiku",
      steps: [emit("plan", "Plan the review", promptOf(0, null, 0), strSchema([
        { name: "angle_a", required: true },
        { name: "angle_b", required: true },
      ]))],
    };
    const reviewA: WorkflowAgentNode = {
      slot: "review_a",
      harness: "claude",
      model: "haiku",
      steps: [emit("review_a_out", "Review angle A", promptOf(1, 0, 0), strSchema([{ name: "verdict", required: true }]))],
    };
    const reviewB: WorkflowAgentNode = {
      slot: "review_b",
      harness: "claude",
      model: "haiku",
      steps: [emit("review_b_out", "Review angle B", promptOf(1, 1, 0), strSchema([{ name: "verdict", required: true }]))],
    };
    const summarize: WorkflowAgentNode = {
      slot: "summarize",
      harness: "claude",
      model: "haiku",
      steps: [emit("summary", "Merge both lane verdicts", promptOf(2, null, 0), strSchema([{ name: "merged", required: true }]))],
    };

    // Author the parallel group with the same spine helper the editor uses.
    const agents = parallelizeSpineEntry([reviewA], 0, reviewB);
    const built: WorkflowDefinition = {
      version: 1,
      name: canonical.name,
      description: canonical.description,
      inputs: [input],
      integrations: [],
      agents: [intake, ...agents, summarize],
    };

    expect(serializeWorkflowDefinition(built)).toEqual(serializeWorkflowDefinition(canonical));
    expect(parseWorkflowDefinition(serializeWorkflowDefinition(built))).toEqual(canonical);
    expect(validateWorkflowDefinition(built)).toEqual([]);
  });

  it("builds wf-schedule-cloud from a blank single-agent editor", () => {
    const canonical = parseWorkflowDefinition(loadFixture("wf-schedule-cloud"));
    const emitStep = createWorkflowStep("agent.emit") as AgentEmitStep;
    const promptText = ((canonical.agents[0] as WorkflowAgentNode).steps[0] as AgentEmitStep).prompt;
    const step: WorkflowStep = {
      ...emitStep,
      label: "Do the scheduled tick",
      name: "tick",
      prompt: promptText,
      outputSchema: fieldsToEmitSchema([{ name: "ran", type: "boolean", required: true }])!,
    };
    const built: WorkflowDefinition = {
      version: 1,
      name: canonical.name,
      description: canonical.description,
      inputs: [],
      integrations: [],
      agents: [{ slot: "scheduled", harness: "claude", model: "haiku", steps: [step] }],
    };
    expect(serializeWorkflowDefinition(built)).toEqual(serializeWorkflowDefinition(canonical));
  });
});
