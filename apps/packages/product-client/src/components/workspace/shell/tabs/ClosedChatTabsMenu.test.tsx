// @vitest-environment jsdom

import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { motion } from "@proliferate/design/motion";
import { ClosedChatTabsMenu } from "#product/components/workspace/shell/tabs/ClosedChatTabsMenu";
import type {
  HeaderChatMenuEntry,
} from "#product/lib/domain/workspaces/tabs/workspace-header-tabs-view-model-types";

function menuRow(id: string): HeaderChatMenuEntry {
  return {
    id,
    title: `Session ${id}`,
    agentKind: "claude",
    viewState: "idle" as HeaderChatMenuEntry["viewState"],
    isResolvingSession: false,
    hasUnreadActivity: false,
    isActive: false,
    isVisible: false,
    closedAt: null,
  };
}

function renderMenu(
  rows: HeaderChatMenuEntry[],
  onDeleteSession: (sessionId: string) => Promise<boolean>,
) {
  return (
    <ClosedChatTabsMenu
      rows={rows}
      renderIcon={() => null}
      onRestoreSession={() => {}}
      onDeleteSession={onDeleteSession}
    />
  );
}

function rowDisclosure(container: HTMLElement, title: string): HTMLElement | null {
  const label = [...container.querySelectorAll<HTMLElement>("button")]
    .find((button) => button.textContent?.includes(title));
  return label?.closest("[data-animated-collapsible-content]") ?? null;
}

describe("ClosedChatTabsMenu", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("collapses only the deleted middle row while neighbors stay expanded", () => {
    const onDeleteSession = vi.fn(() => new Promise<boolean>(() => {}));
    const { container } = render(
      renderMenu([menuRow("a"), menuRow("b"), menuRow("c")], onDeleteSession),
    );

    fireEvent.click(container.querySelector<HTMLElement>('[aria-label="Delete Session b"]')!);

    // The row collapses immediately; the archive itself waits out the
    // transition so the animation is not starved by the header re-derivation.
    expect(rowDisclosure(container, "Session b")?.getAttribute("data-expanded")).toBe("false");
    expect(rowDisclosure(container, "Session a")?.getAttribute("data-expanded")).toBe("true");
    expect(rowDisclosure(container, "Session c")?.getAttribute("data-expanded")).toBe("true");
    expect(onDeleteSession).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(motion.duration.disclosureMs);
    });
    expect(onDeleteSession).toHaveBeenCalledWith("b");
  });

  it("keeps a ghost of the deleted row in place until the collapse finishes", async () => {
    const onDeleteSession = vi.fn(() => Promise.resolve(true));
    const rows = [menuRow("a"), menuRow("b"), menuRow("c")];
    const { container, rerender } = render(renderMenu(rows, onDeleteSession));

    fireEvent.click(container.querySelector<HTMLElement>('[aria-label="Delete Session b"]')!);
    await act(async () => {
      vi.advanceTimersByTime(motion.duration.disclosureMs);
    });

    // The archive completed and the parent dropped the row; the ghost keeps
    // rendering in its original slot, collapsed, until the transition ends.
    rerender(renderMenu([menuRow("a"), menuRow("c")], onDeleteSession));
    const ghost = rowDisclosure(container, "Session b");
    expect(ghost).not.toBeNull();
    expect(ghost?.getAttribute("data-expanded")).toBe("false");
    const order = [...container.querySelectorAll("[data-animated-collapsible-content]")]
      .map((el) => el.textContent?.match(/Session [abc]/)?.[0]);
    expect(order).toEqual(["Session a", "Session b", "Session c"]);

    act(() => {
      vi.runAllTimers();
    });
    expect(rowDisclosure(container, "Session b")).toBeNull();
    expect(rowDisclosure(container, "Session a")?.getAttribute("data-expanded")).toBe("true");
    expect(rowDisclosure(container, "Session c")?.getAttribute("data-expanded")).toBe("true");
  });

  it("restores the row when the archive fails", async () => {
    const onDeleteSession = vi.fn(() => Promise.resolve(false));
    const { container } = render(
      renderMenu([menuRow("a"), menuRow("b")], onDeleteSession),
    );

    fireEvent.click(container.querySelector<HTMLElement>('[aria-label="Delete Session a"]')!);
    expect(rowDisclosure(container, "Session a")?.getAttribute("data-expanded")).toBe("false");

    await act(async () => {
      vi.advanceTimersByTime(motion.duration.disclosureMs);
    });
    expect(rowDisclosure(container, "Session a")?.getAttribute("data-expanded")).toBe("true");
  });
});
