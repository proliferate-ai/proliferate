import type {
  ContentPart,
  PromptProvenance,
  ToolCallItem,
  TranscriptItem,
  TranscriptState,
} from "@anyharness/sdk";
import {
  extractClaudePlanBody,
  isClaudeExitPlanModeCall,
} from "../tools/claude-plan-tool-call";
import { deriveCoworkCodingToolPresentation } from "../tools/cowork-coding-tool-presentation";
import { describeToolCallDisplay } from "../tools/tool-call-display";
import { normalizeToolResultText } from "../tools/tool-result-text";
import {
  formatReviewFeedbackTranscriptText,
  formatWakePromptTranscriptText,
  isSubagentWakeProvenance,
  resolveReviewFeedbackPromptReference,
} from "../subagents/provenance";
import { resolveSubagentLaunchDisplay } from "../subagents/subagent-launch";
import {
  getToolCallParsedCommands,
  getToolCallShellCommand,
} from "./transcript-tool-commands";
import { hasProposedPlanForToolCallItem } from "./transcript-rendering";

export function serializeTranscriptItem(
  item: TranscriptItem,
  transcript: TranscriptState,
  proposedPlanToolCallIds: ReadonlySet<string>,
): string[] {
  switch (item.kind) {
    case "user_message":
      return serializeUserPromptContent({
        parts: item.contentParts,
        text: item.text,
        promptProvenance: item.promptProvenance,
        transcript,
        state: "completed",
      });
    case "assistant_prose":
      return normalizeCopySections([item.text]);
    case "thought":
      return item.isTransient ? [] : normalizeCopySections([item.text]);
    case "tool_call":
      return serializeToolCall(item, proposedPlanToolCallIds);
    case "proposed_plan":
      return normalizeCopySections([item.plan.title, item.plan.bodyMarkdown]);
    case "plan":
      return [];
    case "error":
      return normalizeCopySections([item.message]);
    case "unknown":
      return [];
  }
}

export function serializeUserPromptContent({
  parts,
  text,
  promptProvenance,
  transcript,
  state,
}: {
  parts: readonly ContentPart[];
  text: string;
  promptProvenance: PromptProvenance | null | undefined;
  transcript: TranscriptState;
  state: "queued" | "completed";
}): string[] {
  if (isSubagentWakeProvenance(promptProvenance)) {
    return normalizeCopySections([
      formatWakePromptTranscriptText(
        promptProvenance,
        transcript.linkCompletionsByCompletionId[promptProvenance.completionId] ?? null,
      ),
    ]);
  }

  const reviewReference = resolveReviewFeedbackPromptReference(promptProvenance, text);
  if (reviewReference) {
    return normalizeCopySections([
      formatReviewFeedbackTranscriptText(reviewReference, state),
    ]);
  }

  return serializePromptContent(parts, text);
}

export function joinTranscriptCopySections(sections: readonly string[]): string {
  return dedupeAdjacentSections(
    sections.map((section) => section.trim()).filter(Boolean),
  ).join("\n\n");
}

