import { describe, expect, it } from "vitest";
import type { WorkflowInputSpec } from "@proliferate/product-domain/workflows/definition";
import { FRESH_SESSION_CHOICE } from "@proliferate/product-domain/workflows/run-launch";
import {
  initialWorkflowRunArgValues,
  resolvedWorkflowRunArgs,
  workflowRunSessionBindings,
} from "./run-args-model";

const INPUTS: WorkflowInputSpec[] = [
  { name: "title", type: "text", required: true },
  { name: "attempts", type: "number", required: false },
  { name: "notify", type: "boolean", required: false },
  { name: "priority", type: "choice", required: false, choices: ["normal", "urgent"] },
  { name: "owner", type: "text", required: false, default: "platform" },
];

describe("workflow run argument model", () => {
  it("initializes every input using its declared default or type default", () => {
    expect(initialWorkflowRunArgValues(INPUTS)).toEqual({
      title: "",
      attempts: "",
      notify: false,
      priority: "normal",
      owner: "platform",
    });
  });

  it("omits blank optional values and converts submitted number inputs", () => {
    expect(
      resolvedWorkflowRunArgs(INPUTS, {
        title: "Fix billing",
        attempts: "3",
        notify: true,
        priority: "",
        owner: "platform",
      }),
    ).toEqual({
      title: "Fix billing",
      attempts: 3,
      notify: true,
      owner: "platform",
    });
  });

  it("submits one session binding per slot and defaults unbound slots to fresh sessions", () => {
    const slots = [
      { slot: "implement", harness: "claude", model: "sonnet" },
      { slot: "review", harness: "codex", model: "gpt-5" },
    ];

    expect(workflowRunSessionBindings(slots, { review: "session-review" })).toEqual([
      { slot: "implement", sessionId: FRESH_SESSION_CHOICE },
      { slot: "review", sessionId: "session-review" },
    ]);
  });
});
