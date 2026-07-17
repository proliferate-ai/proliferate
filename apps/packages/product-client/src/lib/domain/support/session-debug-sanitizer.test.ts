import { describe, expect, it } from "vitest";
import type {
  ContentPart,
  Session,
  SessionEventEnvelope,
  SessionRawNotificationEnvelope,
} from "@anyharness/sdk";
import {
  sanitizeSessionDebugContentParts,
  sanitizeSessionDebugExportedSession,
} from "#product/lib/domain/support/session-debug/sanitizer";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-12345678",
    workspaceId: "workspace-12345678",
    agentKind: "codex",
    status: "idle",
    title: "Debug session",
    modelId: "gpt-5.4",
    modeId: "default",
    nativeSessionId: "native-1",
    createdAt: "2026-04-16T18:00:00.000Z",
    updatedAt: "2026-04-16T18:20:00.000Z",
    ...overrides,
    actionCapabilities: overrides.actionCapabilities ?? { fork: false, targetedFork: false },
  };
}

describe("sanitizeSessionDebugContentParts", () => {
  it("redacts textual content and resource previews without changing part shape", () => {
    const parts = [
      { type: "text", text: "abc" },
      { type: "tool_input_text", text: "input" },
      { type: "tool_result_text", text: "result" },
      {
        type: "resource",
        uri: "file:///tmp/secret.txt",
        name: "secret.txt",
        mimeType: "text/plain",
        preview: "preview",
      },
      {
        type: "file_read",
        path: "/repo/secret.txt",
        preview: "file preview",
      },
    ] satisfies ContentPart[];

    const sanitized = sanitizeSessionDebugContentParts(parts);

    expect(JSON.stringify(sanitized)).not.toContain("secret");
    expect(sanitized).toEqual([
      { type: "text", text: "[redacted:3]" },
      { type: "tool_input_text", text: "[redacted:5]" },
      { type: "tool_result_text", text: "[redacted:6]" },
      {
        type: "resource",
        uri: "[redacted:22]",
        name: "[redacted:10]",
        mimeType: "[redacted:10]",
        preview: "[redacted:7]",
      },
      {
        type: "file_read",
        path: "[redacted:16]",
        preview: "[redacted:12]",
      },
    ]);
  });

  it("fails closed for every current content shape and unknown future shapes", () => {
    const privateContent = "private sentinel";
    const parts = [
      { type: "text", text: privateContent },
      {
        type: "image",
        attachmentId: "attachment-id",
        mimeType: "image/png",
        name: privateContent,
        uri: privateContent,
      },
      {
        type: "resource",
        mimeType: "text/plain",
        name: privateContent,
        preview: privateContent,
        uri: privateContent,
      },
      {
        type: "resource_link",
        description: privateContent,
        name: privateContent,
        title: privateContent,
        uri: privateContent,
      },
      { type: "reasoning", text: privateContent, visibility: "private" },
      {
        type: "tool_call",
        nativeToolName: "shell",
        title: privateContent,
        toolCallId: "tool-call-id",
      },
      {
        type: "terminal_output",
        data: privateContent,
        event: "output",
        terminalId: "terminal-id",
      },
      {
        type: "file_read",
        basename: privateContent,
        path: privateContent,
        preview: privateContent,
        scope: "full",
        workspacePath: privateContent,
      },
      {
        type: "file_change",
        basename: privateContent,
        newBasename: privateContent,
        newPath: privateContent,
        newWorkspacePath: privateContent,
        operation: "edit",
        patch: privateContent,
        path: privateContent,
        preview: privateContent,
        workspacePath: privateContent,
      },
      { type: "plan", entries: [{ content: privateContent, status: "pending" }] },
      {
        type: "proposed_plan",
        bodyMarkdown: privateContent,
        planId: "plan-id",
        snapshotHash: privateContent,
        sourceKind: "agent",
        sourceSessionId: "session-id",
        title: privateContent,
      },
      {
        type: "plan_reference",
        bodyMarkdown: privateContent,
        planId: "plan-id",
        snapshotHash: privateContent,
        sourceKind: "agent",
        sourceSessionId: "session-id",
        title: privateContent,
      },
      {
        type: "proposed_plan_decision",
        decisionState: "rejected",
        decisionVersion: 1,
        errorMessage: privateContent,
        nativeResolutionState: "failed",
        planId: "plan-id",
      },
      { type: "tool_input_text", text: privateContent },
      { type: "tool_result_text", text: privateContent },
    ] satisfies ContentPart[];
    const futurePart = {
      type: "future_content",
      body: privateContent,
      code: privateContent,
      createdAt: privateContent,
      id: privateContent,
      location: privateContent,
      nativeToolName: privateContent,
      reason: privateContent,
      scope: privateContent,
      source: privateContent,
      status: privateContent,
      [privateContent]: true,
    } as unknown as ContentPart;

    const sanitized = sanitizeSessionDebugContentParts([...parts, futurePart]);

    expect(JSON.stringify(sanitized)).not.toContain(privateContent);
    expect(Object.keys(sanitized.at(-1) as object).some((key) => (
      key.startsWith("[redacted-key:16:")
    ))).toBe(true);
    expect(sanitized.map((part) => part.type)).toEqual([
      ...parts.map((part) => part.type),
      "[redacted:14]",
    ]);
  });
});

