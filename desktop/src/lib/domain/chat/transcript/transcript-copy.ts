import type {
  ContentPart,
  PendingPromptEntry,
  PromptProvenance,
  ToolCallItem,
  TranscriptItem,
  TranscriptState,
  TurnRecord,
} from "@anyharness/sdk";
import {
  extractClaudePlanBody,
  isClaudeExitPlanModeCall,
} from "@/lib/domain/chat/tools/claude-plan-tool-call";
import { deriveCoworkCodingToolPresentation } from "@/lib/domain/chat/tools/cowork-coding-tool-presentation";
import { describeToolCallDisplay } from "@/lib/domain/chat/tools/tool-call-display";
import { normalizeToolResultText } from "@/lib/domain/chat/tools/tool-result-text";
import {
  formatReviewFeedbackTranscriptText,
  formatWakePromptTranscriptText,
  isSubagentWakeProvenance,
  resolveReviewFeedbackPromptReference,
} from "@/lib/domain/chat/subagents/provenance";
import {
  buildTurnPresentation,
  getToolCallParsedCommands,
  getToolCallShellCommand,
  type TurnDisplayBlock,
} from "@/lib/domain/chat/transcript/transcript-presentation";
import { resolveSubagentLaunchDisplay } from "@/lib/domain/chat/subagents/subagent-launch";

export interface BuildTranscriptCopyTextArgs {
  transcript: TranscriptState;
  visibleTurnIds: readonly string[];
  visibleOptimisticPrompt: PendingPromptEntry | null;
  proposedPlanToolCallIds: ReadonlySet<string>;
}

export function buildTranscriptCopyText({
  transcript,
  visibleTurnIds,
  visibleOptimisticPrompt,
  proposedPlanToolCallIds,
}: BuildTranscriptCopyTextArgs): string {
  const sections = visibleTurnIds.flatMap((turnId) => {
    const turn = transcript.turnsById[turnId];
    return turn
      ? serializeTurn(turn, transcript, proposedPlanToolCallIds)
      : [];
  });

  if (visibleOptimisticPrompt) {
    sections.push(...serializeUserPromptContent({
      parts: visibleOptimisticPrompt.contentParts,
      text: visibleOptimisticPrompt.text,
      promptProvenance: visibleOptimisticPrompt.promptProvenance,
      transcript,
      state: "queued",
    }));
  }

  return joinSections(sections);
}

function serializeTurn(
  turn: TurnRecord,
  transcript: TranscriptState,
  proposedPlanToolCallIds: ReadonlySet<string>,
): string[] {
  const presentation = buildTurnPresentation(turn, transcript);
  const completedHistoryIds = new Set(presentation.completedHistoryRootIds);
  let emittedCompletedHistory = false;
  const sections: string[] = [];

  for (const block of presentation.displayBlocks) {
    if (blockIncludesCompletedHistory(block, completedHistoryIds)) {
      if (!emittedCompletedHistory) {
        sections.push(...serializeItemIds(
          presentation.completedHistoryRootIds,
          transcript,
          presentation.childrenByParentId,
          proposedPlanToolCallIds,
        ));
        emittedCompletedHistory = true;
      }
      continue;
    }

    sections.push(...serializeDisplayBlock(
      block,
      transcript,
      presentation.childrenByParentId,
      proposedPlanToolCallIds,
    ));
  }

  return sections;
}

function blockIncludesCompletedHistory(
  block: TurnDisplayBlock,
  completedHistoryIds: ReadonlySet<string>,
): boolean {
  switch (block.kind) {
    case "collapsed_actions":
    case "inline_tools":
      return block.itemIds.some((itemId) => completedHistoryIds.has(itemId));
    case "inline_tool":
    case "item":
      return completedHistoryIds.has(block.itemId);
  }
}

function serializeDisplayBlock(
  block: TurnDisplayBlock,
  transcript: TranscriptState,
  childrenByParentId: Map<string, string[]>,
  proposedPlanToolCallIds: ReadonlySet<string>,
): string[] {
  switch (block.kind) {
    case "collapsed_actions":
    case "inline_tools":
      return serializeItemIds(
        block.itemIds,
        transcript,
        childrenByParentId,
        proposedPlanToolCallIds,
      );
    case "inline_tool":
    case "item":
      return serializeItemTree(
        block.itemId,
        transcript,
        childrenByParentId,
        proposedPlanToolCallIds,
      );
  }
}

function serializeItemIds(
  itemIds: readonly string[],
  transcript: TranscriptState,
  childrenByParentId: Map<string, string[]>,
  proposedPlanToolCallIds: ReadonlySet<string>,
): string[] {
  return itemIds.flatMap((itemId) => serializeItemTree(
    itemId,
    transcript,
    childrenByParentId,
    proposedPlanToolCallIds,
  ));
}

