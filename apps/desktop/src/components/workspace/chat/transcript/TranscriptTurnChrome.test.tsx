// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  PendingInteractionMarkerView,
  TURN_ITEM_GAP_CLASS,
  TurnAssistantActionRow,
  TurnGoalMetMarker,
  TurnLiveTailSlot,
  TurnShell,
  pendingInteractionMarkerKind,
  resolvePendingPromptTrailingStatus,
  resolveTurnTrailingStatus,
} from "./TranscriptTurnChrome";

afterEach(() => {
  cleanup();
});

describe("TurnShell", () => {
  it("shares Codex's 16px item gap across pending and materialized turns", () => {
    expect(TURN_ITEM_GAP_CLASS).toBe("gap-4");
  });

  it("uses one vertical rhythm for every row", () => {
    const { container } = render(
      <TurnShell>
        <div>row</div>
      </TurnShell>,
    );

    expect(container.innerHTML).toContain("pt-2");
    expect(container.innerHTML).toContain("pb-2");
  });

  it("drops top padding on the first row only", () => {
    const { container } = render(
      <TurnShell isFirst>
        <div>row</div>
      </TurnShell>,
    );

    expect(container.innerHTML).toContain("pt-0");
    expect(container.innerHTML).toContain("pb-2");
  });
});

describe("TurnAssistantActionRow", () => {
  it("hover-gates the copy button by default (earlier messages)", () => {
    const { container } = render(
      <TurnAssistantActionRow content="reply" showCopyButton timestampLabel="5:02pm" />,
    );
    expect(container.innerHTML).toContain("opacity-0 group-hover/turn:opacity-100");
  });

  it("keeps the copy button persistently visible when alwaysVisible (final message)", () => {
    const { container } = render(
      <TurnAssistantActionRow content="reply" showCopyButton alwaysVisible timestampLabel="5:02pm" />,
    );
    expect(container.innerHTML).toContain("opacity-100");
    expect(container.innerHTML).not.toContain("opacity-0 group-hover/turn");
  });

  it("renders the goal-met marker between the copy button and the timestamp", () => {
    const { container } = render(
      <TurnAssistantActionRow
        content="reply"
        showCopyButton
        alwaysVisible
        timestampLabel="5:02pm"
        metMarker={<TurnGoalMetMarker label="Goal achieved in 40s" />}
      />,
    );
    expect(container.textContent).toContain("Goal achieved in 40s");
    expect(container.textContent).toContain("5:02pm");
  });

  it("reserves identical height for live status and completed copy actions", () => {
    const live = render(<TurnLiveTailSlot>Thinking</TurnLiveTailSlot>);
    const liveSlot = live.container.querySelector("[data-turn-tail-slot]");
    expect(liveSlot?.className).toContain("h-6");
    live.unmount();

    const completed = render(
      <TurnAssistantActionRow content="reply" showCopyButton timestampLabel="5:02pm" />,
    );
    expect(completed.container.querySelector(".h-6")).not.toBeNull();
  });
});

describe("TurnGoalMetMarker", () => {
  it("renders the achieved label with a neutral check glyph", () => {
    const { container } = render(<TurnGoalMetMarker label="Goal achieved in 40s" />);
    expect(container.textContent).toContain("Goal achieved in 40s");
    // Neutral, not green: the check glyph uses muted-foreground.
    expect(container.querySelector("svg.text-muted-foreground")).not.toBeNull();
    expect(container.querySelector(".text-success")).toBeNull();
  });
});

const STARTED_AT = "2026-04-13T12:00:01.000Z";

describe("resolveTurnTrailingStatus", () => {
  it("shows the agent-work shimmer while working", () => {
    const { container } = render(<>{resolveTurnTrailingStatus(STARTED_AT, "working", null)}</>);

    expect(container.querySelector("[data-trailing-status='working']")).not.toBeNull();
    expect(container.textContent).toContain("Thinking");
    expect(container.innerHTML).toContain("--thinking-text-delay");
    expect(container.innerHTML).not.toContain("motion-safe:animate-status-crossfade");
  });

  it("renders a transient thought at text-chat, not the old 8px text-xs", () => {
    const { container } = render(
      <>{resolveTurnTrailingStatus(STARTED_AT, "working", "Reading workspace flow")}</>,
    );

    expect(container.querySelector("[data-trailing-status='transient']")).not.toBeNull();
    expect(container.textContent).toContain("Reading workspace flow");
    expect(container.innerHTML).toContain("text-[length:var(--text-chat)]");
    expect(container.innerHTML).toContain("size-[1.143em]");
    expect(container.innerHTML).not.toContain("text-xs");
  });

  it("renders the awaiting-response marker while waiting on input", () => {
    const { container } = render(<>{resolveTurnTrailingStatus(STARTED_AT, "needs_input", null)}</>);

    expect(container.querySelector("[data-trailing-status='needs-input']")).not.toBeNull();
    expect(container.textContent).toContain("Awaiting response");
    // No more generic 8px "Waiting for your input" copy.
    expect(container.textContent).not.toContain("Waiting for your input");
    expect(container.innerHTML).not.toContain("text-xs");
  });
});

describe("resolvePendingPromptTrailingStatus", () => {
  it("says 'Thinking' while a prompt is dispatching (same voice as agent work)", () => {
    const { container } = render(
      <>{resolvePendingPromptTrailingStatus(STARTED_AT, "working", true)}</>,
    );

    expect(container.querySelector("[data-trailing-status='sending']")).not.toBeNull();
    expect(container.textContent).toContain("Thinking");
    expect(container.innerHTML).not.toContain("motion-safe:animate-status-crossfade");
  });

  it("shows the awaiting-response marker when the outbox is waiting on input", () => {
    const { container } = render(
      <>{resolvePendingPromptTrailingStatus(STARTED_AT, "needs_input", false)}</>,
    );

    expect(container.textContent).toContain("Awaiting response");
  });
});

describe("pendingInteractionMarkerKind", () => {
  it("maps interaction kinds to permission or question", () => {
    expect(pendingInteractionMarkerKind("permission")).toBe("permission");
    expect(pendingInteractionMarkerKind("user_input")).toBe("question");
    expect(pendingInteractionMarkerKind("mcp_elicitation")).toBe("question");
    expect(pendingInteractionMarkerKind(undefined)).toBeNull();
  });
});

describe("PendingInteractionMarkerView", () => {
  it("labels a permission request", () => {
    const { container } = render(<PendingInteractionMarkerView kind="permission" />);

    expect(container.textContent).toContain("Permission");
    expect(container.textContent).toContain("Awaiting response");
  });

  it("labels a question request", () => {
    const { container } = render(<PendingInteractionMarkerView kind="question" />);

    expect(container.textContent).toContain("Question");
    expect(container.textContent).toContain("Awaiting response");
  });

  it("falls back to a generic caption when the kind is unknown", () => {
    const { container } = render(<PendingInteractionMarkerView kind={null} />);

    expect(container.textContent).not.toContain("Permission");
    expect(container.textContent).not.toContain("Question");
    expect(container.textContent).toContain("Awaiting response");
  });
});