function serializeToolCall(
  item: ToolCallItem,
  proposedPlanToolCallIds: ReadonlySet<string>,
): string[] {
  if (isClaudeExitPlanModeCall(item)) {
    if (hasProposedPlanForToolCallItem(proposedPlanToolCallIds, item)) {
      return [];
    }
    return normalizeCopySections([extractClaudePlanBody(item)]);
  }

  const sections: string[] = [];

  if (item.semanticKind === "subagent" || item.nativeToolName === "Agent") {
    const display = resolveSubagentLaunchDisplay(item);
    sections.push(...normalizeCopySections([
      display.title,
      display.meta,
      display.prompt,
    ]));
  }

  const cowork = deriveCoworkCodingToolPresentation(item);
  if (cowork) {
    sections.push(...normalizeCopySections([
      cowork.label,
      cowork.displayName,
      cowork.meta,
      cowork.prompt,
      cowork.promptStatus,
      cowork.sourceWorkspaceId,
      cowork.workspaceId,
      cowork.coworkWorkspaceId,
      cowork.codingSessionId,
      cowork.coworkAgentId,
    ]));
  }

  const parsedCommands = getToolCallParsedCommands(item);
  sections.push(...parsedCommands.flatMap((command) => normalizeCopySections([
    command.command,
    command.path,
    command.query,
    command.name,
  ])));

  if (parsedCommands.length === 0) {
    sections.push(...normalizeCopySections([getToolCallShellCommand(item)]));
  }

  sections.push(...item.contentParts.flatMap(serializeContentPart));

  if (!item.contentParts.some((part) => part.type === "tool_result_text")) {
    sections.push(...normalizeCopySections([
      typeof item.rawOutput === "string"
        ? normalizeToolResultText(item.rawOutput)
        : null,
    ]));
  }

  if (sections.length === 0) {
    const display = describeToolCallDisplay(
      item,
      item.title ?? item.nativeToolName ?? "Tool call",
    );
    sections.push(...normalizeCopySections([display.label, display.hint]));
  }

  return dedupeAdjacentSections(sections);
}

function serializePromptContent(
  parts: readonly ContentPart[],
  fallbackText: string,
): string[] {
  const sections = parts.flatMap(serializeContentPart);
  if (sections.length > 0) {
    return sections;
  }
  return normalizeCopySections([fallbackText]);
}

function serializeContentPart(part: ContentPart): string[] {
  switch (part.type) {
    case "text":
      return normalizeCopySections([part.text]);
    case "image":
      return normalizeCopySections([
        formatAttachment("Image", part.name ?? part.uri ?? part.attachmentId),
        part.uri ?? null,
      ]);
    case "resource":
      return normalizeCopySections([
        formatAttachment("Resource", part.name ?? part.uri),
        part.uri,
        part.preview ?? null,
      ]);
    case "resource_link":
      return normalizeCopySections([
        formatAttachment("Resource link", part.title ?? part.name ?? part.uri),
        part.uri,
        part.description ?? null,
      ]);
    case "reasoning":
      return normalizeCopySections([part.text]);
    case "terminal_output":
      return normalizeCopySections([
        part.data ?? null,
        part.exitCode !== null && part.exitCode !== undefined
          ? `exit ${part.exitCode}`
          : null,
        part.signal ? `signal ${part.signal}` : null,
      ]);
    case "file_read":
      return normalizeCopySections([
        part.workspacePath ?? part.path,
        part.preview ?? null,
      ]);
    case "file_change":
      return normalizeCopySections([
        formatFileChange(
          part.operation,
          part.workspacePath ?? part.path,
          part.newWorkspacePath ?? part.newPath ?? null,
        ),
        part.patch ?? part.preview ?? null,
      ]);
    case "proposed_plan":
    case "plan_reference":
      return normalizeCopySections([part.title, part.bodyMarkdown]);
    case "tool_input_text":
      return normalizeCopySections([part.text]);
    case "tool_result_text":
      return normalizeCopySections([normalizeToolResultText(part.text)]);
    case "tool_call":
    case "plan":
    case "proposed_plan_decision":
      return [];
  }
}

function formatAttachment(label: string, value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? `${label}: ${trimmed}` : label;
}

function formatFileChange(
  operation: string,
  path: string,
  newPath: string | null,
): string {
  return newPath ? `${operation}: ${path} -> ${newPath}` : `${operation}: ${path}`;
}

function normalizeCopySections(values: readonly (string | null | undefined)[]): string[] {
  return values
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length > 0);
}

function dedupeAdjacentSections(sections: readonly string[]): string[] {
  const deduped: string[] = [];
  for (const section of sections) {
    if (deduped[deduped.length - 1] !== section) {
      deduped.push(section);
    }
  }
  return deduped;
}
