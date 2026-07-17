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
      futureNumber: 73,
      futureBoolean: false,
      [privateContent]: true,
    } as unknown as ContentPart;

    const sanitized = sanitizeSessionDebugContentParts([...parts, futurePart]);
    const sanitizedFuturePart = sanitized[sanitized.length - 1] as unknown as Record<
      string,
      unknown
    >;
    const redactedFutureEntries = Object.entries(sanitizedFuturePart).filter(([key]) => (
      key.startsWith("[redacted-key:")
    ));
    const sanitizedFuturePrimitives = sanitizeSessionDebugContentParts([{
      type: "text",
      futureNumber: 73,
      futureBoolean: false,
      size: 91,
      required: true,
    } as unknown as ContentPart])[0] as unknown as Record<string, unknown>;

    expect(JSON.stringify(sanitized)).not.toContain(privateContent);
    expect(redactedFutureEntries.length).toBeGreaterThanOrEqual(5);
    for (const [, value] of redactedFutureEntries) {
      expect(value).toEqual({ redacted: true });
    }
    expect(sanitizedFuturePrimitives).toEqual({
      type: "text",
      "[redacted-key:12:0]": { redacted: true },
      "[redacted-key:13:1]": { redacted: true },
      size: { redacted: true },
      required: { redacted: true },
    });
    expect(sanitized.map((part) => part.type)).toEqual([
      ...parts.map((part) => part.type),
      "[redacted:14]",
    ]);
  });

  it("terminates cycles through audited fields with a fixed marker", () => {
    const cyclic = {
      type: "text",
      text: "cycle private sentinel",
      event: null,
    } as unknown as ContentPart & { event: unknown };
    cyclic.event = cyclic;

    const sanitized = sanitizeSessionDebugContentParts([cyclic]);
    const sanitizedCycle = sanitized[0] as unknown as { event: unknown };

    expect(sanitizedCycle.event).toEqual({ redacted: true });
    expect(() => JSON.stringify(sanitized)).not.toThrow();
    expect(JSON.stringify(sanitized)).not.toContain("cycle private sentinel");
  });

  it("sanitizes a shared object independently at each non-cyclic path", () => {
    const shared = {
      type: "text",
      text: "shared private sentinel",
    };
    const part = {
      type: "text",
      text: "root private sentinel",
      event: shared,
      details: shared,
    } as unknown as ContentPart;

    const sanitized = sanitizeSessionDebugContentParts([part]);
    const sanitizedPart = sanitized[0] as unknown as {
      details: unknown;
      event: unknown;
    };

    expect(sanitized[0]).toEqual({
      type: "text",
      text: "[redacted:21]",
      event: {
        type: "text",
        text: "[redacted:23]",
      },
      details: {
        type: "text",
        text: "[redacted:23]",
      },
    });
    expect(sanitizedPart.event).not.toBe(sanitizedPart.details);
    expect(JSON.stringify(sanitized)).not.toContain("private sentinel");
  });

  it("fails closed when a content array proxy is revoked", () => {
    const revoked = Proxy.revocable(
      [{ type: "text", text: "revoked private sentinel" }] as ContentPart[],
      {},
    );
    revoked.revoke();

    expect(() => sanitizeSessionDebugContentParts(revoked.proxy)).not.toThrow();
    expect(sanitizeSessionDebugContentParts(revoked.proxy)).toEqual({ redacted: true });
  });

  it("caps recursive depth through audited fields", () => {
    const root: Record<string, unknown> = { type: "text", text: "depth private sentinel" };
    let cursor = root;
    for (let index = 0; index < 64; index += 1) {
      const child: Record<string, unknown> = {
        type: "text",
        text: "depth private sentinel",
      };
      cursor.event = child;
      cursor = child;
    }

    const sanitized = sanitizeSessionDebugContentParts([root as unknown as ContentPart]);
    let sanitizedCursor = sanitized[0] as unknown as Record<string, unknown>;
    let followedEdges = 0;
    while (
      sanitizedCursor.event
      && !isRedactedMarker(sanitizedCursor.event)
      && followedEdges < 64
    ) {
      sanitizedCursor = sanitizedCursor.event as Record<string, unknown>;
      followedEdges += 1;
    }

    expect(sanitizedCursor.event).toEqual({ redacted: true });
    expect(followedEdges).toBeLessThan(64);
    expect(JSON.stringify(sanitized)).not.toContain("depth private sentinel");
  });

  it("bounds object width without reading unknown values", () => {
    let unknownGetterReads = 0;
    const wide: Record<string, unknown> = { type: "text", text: "width private sentinel" };
    Object.defineProperty(wide, "futureGetter", {
      enumerable: true,
      get: () => {
        unknownGetterReads += 1;
        return "getter private sentinel";
      },
    });
    for (let index = 0; index < 1_000; index += 1) {
      wide[`futureField${index}`] = index;
    }

    const sanitized = sanitizeSessionDebugContentParts([wide as unknown as ContentPart]);
    const sanitizedWide = sanitized[0] as unknown as Record<string, unknown>;

    expect(Object.keys(sanitizedWide).length).toBeLessThanOrEqual(256);
    expect(unknownGetterReads).toBe(0);
    expect(JSON.stringify(sanitized)).not.toContain("getter private sentinel");
    for (const [key, value] of Object.entries(sanitizedWide)) {
      if (key.startsWith("[redacted-key:")) {
        expect(value).toEqual({ redacted: true });
      }
    }
  });

  it("redacts opaque fields without invoking their getters", () => {
    let opaqueGetterReads = 0;
    const part: Record<string, unknown> = { type: "text" };
    Object.defineProperty(part, "rawInput", {
      enumerable: true,
      get: () => {
        opaqueGetterReads += 1;
        part.seq = 999;
        return "opaque private sentinel";
      },
    });
    part.seq = 7;

    const sanitized = sanitizeSessionDebugContentParts([part as unknown as ContentPart]);

    expect(opaqueGetterReads).toBe(0);
    expect(sanitized[0]).toEqual({
      type: "text",
      rawInput: { redacted: true },
      seq: { redacted: true },
    });
    expect(JSON.stringify(sanitized)).not.toContain("opaque private sentinel");
  });

  it("bounds array width and the total sanitized value budget", () => {
    const wideParts = Array.from({ length: 1_000 }, (_, index) => ({
      type: "text" as const,
      text: `array private sentinel ${index}`,
    }));
    const budgetParts = Array.from({ length: 256 }, (_, partIndex) => {
      const part: Record<string, unknown> = {
        type: "text",
        text: `budget private sentinel ${partIndex}`,
      };
      for (let fieldIndex = 0; fieldIndex < 255; fieldIndex += 1) {
        part[`futureField${fieldIndex}`] = fieldIndex;
      }
      return part as unknown as ContentPart;
    });

    const widthSanitized = sanitizeSessionDebugContentParts(wideParts);
    const budgetSanitized = sanitizeSessionDebugContentParts(budgetParts);

    expect(widthSanitized).toHaveLength(256);
    expect(budgetSanitized.length).toBeLessThan(256);
    expect(JSON.stringify(widthSanitized)).not.toContain("array private sentinel");
    expect(JSON.stringify(budgetSanitized)).not.toContain("budget private sentinel");
  });
});

