/* @vitest-environment jsdom */

import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useComposerDockCardPresence,
  useHeldInteractionPayload,
} from "./use-composer-dock-card-presence";

function PresenceHarness({
  entryKey,
  children = null,
}: {
  entryKey: string | null;
  children?: ReactNode;
}) {
  return <>{useComposerDockCardPresence(entryKey, children)}</>;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useComposerDockCardPresence", () => {
  it("wraps a mounted card in the entrance animation class", () => {
    render(
      <PresenceHarness entryKey="permission:r1">
        <div data-testid="card" />
      </PresenceHarness>,
    );

    expect(screen.getByTestId("card").parentElement?.className)
      .toContain("composer-dock-card-enter");
  });

  it("keeps the card rendered with the exit class for 150ms, then unmounts", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <PresenceHarness entryKey="permission:r1">
        <div data-testid="card" />
      </PresenceHarness>,
    );

    rerender(<PresenceHarness entryKey={null} />);

    const exiting = screen.getByTestId("card").parentElement;
    expect(exiting?.className).toContain("composer-dock-card-exit");
    expect(exiting?.className).toContain("pointer-events-none");

    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(screen.queryByTestId("card")).toBeNull();
  });

  it("swaps instantly (no exit hold) when one card replaces another", () => {
    const { rerender } = render(
      <PresenceHarness entryKey="permission:r1">
        <div data-testid="card-a" />
      </PresenceHarness>,
    );

    rerender(
      <PresenceHarness entryKey="user_input:r2">
        <div data-testid="card-b" />
      </PresenceHarness>,
    );

    expect(screen.queryByTestId("card-a")).toBeNull();
    expect(screen.getByTestId("card-b").parentElement?.className)
      .toContain("composer-dock-card-enter");
  });
});

function HeldHarness({ value }: { value: { title: string } | null }) {
  const held = useHeldInteractionPayload(value);
  return <div data-testid="held">{held?.title ?? "none"}</div>;
}

describe("useHeldInteractionPayload", () => {
  it("returns the live value while present and the held one after it clears", () => {
    const { rerender } = render(<HeldHarness value={{ title: "run ls" }} />);
    expect(screen.getByTestId("held").textContent).toBe("run ls");

    rerender(<HeldHarness value={null} />);
    expect(screen.getByTestId("held").textContent).toBe("run ls");

    rerender(<HeldHarness value={{ title: "run pwd" }} />);
    expect(screen.getByTestId("held").textContent).toBe("run pwd");
  });
});
