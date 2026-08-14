import { describe, expect, it } from "vitest";
import type { ChatLaunchIntent } from "#product/lib/domain/chat/launch/launch-intent";
import {
  EMPTY_CHAT_LAUNCH_INTENT_REGISTRY,
  launchIntent,
  launchIntentForAttempt,
  launchIntents,
  patchLaunchIntent,
  removeLaunchIntent,
  resolveLaunchIntentForShell,
  upsertLaunchIntent,
} from "#product/lib/domain/chat/launch/launch-intent-registry";
import {
  buildPendingWorkspaceUiKey,
} from "#product/lib/domain/workspaces/creation/pending-entry";

function intent(overrides: Partial<ChatLaunchIntent> = {}): ChatLaunchIntent {
  return {
    id: "launch-1",
    promptId: "prompt-1",
    text: "Build the thing",
    contentParts: [{ type: "text", text: "Build the thing" }],
    targetKind: "worktree",
    retryInput: {
      text: "Build the thing",
      modelSelection: { kind: "codex", modelId: "gpt-5.4" },
      modeId: null,
      target: { kind: "cowork" },
    },
    materializedWorkspaceId: null,
    materializedSessionId: null,
    attemptId: null,
    targetWorkspaceId: null,
    createdAt: 100,
    sendAttemptedAt: null,
    failure: null,
    ...overrides,
  };
}

function registryOf(...intents: ChatLaunchIntent[]) {
  return intents.reduce(upsertLaunchIntent, EMPTY_CHAT_LAUNCH_INTENT_REGISTRY);
}

describe("launch intent registry", () => {
  it("holds two intents at once, in launch order", () => {
    const registry = registryOf(intent(), intent({ id: "launch-2", createdAt: 200 }));

    expect(registry.intentOrder).toEqual(["launch-1", "launch-2"]);
    expect(launchIntents(registry).map((entry) => entry.id))
      .toEqual(["launch-1", "launch-2"]);
  });

  it("returns the same registry when nothing changes", () => {
    const first = intent();
    const registry = registryOf(first);

    expect(upsertLaunchIntent(registry, first)).toBe(registry);
    expect(patchLaunchIntent(registry, "missing", { text: "x" })).toBe(registry);
    expect(removeLaunchIntent(registry, "missing")).toBe(registry);
    expect(launchIntents(EMPTY_CHAT_LAUNCH_INTENT_REGISTRY))
      .toBe(launchIntents(EMPTY_CHAT_LAUNCH_INTENT_REGISTRY));
  });

  it("keeps launch order when an existing intent is replaced", () => {
    const registry = upsertLaunchIntent(
      registryOf(intent(), intent({ id: "launch-2" })),
      intent({ id: "launch-1", text: "edited" }),
    );

    expect(registry.intentOrder).toEqual(["launch-1", "launch-2"]);
    expect(launchIntent(registry, "launch-1")?.text).toBe("edited");
  });

  it("patches and removes one intent without touching the other", () => {
    const registry = registryOf(intent(), intent({ id: "launch-2" }));

    const patched = patchLaunchIntent(registry, "launch-2", { text: "second" });
    expect(launchIntent(patched, "launch-1")).toEqual(intent());
    expect(launchIntent(patched, "launch-2")?.text).toBe("second");

    const removed = removeLaunchIntent(patched, "launch-1");
    expect(removed.intentOrder).toEqual(["launch-2"]);
    expect(launchIntent(removed, "launch-1")).toBeNull();
  });

  it("finds the intent that owns a pending attempt", () => {
    const registry = registryOf(
      intent({ attemptId: "attempt-1" }),
      intent({ id: "launch-2", attemptId: "attempt-2" }),
    );

    expect(launchIntentForAttempt(registry, "attempt-2")?.id).toBe("launch-2");
    expect(launchIntentForAttempt(registry, "attempt-3")).toBeNull();
    expect(launchIntentForAttempt(registry, null)).toBeNull();
  });
});

describe("resolveLaunchIntentForShell", () => {
  const scopedToAttempt1 = intent({ id: "launch-1", attemptId: "attempt-1" });
  const scopedToAttempt2 = intent({ id: "launch-2", attemptId: "attempt-2", createdAt: 200 });

  it("gives each shell its own intent when two launches are in flight", () => {
    const registry = registryOf(scopedToAttempt1, scopedToAttempt2);

    expect(resolveLaunchIntentForShell(registry, {
      shellLogicalWorkspaceId: buildPendingWorkspaceUiKey({ attemptId: "attempt-1" }),
      shellWorkspaceId: null,
    })?.id).toBe("launch-1");
    expect(resolveLaunchIntentForShell(registry, {
      shellLogicalWorkspaceId: buildPendingWorkspaceUiKey({ attemptId: "attempt-2" }),
      shellWorkspaceId: null,
    })?.id).toBe("launch-2");
  });

  it("matches an unscoped intent only on a shell with nothing selected", () => {
    const registry = registryOf(intent({ id: "launch-unscoped" }));

    expect(resolveLaunchIntentForShell(registry, {
      shellLogicalWorkspaceId: null,
      shellWorkspaceId: null,
    })?.id).toBe("launch-unscoped");
    expect(resolveLaunchIntentForShell(registry, {
      shellLogicalWorkspaceId: "logical-1",
      shellWorkspaceId: "workspace-1",
    })).toBeNull();
  });

  it("prefers the scoped intent over an unscoped one on the same shell", () => {
    // The unscoped intent is the newer of the two, so recency alone would pick
    // it; scope has to win, or a just-submitted launch would steal a shell that
    // already belongs to another attempt.
    const registry = registryOf(
      intent({ id: "launch-scoped", targetWorkspaceId: null, attemptId: "attempt-1" }),
      intent({ id: "launch-unscoped", createdAt: 900 }),
    );

    expect(resolveLaunchIntentForShell(registry, {
      shellLogicalWorkspaceId: buildPendingWorkspaceUiKey({ attemptId: "attempt-1" }),
      shellWorkspaceId: null,
    })?.id).toBe("launch-scoped");
  });

  it("gives the empty shell the most recent unscoped intent", () => {
    const registry = registryOf(
      intent({ id: "launch-old", createdAt: 100 }),
      intent({ id: "launch-new", createdAt: 300 }),
    );

    expect(resolveLaunchIntentForShell(registry, {
      shellLogicalWorkspaceId: null,
      shellWorkspaceId: null,
    })?.id).toBe("launch-new");
  });

  it("matches a materialized intent by workspace id", () => {
    const registry = registryOf(
      intent({ id: "launch-1", materializedWorkspaceId: "workspace-1" }),
      intent({ id: "launch-2", materializedWorkspaceId: "workspace-2" }),
    );

    expect(resolveLaunchIntentForShell(registry, {
      shellLogicalWorkspaceId: null,
      shellWorkspaceId: "workspace-2",
    })?.id).toBe("launch-2");
  });
});
