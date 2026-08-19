import { describe, expect, it } from "vitest";
import {
  blankWorkflowBuilderDraft,
  draftToDefinition,
  workflowBuilderActions,
  type WorkflowBuilderDraft,
} from "./workflow-builder-draft";

/**
 * Round-trip serialization for ruling F5's per-leg prompts (rung 5 of the
 * Follow-up Workflows ADR): absent `legs` stays byte-identical, 2..8 legs
 * serialize exactly as the frozen wire shape, and removing legs back down to
 * one collapses the node to today's shape (`legs` omitted, never length 1).
 */
describe("workflow-builder-draft: node legs round-trip (ruling F5)", () => {
  function draftWithEditor(): {
    getDraft: () => WorkflowBuilderDraft;
    actions: ReturnType<typeof workflowBuilderActions>;
  } {
    let draft = blankWorkflowBuilderDraft();
    const actions = workflowBuilderActions((edit) => {
      draft = edit(draft);
    });
    return { getDraft: () => draft, actions };
  }

  it("absent legs round-trips with no `legs` key at all", () => {
    const { getDraft } = draftWithEditor();
    const definition = draftToDefinition(getDraft());
    expect(definition.nodes[0]).not.toHaveProperty("legs");
    expect(JSON.stringify(definition.nodes[0])).not.toContain("legs");
  });

  it("adding a leg fans out to 2, and the node's prompt mirrors leg 0", () => {
    const { getDraft, actions } = draftWithEditor();
    actions.updateNode("step-1", { prompt: "Solo prompt" });
    actions.addLeg("step-1");
    const definition = draftToDefinition(getDraft());
    const node = definition.nodes[0];
    expect(node.legs).toEqual([{ prompt: "Solo prompt" }, { prompt: "" }]);
    expect(node.prompt).toBe("Solo prompt");
  });

  it("2-leg node round-trips exactly as the wire shape after editing both legs", () => {
    const { getDraft, actions } = draftWithEditor();
    actions.addLeg("step-1");
    actions.updateLeg("step-1", 0, "Correctness review");
    actions.updateLeg("step-1", 1, "Security review");
    const definition = draftToDefinition(getDraft());
    const node = definition.nodes[0];
    expect(node.prompt).toBe("Correctness review");
    expect(node.legs).toEqual([
      { prompt: "Correctness review" },
      { prompt: "Security review" },
    ]);
  });

  it("growing to 8 legs then back down to 1 collapses `legs` away entirely", () => {
    const { getDraft, actions } = draftWithEditor();
    for (let i = 0; i < 7; i += 1) {
      actions.addLeg("step-1");
    }
    expect(getDraft().nodes[0].legs).toHaveLength(8);
    // Adding a 9th is a no-op: legs never grow past 8.
    actions.addLeg("step-1");
    expect(getDraft().nodes[0].legs).toHaveLength(8);

    for (let i = 0; i < 7; i += 1) {
      actions.removeLeg("step-1", 1);
    }
    const definition = draftToDefinition(getDraft());
    const node = definition.nodes[0];
    expect(node).not.toHaveProperty("legs");
  });

  // Negative control: a hand-built definition with a length-1 `legs` array is
  // exactly the shape rung 5's validator rejects (`invalid_leg_count`) and
  // the collapse logic above exists to prevent producing. Asserting it here
  // pins that this test suite would in fact fail if the collapse regressed.
  it("negative control: a length-1 legs array is not the round-trip's output", () => {
    const { getDraft, actions } = draftWithEditor();
    actions.addLeg("step-1");
    actions.removeLeg("step-1", 1);
    const definition = draftToDefinition(getDraft());
    const node = definition.nodes[0];
    expect(node.legs).toBeUndefined();
    // The shape a regression would produce instead:
    expect(node.legs).not.toEqual([{ prompt: "" }]);
  });
});
