import type { CoworkArtifactSummary } from "@anyharness/sdk";
import { toolCallItem } from "@/lib/domain/chat/__fixtures__/playground/tool-call-item-fixture";

const PLAYGROUND_ARTIFACT_SUMMARY: CoworkArtifactSummary = {
  id: "artifact-playground",
  path: "artifacts/status-board.tsx",
  type: "application/vnd.proliferate.react",
  title: "Status board",
  description: "Compact artifact row preview",
  createdAt: "2026-04-12T00:00:00Z",
  updatedAt: "2026-04-12T00:00:01Z",
  exists: true,
  sizeBytes: 2048,
  modifiedAt: "2026-04-12T00:00:01Z",
};

export const PLAYGROUND_COWORK_ARTIFACT_TOOL_CALL = toolCallItem({
  itemId: "tool-artifact",
  toolCallId: "tool-artifact",
  title: "Create artifact",
  nativeToolName: "mcp__cowork__create_artifact",
  semanticKind: "cowork_artifact_create",
  rawInput: {
    title: "Status board",
    path: "artifacts/status-board.tsx",
  },
  rawOutput: PLAYGROUND_ARTIFACT_SUMMARY,
});