function serializeItemTree(
  itemId: string,
  transcript: TranscriptState,
  childrenByParentId: Map<string, string[]>,
  proposedPlanToolCallIds: ReadonlySet<string>,
): string[] {
  const item = transcript.itemsById[itemId];
  if (!item) {
    return [];
  }

  const ownSections = serializeTranscriptItem(item, transcript, proposedPlanToolCallIds);
  const childSections = serializeItemIds(
    childrenByParentId.get(itemId) ?? [],
    transcript,
    childrenByParentId,
    proposedPlanToolCallIds,
  );

  return [...ownSections, ...childSections];
}

function serializeTranscriptItem(
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
      return normalizeSections([item.text]);
    case "thought":
      return item.isTransient ? [] : normalizeSections([item.text]);
    case "tool_call":
      return serializeToolCall(item, proposedPlanToolCallIds);
    case "proposed_plan":
      return normalizeSections([item.plan.title, item.plan.bodyMarkdown]);
    case "plan":
      return [];
    case "error":
      return normalizeSections([item.message]);
    case "unknown":
      return [];
  }
}

function serializeToolCall(
  item: ToolCallItem,
  proposedPlanToolCallIds: ReadonlySet<string>,
): string[] {
  if (isClaudeExitPlanModeCall(item)) {
    if (item.toolCallId && proposedPlanToolCallIds.has(item.toolCallId)) {
      return [];
    }
    return normalizeSections([extractClaudePlanBody(item)]);
  }

  const sections: string[] = [];

  if (item.semanticKind === "subagent" || item.nativeToolName === "Agent") {
    const display = resolveSubagentLaunchDisplay(item);
    sections.push(...normalizeSections([
      display.title,
      display.meta,
      display.prompt,
    ]));
  }

  const cowork = deriveCoworkCodingToolPresentation(item);
  if (cowork) {
    sections.push(...normalizeSections([
      cowork.label,
      cowork.displayName,
      cowork.meta,
      cowork.prompt,
      cowork.promptStatus,
      cowork.sourceWorkspaceId,
      cowork.workspaceId,
      cowork.codingSessionId,
    ]));
  }

  const parsedCommands = getToolCallParsedCommands(item);
  sections.push(...parsedCommands.flatMap((command) => normalizeSections([
    command.command,
    command.path,
    command.query,
    command.name,
  ])));

  if (parsedCommands.length === 0) {
    sections.push(...normalizeSections([getToolCallShellCommand(item)]));
  }

  sections.push(...item.contentParts.flatMap(serializeContentPart));

  if (!item.contentParts.some((part) => part.type === "tool_result_text")) {
    sections.push(...normalizeSections([
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
    sections.push(...normalizeSections([display.label, display.hint]));
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
  return normalizeSections([fallbackText]);
}

function serializeUserPromptContent({
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
    return normalizeSections([
      formatWakePromptTranscriptText(
        promptProvenance,
        transcript.linkCompletionsByCompletionId[promptProvenance.completionId] ?? null,
      ),
    ]);
  }

  const reviewReference = resolveReviewFeedbackPromptReference(promptProvenance, text);
  if (reviewReference) {
    return normalizeSections([
      formatReviewFeedbackTranscriptText(reviewReference, state),
    ]);
  }

  return serializePromptContent(parts, text);
}

function serializeContentPart(part: ContentPart): string[] {
  switch (part.type) {
    case "text":
      return normalizeSections([part.text]);
    case "image":
      return normalizeSections([
        formatAttachment("Image", part.name ?? part.uri ?? part.attachmentId),
        part.uri ?? null,
      ]);
    case "resource":
      return normalizeSections([
        formatAttachment("Resource", part.name ?? part.uri),
        part.uri,
        part.preview ?? null,
      ]);
    case "resource_link":
      return normalizeSections([
        formatAttachment("Resource link", part.title ?? part.name ?? part.uri),
        part.uri,
        part.description ?? null,
      ]);
    case "reasoning":
      return normalizeSections([part.text]);
    case "terminal_output":
      return normalizeSections([
        part.data ?? null,
        part.exitCode !== null && part.exitCode !== undefined
          ? `exit ${part.exitCode}`
          : null,
        part.signal ? `signal ${part.signal}` : null,
      ]);
    case "file_read":
      return normalizeSections([
        part.workspacePath ?? part.path,
        part.preview ?? null,
      ]);
    case "file_change":
      return normalizeSections([
        formatFileChange(
          part.operation,
          part.workspacePath ?? part.path,
          part.newWorkspacePath ?? part.newPath ?? null,
        ),
        part.patch ?? part.preview ?? null,
      ]);
    case "proposed_plan":
    case "plan_reference":
      return normalizeSections([part.title, part.bodyMarkdown]);
    case "tool_input_text":
      return normalizeSections([part.text]);
    case "tool_result_text":
      return normalizeSections([normalizeToolResultText(part.text)]);
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

function normalizeSections(values: readonly (string | null | undefined)[]): string[] {
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

function joinSections(sections: readonly string[]): string {
  return dedupeAdjacentSections(
    sections.map((section) => section.trim()).filter(Boolean),
  ).join("\n\n");
}
