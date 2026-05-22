import { describe, expect, it } from "vitest";
import type { ToolCallItem } from "@anyharness/sdk";
import { deriveSkillsToolResultPresentation } from "./skills-tool-result";

describe("deriveSkillsToolResultPresentation", () => {
  it("formats activate_skill JSON emitted as result text", () => {
    const presentation = deriveSkillsToolResultPresentation(
      toolCallItem({
        nativeToolName: "mcp__proliferate_skills__activate_skill",
      }),
      JSON.stringify({
        skillId: "connector.conn_linear.issue-triage",
        displayName: "Linear issue triage",
        description: "Search, inspect, and summarize Linear work.",
        instructions: "# Linear issue triage\n\n1. Fetch the issue.",
        requiredMcpServers: ["linear"],
        credentialBindingIds: ["conn_linear"],
        resources: [
          {
            resourceId: "examples",
            displayName: "Examples",
            contentType: "text/markdown",
          },
        ],
      }),
    );

    expect(presentation).toEqual({
      kind: "activate",
      skillId: "connector.conn_linear.issue-triage",
      displayName: "Linear issue triage",
      description: "Search, inspect, and summarize Linear work.",
      instructions: "# Linear issue triage\n\n1. Fetch the issue.",
      requiredMcpServers: ["linear"],
      credentialBindingIds: ["conn_linear"],
      resources: [
        {
          resourceId: "examples",
          displayName: "Examples",
          contentType: "text/markdown",
        },
      ],
    });
  });

  it("formats list_available_skills JSON from raw output", () => {
    const presentation = deriveSkillsToolResultPresentation(
      toolCallItem({
        nativeToolName: "mcp__proliferate_skills__list_available_skills",
        rawOutput: {
          skills: [
            {
              skillId: "connector.conn_github.review",
              displayName: "GitHub review",
              description: "Inspect pull requests.",
              requiredMcpServers: ["github"],
              resourceCount: 0,
            },
          ],
        },
      }),
      "",
    );

    expect(presentation).toEqual({
      kind: "list",
      skills: [
        {
          skillId: "connector.conn_github.review",
          displayName: "GitHub review",
          description: "Inspect pull requests.",
          requiredMcpServers: ["github"],
          resourceCount: 0,
        },
      ],
    });
  });

  it("returns null for malformed skill output", () => {
    expect(deriveSkillsToolResultPresentation(
      toolCallItem({
        nativeToolName: "mcp__proliferate_skills__activate_skill",
      }),
      "{\"skillId\":\"missing-fields\"}",
    )).toBeNull();
  });
});

function toolCallItem(overrides: Partial<ToolCallItem>): ToolCallItem {
  return {
    kind: "tool_call",
    itemId: "tool-1",
    turnId: "turn-1",
    status: "completed",
    sourceAgentKind: "claude",
    messageId: null,
    title: null,
    nativeToolName: null,
    parentToolCallId: null,
    rawInput: undefined,
    rawOutput: undefined,
    contentParts: [],
    timestamp: "2026-04-12T00:00:00Z",
    startedSeq: 1,
    lastUpdatedSeq: 1,
    completedSeq: 2,
    completedAt: "2026-04-12T00:00:01Z",
    toolCallId: "toolu_1",
    toolKind: "other",
    semanticKind: "other",
    approvalState: "none",
    ...overrides,
  } as ToolCallItem;
}