describe("sanitizeSessionDebugExportedSession", () => {
  it("redacts pending prompts, transcript content, raw metadata, and notifications", () => {
    const rawNotification: SessionRawNotificationEnvelope = {
      sessionId: "session-12345678",
      seq: 4,
      timestamp: "2026-04-16T18:11:00.000Z",
      notificationKind: "session/update",
      notification: {
        token: "secret",
        path: "/repo/secret.txt",
      },
    };
    const sanitized = sanitizeSessionDebugExportedSession({
      session: makeSession({
        pendingPrompts: [{
          contentParts: [{ type: "text", text: "abc" }],
          promptId: "prompt-1",
          promptProvenance: null,
          queuedAt: "2026-04-16T18:09:00.000Z",
          seq: 2,
          text: "prompt",
        }],
      }),
      normalizedEvents: [
        eventEnvelope(1, {
          type: "item_completed",
          item: {
            contentParts: [{ type: "tool_result_text", text: "result" }],
            kind: "assistant_message",
            rawInput: { token: "secret" },
            rawOutput: { path: "/repo/secret.txt" },
            sourceAgentKind: "codex",
            status: "completed",
          },
        } as SessionEventEnvelope["event"]),
        eventEnvelope(2, {
          type: "item_delta",
          delta: {
            appendContentParts: [{ type: "tool_input_text", text: "input" }],
            rawInput: { command: "secret" },
            rawOutput: { output: "secret" },
            replaceContentParts: [{ type: "text", text: "replace" }],
          },
        }),
        eventEnvelope(3, {
          type: "pending_prompt_added",
          contentParts: [{ type: "text", text: "queued" }],
          promptId: "prompt-1",
          promptProvenance: null,
          queuedAt: "2026-04-16T18:09:00.000Z",
          seq: 3,
          text: "queue",
        }),
      ],
      rawNotifications: [rawNotification],
      liveConfig: null,
      errors: [],
    });

    expect(sanitized.session?.pendingPrompts).toEqual([{
      contentParts: [{ type: "text", text: "[redacted:3]" }],
      promptId: "[redacted:8]",
      promptProvenance: null,
      queuedAt: "[redacted:24]",
      seq: 2,
      text: "[redacted:6]",
    }]);
    expect(sanitized.normalizedEvents?.[0].event).toEqual({
      type: "item_completed",
      item: {
        contentParts: [{ type: "tool_result_text", text: "[redacted:6]" }],
        kind: "[redacted:17]",
        rawInput: { redacted: true },
        rawOutput: { redacted: true },
        sourceAgentKind: "[redacted:5]",
        status: "[redacted:9]",
      },
    });
    expect(sanitized.normalizedEvents?.[1].event).toEqual({
      type: "item_delta",
      delta: {
        appendContentParts: [{ type: "tool_input_text", text: "[redacted:5]" }],
        rawInput: { redacted: true },
        rawOutput: { redacted: true },
        replaceContentParts: [{ type: "text", text: "[redacted:7]" }],
      },
    });
    expect(sanitized.normalizedEvents?.[2].event).toEqual({
      type: "pending_prompt_added",
      contentParts: [{ type: "text", text: "[redacted:6]" }],
      promptId: "[redacted:8]",
      promptProvenance: null,
      queuedAt: "[redacted:24]",
      seq: 3,
      text: "[redacted:5]",
    });
    expect(sanitized.rawNotifications).toEqual([{
      sessionId: "[redacted:16]",
      seq: 4,
      timestamp: "[redacted:24]",
      notificationKind: "[redacted:14]",
      notification: { redacted: true },
    }]);
  });
});

function eventEnvelope(
  seq: number,
  event: SessionEventEnvelope["event"],
): SessionEventEnvelope {
  return {
    sessionId: "session-12345678",
    seq,
    timestamp: `2026-04-16T18:10:0${seq}.000Z`,
    turnId: "turn-1",
    itemId: null,
    event,
  };
}