describe("sanitizeSessionDebugExportedSession", () => {
  it("fails closed when a nested session array proxy is revoked", () => {
    const revoked = Proxy.revocable(
      [{ seq: 1, event: { type: "error", message: "revoked private sentinel" } }],
      {},
    );
    revoked.revoke();

    const sanitized = sanitizeSessionDebugExportedSession({
      session: makeSession(),
      normalizedEvents: revoked.proxy as unknown as SessionEventEnvelope[],
      rawNotifications: [],
      liveConfig: null,
      errors: [],
    });

    expect(sanitized.normalizedEvents).toEqual({ redacted: true });
    expect(JSON.stringify(sanitized)).not.toContain("revoked private sentinel");
  });

  it("preserves audited numeric and boolean protocol metadata", () => {
    const sanitized = sanitizeSessionDebugExportedSession({
      session: makeSession({
        actionCapabilities: {
          fork: true,
          loopsNative: true,
          supportsGoals: true,
          supportsLoops: false,
          targetedFork: false,
        },
        executionSummary: {
          hasLiveHandle: true,
          phase: "running",
          updatedAt: "2026-04-16T18:20:00.000Z",
        },
      }),
      normalizedEvents: [],
      rawNotifications: [],
      liveConfig: {
        liveConfig: {
          normalizedControls: {
            extras: [],
            model: {
              currentValue: "gpt-5.4",
              key: "model",
              label: "Model",
              rawConfigId: "model",
              settable: true,
              values: [],
            },
          },
          promptCapabilities: {
            audio: false,
            embeddedContext: true,
            image: true,
          },
          rawConfigOptions: [],
          sourceSeq: 42,
          updatedAt: "2026-04-16T18:20:00.000Z",
        },
      },
      errors: [],
    });

    expect(sanitized.session?.actionCapabilities).toEqual({
      fork: true,
      loopsNative: true,
      supportsGoals: true,
      supportsLoops: false,
      targetedFork: false,
    });
    expect(sanitized.session?.executionSummary?.hasLiveHandle).toBe(true);
    expect(sanitized.liveConfig?.liveConfig?.normalizedControls.model?.settable).toBe(true);
    expect(sanitized.liveConfig?.liveConfig?.promptCapabilities).toEqual({
      audio: false,
      embeddedContext: true,
      image: true,
    });
    expect(sanitized.liveConfig?.liveConfig?.sourceSeq).toBe(42);
  });

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

function isRedactedMarker(value: unknown): value is { redacted: true } {
  return typeof value === "object"
    && value !== null
    && (value as { redacted?: unknown }).redacted === true;
}
