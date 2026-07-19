// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock(
  "#product/components/app/AppErrorRecoverySurface",
  () => new Promise<never>(() => {}),
);

import { AppErrorBoundary } from "#product/components/app/AppErrorBoundary";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("keeps focused reload and retry actions available while recovery enhancement is pending", () => {
  const onReload = vi.fn();
  const onRenderError = vi.fn(async () => true);
  let shouldCrash = true;

  function MaybeCrash() {
    if (shouldCrash) throw new Error("Workspace panel failed to render");
    return <p>View restored</p>;
  }

  render(
    <AppErrorBoundary onReload={onReload} onRenderError={onRenderError}>
      <MaybeCrash />
    </AppErrorBoundary>,
  );

  const reload = screen.getByRole("button", { name: "Reload app" });
  expect(document.activeElement).toBe(reload);
  expect(
    document.querySelector('[data-recovery-enhancement-status="loading"]'),
  ).toBeTruthy();
  expect(onRenderError).toHaveBeenCalledTimes(1);

  fireEvent.click(reload);
  expect(onReload).toHaveBeenCalledTimes(1);

  shouldCrash = false;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(screen.getByText("View restored")).toBeTruthy();
});
