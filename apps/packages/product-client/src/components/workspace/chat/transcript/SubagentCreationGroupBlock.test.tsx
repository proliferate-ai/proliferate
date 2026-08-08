// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createTranscriptState, type ToolCallItem } from "@anyharness/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { toolItem } from "#product/domain/chats/transcript/transcript-presentation-test-fixtures";
import {
  SubagentCreationGroupBlock,
  spawnRunVerb,
  type SpawnChip,
} from "#product/components/workspace/chat/transcript/SubagentCreationGroupBlock";
import { buildDelegatedAgentIdentity } from "#product/lib/domain/delegated-work/identity";

function spawnItem(
  itemId: string,
  label: string,
  status: ToolCallItem["status"] = "completed",
  options: { background?: boolean } = {},
): ToolCallItem {
  const item = toolItem(itemId, "turn-1", 1, "subagent", status);
  item.nativeToolName = "mcp__subagents__spawn_subagent";
  item.rawInput = { label, ...(options.background ? { run_in_background: true } : {}) };
  item.rawOutput = {
    childSessionId: `child-${itemId}`,
    sessionLinkId: `link-${itemId}`,
    ...(options.background ? {} : { summary: "done" }),
  };
  if (options.background) {
    // A still-running background launch: only the orchestration receipt is back.
    item.contentParts = [
      { type: "tool_result_text", text: "Async agent launched" },
    ] as ToolCallItem["contentParts"];
  }
  return item;
}

function chip(overrides: Partial<SpawnChip>): SpawnChip {
  const identity = buildDelegatedAgentIdentity({
    id: "link-1",
    title: "Audit retry queue schema",
    sessionId: "child-1",
    sessionLinkId: "link-1",
  });
  return {
    key: "k",
    identity,
    childSessionId: "child-1",
    live: true,
    settled: true,
    failed: false,
    hoverTitle: identity.displayName,
    summary: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("SubagentCreationGroupBlock", () => {
  it("renders the spawn run as a chip run with one trailing verb", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      "create-1": spawnItem("create-1", "Audit retry queue schema", "completed", {
        background: true,
      }),
      "create-2": spawnItem("create-2", "Port webhook tests to vitest", "completed", {
        background: true,
      }),
    };

    const html = renderToStaticMarkup(
      createElement(SubagentCreationGroupBlock, {
        itemIds: ["create-1", "create-2"],
        transcript,
      }),
    );

    // Chip anatomy from the Spawn Receipts canvas, one chip per subagent.
    expect(html.match(/data-agent-chip/gu)).toHaveLength(2);
    expect(html).toContain("Audit retry queue schema");
    expect(html).toContain("Port webhook tests to vitest");
    // Exactly ONE trailing verb for the run.
    expect(html.match(/started working/gu)).toHaveLength(1);
    expect(html).not.toContain("subagents finished");
    // Each chip pops in as its subagent comes up.
    expect(html).toContain("chip-enter");
  });

  it("keeps the chips and only changes the verb once the run settles", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      "create-1": spawnItem("create-1", "Audit retry queue schema"),
    };

    const html = renderToStaticMarkup(
      createElement(SubagentCreationGroupBlock, {
        itemIds: ["create-1"],
        transcript,
      }),
    );

    expect(html).toContain("Audit retry queue schema");
    expect(html).toContain("finished");
    expect(html).not.toContain("started working");
  });

  it("renders no chip for a subagent that has not come up yet", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      "create-1": spawnItem("create-1", "Audit retry queue schema", "in_progress"),
    };

    const html = renderToStaticMarkup(
      createElement(SubagentCreationGroupBlock, {
        itemIds: ["create-1"],
        transcript,
      }),
    );

    // No pre-state: nothing is drawn until the subagent is up.
    expect(html).toBe("");
  });

  it("gives the completion summary a home in the hover card, not the transcript flow", () => {
    const transcript = createTranscriptState("session-1");
    const item = spawnItem("create-1", "Audit retry queue schema");
    item.rawOutput = {
      ...(item.rawOutput as Record<string, unknown>),
      summary: "Retry ceiling was 3; raised to 8 and added a jitter test.",
    };
    transcript.itemsById = { "create-1": item };

    const { container } = render(
      createElement(SubagentCreationGroupBlock, {
        itemIds: ["create-1"],
        transcript,
      }),
    );

    // ADR §4: the summary never becomes its own transcript UI.
    expect(container.querySelector("[data-subagent-spawn-run]")?.textContent)
      .not.toContain("Retry ceiling was 3");

    const anchor = container.querySelector("[data-agent-chip]")?.parentElement;
    expect(anchor).toBeTruthy();
    fireEvent.mouseEnter(anchor as Element);

    // ...but it is not thrown away either: hovering the chip reads it.
    expect(document.querySelector("[data-agent-message-body]")?.textContent)
      .toBe("Retry ceiling was 3; raised to 8 and added a jitter test.");
  });
});

describe("spawnRunVerb", () => {
  it("stays silent until every chip in the run is up", () => {
    expect(spawnRunVerb([chip({}), chip({ live: false })])).toBeNull();
  });

  it("reads 'started working' while any spawned agent is still working", () => {
    expect(spawnRunVerb([chip({ settled: false }), chip({})])).toBe("started working");
  });

  it("reads 'finished' once every spawned agent has settled", () => {
    expect(spawnRunVerb([chip({}), chip({})])).toBe("finished");
  });

  it("ignores failed spawns for the verb, and says so when nothing started", () => {
    expect(spawnRunVerb([chip({ failed: true, settled: false }), chip({ settled: false })]))
      .toBe("started working");
    expect(spawnRunVerb([chip({ failed: true })])).toBe("didn't start");
  });
});
