// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  PendingInteractionMarkerView,
  TurnShell,
  pendingInteractionMarkerKind,
  resolvePendingPromptTrailingStatus,
  resolveTurnTrailingStatus,
} from "./TranscriptTurnChrome";

afterEach(() => {
  cleanup();
});

describe("TurnShell", () => {
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

const STARTED_AT = "2026-04-13T12:00:01.000Z";

describe("resolveTurnTrailingStatus", () => {
  it("shows the agent-work shimmer while working", () => {
    const { container } = render(<>{resolveTurnTrailingStatus(STARTED_AT, "working", null)}</>);

    expect(container.querySelector("[data-trailing-status='working']")).not.toBeNull();
    expect(container.textContent).toContain("Thinking");
    // The three states share one crossfade container.
    expect(container.innerHTML).toContain("motion-safe:animate-status-crossfade");
  });

  it("renders a transient thought at text-ui-sm, not the old 8px text-xs", () => {
    const { container } = render(
      <>{resolveTurnTrailingStatus(STARTED_AT, "working", "Reading workspace flow")}</>,
    );

    expect(container.querySelector("[data-trailing-status='transient']")).not.toBeNull();
    expect(container.textContent).toContain("Reading workspace flow");
    expect(container.innerHTML).toContain("text-ui-sm");
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
  it("says 'Sending…' — not 'Thinking' — while a prompt is dispatching", () => {
    const { container } = render(
      <>{resolvePendingPromptTrailingStatus(STARTED_AT, "working", true)}</>,
    );

    expect(container.querySelector("[data-trailing-status='sending']")).not.toBeNull();
    expect(container.textContent).toContain("Sending…");
    expect(container.textContent).not.toContain("Thinking");
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
