// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthRestartModal } from "#product/components/agents/AuthRestartModal";

function renderModal(overrides?: Partial<Parameters<typeof AuthRestartModal>[0]>) {
  const onRestartNow = vi.fn();
  const onDecline = vi.fn();
  render(
    <AuthRestartModal
      open
      harnessKind="claude"
      surface="local"
      sessions={[
        { sessionId: "s1", label: "Fix the build" },
        { sessionId: "s2", label: "Refactor auth" },
      ]}
      onRestartNow={onRestartNow}
      onDecline={onDecline}
      {...overrides}
    />,
  );
  return { onRestartNow, onDecline };
}

describe("AuthRestartModal", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the founder-settled copy exactly: title and both actions", () => {
    renderModal();
    // Exact copy is a settled ruling (agent-auth.md restart offer): the
    // title and the two action labels must not drift.
    expect(screen.getByText("Restart running sessions on old auth?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "yes, restart now" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "no" })).toBeTruthy();
  });

  it("lists exactly the offered sessions (Proof C6)", () => {
    renderModal();
    const list = document.querySelector('[data-auth-restart-modal="claude:local"]');
    expect(list).toBeTruthy();
    const items = [...(list?.querySelectorAll("[data-auth-restart-session]") ?? [])];
    expect(items.map((item) => item.getAttribute("data-auth-restart-session")))
      .toEqual(["s1", "s2"]);
    expect(screen.getByText("Fix the build")).toBeTruthy();
    expect(screen.getByText("Refactor auth")).toBeTruthy();
  });

  it("confirms via 'yes, restart now'", async () => {
    const { onRestartNow, onDecline } = renderModal();
    await userEvent.click(screen.getByRole("button", { name: "yes, restart now" }));
    expect(onRestartNow).toHaveBeenCalledTimes(1);
    expect(onDecline).not.toHaveBeenCalled();
  });

  it("declines via 'no' without touching the restart action", async () => {
    const { onRestartNow, onDecline } = renderModal();
    await userEvent.click(screen.getByRole("button", { name: "no" }));
    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(onRestartNow).not.toHaveBeenCalled();
  });

  it("treats closing the shell as a decline", async () => {
    const { onRestartNow, onDecline } = renderModal();
    await userEvent.keyboard("{Escape}");
    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(onRestartNow).not.toHaveBeenCalled();
  });
});
