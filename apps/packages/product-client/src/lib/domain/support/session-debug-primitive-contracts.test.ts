import { describe, expect, it } from "vitest";
import type { ContentPart } from "@anyharness/sdk";
import type { SessionDebugExportedSession } from "#product/lib/domain/support/session-debug/export-models";
import {
  sanitizeSessionDebugContentParts,
  sanitizeSessionDebugExportedSession,
} from "#product/lib/domain/support/session-debug/sanitizer";

const marker = { redacted: true };

describe("session debug primitive contracts", () => {
  it("preserves current content metadata only on its owning variant", () => {
    const sanitized = sanitizeSessionDebugContentParts([
      { type: "image", size: 1 },
      {
        type: "resource",
        previewOriginalBytes: 2,
        previewTruncated: true,
        size: 3,
      },
      { type: "resource_link", size: 4 },
      {
        type: "terminal_output",
        dataOriginalBytes: 5,
        dataTruncated: false,
        exitCode: 6,
      },
      {
        type: "file_read",
        endLine: 7,
        line: 8,
        previewOriginalBytes: 9,
        previewTruncated: true,
        startLine: 10,
      },
      {
        type: "file_change",
        additions: 11,
        deletions: 12,
        patchOriginalBytes: 13,
        patchTruncated: false,
        previewOriginalBytes: 14,
        previewTruncated: true,
      },
      { type: "proposed_plan_decision", decisionVersion: 15 },
      { type: "tool_input_text", textOriginalBytes: 16, textTruncated: true },
      { type: "tool_result_text", textOriginalBytes: 17, textTruncated: false },
      {
        type: "text",
        isTransient: true,
        native: true,
        required: true,
        seq: 18,
        size: 19,
        sourceSeq: 20,
      },
    ] as unknown as ContentPart[]);

    expect(sanitized).toMatchObject([
      { type: "image", size: 1 },
      {
        type: "resource",
        previewOriginalBytes: 2,
        previewTruncated: true,
        size: 3,
      },
      { type: "resource_link", size: 4 },
      {
        type: "terminal_output",
        dataOriginalBytes: 5,
        dataTruncated: false,
        exitCode: 6,
      },
      {
        type: "file_read",
        endLine: 7,
        line: 8,
        previewOriginalBytes: 9,
        previewTruncated: true,
        startLine: 10,
      },
      {
        type: "file_change",
        additions: 11,
        deletions: 12,
        patchOriginalBytes: 13,
        patchTruncated: false,
        previewOriginalBytes: 14,
        previewTruncated: true,
      },
      { type: "proposed_plan_decision", decisionVersion: 15 },
      { type: "tool_input_text", textOriginalBytes: 16, textTruncated: true },
      { type: "tool_result_text", textOriginalBytes: 17, textTruncated: false },
      {
        type: "text",
        isTransient: marker,
        native: marker,
        required: marker,
        seq: marker,
        size: marker,
        sourceSeq: marker,
      },
    ]);
  });

  it("preserves current session, event, interaction, and live-config metadata", () => {
    const sanitized = sanitizeSessionDebugExportedSession({
      session: {
        actionCapabilities: {
          fork: true,
          loopsNative: false,
          supportsGoals: true,
          supportsLoops: false,
          targetedFork: true,
        },
        activeGoal: goal(1),
        activity: {
          agents: [{ background: true, usage: usage(10) }],
          goal: goal(20),
          loops: [loop(30)],
          processes: [
            { pid: 40, status: { status: "exited", exitCode: 41 } },
            { pid: 42, status: { status: "running", exitCode: 43 } },
          ],
        },
        executionSummary: {
          hasLiveHandle: true,
          pendingInteractions: [
            {
              payload: {
                type: "user_input",
                questions: [{ isOther: true, isSecret: false }],
              },
            },
            {
              payload: {
                type: "mcp_elicitation",
                mode: { mode: "url", requiresReveal: true },
              },
            },
            {
              payload: {
                type: "mcp_elicitation",
                mode: {
                  mode: "form",
                  fields: [
                    {
                      fieldType: "text",
                      integer: true,
                      maxLength: 50,
                      minLength: 2,
                      required: true,
                    },
                    { fieldType: "number", integer: true, maxLength: 51, required: false },
                    {
                      fieldType: "multi_select",
                      maxItems: 4,
                      minItems: 1,
                      required: true,
                    },
                  ],
                },
              },
            },
          ],
        },
        liveConfig: liveConfig(60),
        pendingPrompts: [{ seq: 70, contentParts: [{ type: "image", size: 71 }] }],
      },
      normalizedEvents: [
        envelope(80, { type: "usage_update", size: 81, used: 82, required: true }),
        envelope(83, {
          type: "review_run_updated",
          autoIterate: true,
          currentRoundNumber: 84,
          maxRounds: 85,
          size: 86,
        }),
        envelope(87, {
          type: "error",
          details: { kind: "provider_rate_limit", limit: 88 },
        }),
        envelope(89, {
          type: "error",
          details: { kind: "network_connection", limit: 90 },
        }),
        envelope(91, {
          type: "item_delta",
          delta: { isTransient: true },
        }),
        envelope(92, {
          type: "loop_fired",
          firedAtMs: 93,
          loop: loop(94),
        }),
      ],
      rawNotifications: [{ seq: 100, notification: { private: true } }],
      liveConfig: { liveConfig: liveConfig(110) },
      errors: [],
    } as unknown as SessionDebugExportedSession);

    expect(sanitized).toMatchObject({
      session: {
        actionCapabilities: {
          fork: true,
          loopsNative: false,
          supportsGoals: true,
          supportsLoops: false,
          targetedFork: true,
        },
        activeGoal: goal(1),
        activity: {
          agents: [{ background: true, usage: usage(10) }],
          goal: goal(20),
          loops: [loop(30)],
          processes: [
            { pid: 40, status: { exitCode: 41 } },
            { pid: 42, status: { exitCode: marker } },
          ],
        },
        executionSummary: {
          hasLiveHandle: true,
          pendingInteractions: [
            { payload: { questions: [{ isOther: true, isSecret: false }] } },
            { payload: { mode: { requiresReveal: true } } },
            {
              payload: {
                mode: {
                  fields: [
                    { integer: marker, maxLength: 50, minLength: 2, required: true },
                    { integer: true, maxLength: marker, required: false },
                    { maxItems: 4, minItems: 1, required: true },
                  ],
                },
              },
            },
          ],
        },
        liveConfig: liveConfig(60),
        pendingPrompts: [{ seq: 70, contentParts: [{ size: 71 }] }],
      },
      normalizedEvents: [
        { seq: 80, event: { size: 81, used: 82, required: marker } },
        {
          seq: 83,
          event: { autoIterate: true, currentRoundNumber: 84, maxRounds: 85, size: marker },
        },
        { seq: 87, event: { details: { limit: 88 } } },
        { seq: 89, event: { details: { limit: marker } } },
        { seq: 91, event: { delta: { isTransient: true } } },
        { seq: 92, event: { firedAtMs: 93, loop: loop(94) } },
      ],
      rawNotifications: [{ seq: 100, notification: marker }],
      liveConfig: { liveConfig: liveConfig(110) },
    });
  });

  it("keeps unknown roles, discriminators, arrays, and non-finite values fail closed", () => {
    let arrayGetterReads = 0;
    let arrayLengthGetterReads = 0;
    let typeGetterReads = 0;
    const accessorPart: Record<string, unknown> = { size: 1 };
    Object.defineProperty(accessorPart, "type", {
      enumerable: true,
      get: () => {
        typeGetterReads += 1;
        return "image";
      },
    });
    const inheritedPart = Object.assign(Object.create({ type: "image" }), { size: 2 });
    const hiddenTypePart: Record<string, unknown> = { size: 3 };
    Object.defineProperty(hiddenTypePart, "type", {
      enumerable: false,
      value: "image",
    });
    const arrayWithGetter: ContentPart[] = [];
    Object.defineProperty(arrayWithGetter, "0", {
      configurable: true,
      enumerable: true,
      get: () => {
        arrayGetterReads += 1;
        return { type: "image", size: 3 };
      },
    });
    arrayWithGetter.length = 1;
    const proxiedArray = new Proxy([{ type: "image", size: 7 }] as ContentPart[], {
      get: (target, property, receiver) => {
        if (property === "length") {
          arrayLengthGetterReads += 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });

    const sanitized = sanitizeSessionDebugContentParts([
      {
        type: "text",
        event: { type: "usage_update", size: 4, used: 5 },
      },
      { type: "future", size: 6 },
      accessorPart,
      inheritedPart,
      hiddenTypePart,
      { type: "image", size: Number.POSITIVE_INFINITY },
    ] as unknown as ContentPart[]);
    const sanitizedArrayGetter = sanitizeSessionDebugContentParts(arrayWithGetter);
    const sanitizedProxiedArray = sanitizeSessionDebugContentParts(proxiedArray);

    expect(sanitized).toMatchObject([
      { event: { size: marker, used: marker } },
      { size: marker },
      { size: marker },
      { size: marker },
      { size: marker },
      { size: marker },
    ]);
    expect(sanitizedArrayGetter).toEqual([marker]);
    expect(sanitizedProxiedArray).toMatchObject([{ size: 7 }]);
    expect(typeGetterReads).toBe(0);
    expect(arrayGetterReads).toBe(0);
    expect(arrayLengthGetterReads).toBe(0);
  });
});

function goal(seed: number) {
  return {
    native: seed % 2 === 0,
    iterations: seed,
    revision: seed + 1,
    timeUsedSeconds: seed + 2,
    tokenBudget: seed + 3,
    tokensUsed: seed + 4,
  };
}

function usage(seed: number) {
  return {
    durationSeconds: seed,
    tokensUsed: seed + 1,
    toolCalls: seed + 2,
  };
}

function loop(seed: number) {
  return {
    fireCount: seed,
    lastFiredAtMs: seed + 1,
    native: true,
    recurring: false,
    updatedAtMs: seed + 2,
  };
}

function liveConfig(seed: number) {
  return {
    normalizedControls: {
      extras: [{ settable: false }],
      model: { settable: true },
    },
    promptCapabilities: {
      audio: false,
      embeddedContext: true,
      image: true,
    },
    sourceSeq: seed,
  };
}

function envelope(seq: number, event: Record<string, unknown>) {
  return { seq, event };
}
