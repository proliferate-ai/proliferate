// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { createTranscriptState } from "@anyharness/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getTurnDisplayBlockKey,
  ScopedTranscriptBlocks,
} from "#product/components/workspace/chat/transcript/ScopedTranscriptBlocks";
import type { TurnDisplayBlock } from "#product/domain/chats/transcript/transcript-presentation";

const lifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));

vi.mock("#product/components/workspace/chat/transcript/SubagentCreationGroupBlock", async () => {
  const { useEffect } = await vi.importActual<typeof import("react")>("react");
  return {
    SubagentCreationGroupBlock: ({ itemIds }: { itemIds: readonly string[] }) => {
    useEffect(() => {
      lifecycle.mounts += 1;
      return () => { lifecycle.unmounts += 1; };
    }, []);
    return <div data-testid="creation-run">{itemIds.join(",")}</div>;
    },
  };
});

afterEach(() => cleanup());

describe("ScopedTranscriptBlocks", () => {
  it("keeps a progressive subagent creation run mounted when later chips join", () => {
    lifecycle.mounts = 0;
    lifecycle.unmounts = 0;
    const transcript = createTranscriptState("session-1");
    const first: TurnDisplayBlock = {
      kind: "subagent_creations",
      blockId: "create-1",
      itemIds: ["create-1"],
    };
    const appended: TurnDisplayBlock = {
      kind: "subagent_creations",
      blockId: "create-1",
      itemIds: ["create-1", "create-2"],
    };
    const rendered = render(
      <ScopedTranscriptBlocks
        displayBlocks={[first]}
        transcript={transcript}
        renderItem={() => null}
      />,
    );

    expect(getTurnDisplayBlockKey(first)).toBe(getTurnDisplayBlockKey(appended));
    expect(lifecycle.mounts).toBe(1);

    rendered.rerender(
      <ScopedTranscriptBlocks
        displayBlocks={[appended]}
        transcript={transcript}
        renderItem={() => null}
      />,
    );

    expect(screen.getByTestId("creation-run").textContent).toBe("create-1,create-2");
    expect(lifecycle.mounts).toBe(1);
    expect(lifecycle.unmounts).toBe(0);
  });
});
