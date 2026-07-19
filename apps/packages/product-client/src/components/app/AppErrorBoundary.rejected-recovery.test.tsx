// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("#product/components/app/AppErrorRecoverySurface", () => {
  throw new Error("recovery chunk failed to load");
});

import { AppErrorBoundary } from "#product/components/app/AppErrorBoundary";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("contains recovery enhancement rejection and keeps essential actions available", async () => {
  const onReload = vi.fn();
  let shouldCrash = true;

  function MaybeCrash() {
    if (shouldCrash) throw new Error("Workspace panel failed to render");
    return <p>View restored</p>;
  }

  render(
    <AppErrorBoundary onReload={onReload}>
      <MaybeCrash />
    </AppErrorBoundary>,
  );

  await waitFor(() => {
    expect(
      document.querySelector('[data-recovery-enhancement-status="unavailable"]'),
    ).toBeTruthy();
  });
  const reload = screen.getByRole("button", { name: "Reload app" });
  expect(document.activeElement).toBe(reload);

  fireEvent.click(reload);
  expect(onReload).toHaveBeenCalledTimes(1);

  shouldCrash = false;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(screen.getByText("View restored")).toBeTruthy();
});
