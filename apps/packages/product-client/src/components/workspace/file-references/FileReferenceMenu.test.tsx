// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileReferenceMenuContent } from "#product/components/workspace/file-references/FileReferenceMenu";

type MenuActions = ComponentProps<typeof FileReferenceMenuContent>["actions"];

afterEach(cleanup);

describe("FileReferenceMenuContent", () => {
  it("renders exactly one enabled Copy path item for a nonempty unavailable reference", () => {
    const actions = makeActions({
      accessState: { status: "unavailable", reason: "invalid" },
      copyPath: "invalid:path",
    });
    const close = vi.fn();
    const { container } = render(<FileReferenceMenuContent actions={actions} close={close} />);

    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toBe("Copy path");
    expect(items[0].getAttribute("aria-disabled")).not.toBe("true");
    expect(Array.from(container.querySelectorAll("div")).some(
      (element) => element.className.includes("bg-border/70"),
    )).toBe(false);

    fireEvent.click(items[0]);
    expect(actions.copyCurrentPath).toHaveBeenCalledOnce();
    expect(actions.openDefault).not.toHaveBeenCalled();
    expect(actions.reveal).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("renders no menu model when copyPath is null", () => {
    const actions = makeActions({
      accessState: { status: "unavailable", reason: "empty" },
      copyPath: null,
    });
    const { container } = render(<FileReferenceMenuContent actions={actions} close={vi.fn()} />);
    expect(container.innerHTML).toBe("");
    expect(screen.queryByRole("menuitem")).toBeNull();
  });

  it("renders a remote workspace file as viewer plus Copy path", () => {
    const locator = {
      authority: "workspace" as const,
      workspacePath: "src/App.tsx",
      localCompanionPath: null,
    };
    const actions = makeActions({
      accessState: { status: "settled", locator, kind: "file" },
      pathKind: "file",
      canOpenInSidebar: true,
      copyPath: "src/App.tsx",
    });
    const { container } = render(
      <FileReferenceMenuContent actions={actions} close={vi.fn()} />,
    );

    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Open in viewer",
      "Copy path",
    ]);
    expect(separatorCount(container)).toBe(1);
    expect(screen.queryByText("Open externally")).toBeNull();
    expect(screen.queryByText("Reveal in Finder")).toBeNull();
  });

  it("renders a remote workspace directory as exactly Copy path", () => {
    const locator = {
      authority: "workspace" as const,
      workspacePath: "",
      localCompanionPath: null,
    };
    const actions = makeActions({
      accessState: { status: "settled", locator, kind: "directory" },
      pathKind: "directory",
      copyPath: ".",
    });
    const { container } = render(
      <FileReferenceMenuContent actions={actions} close={vi.fn()} />,
    );

    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Copy path",
    ]);
    expect(separatorCount(container)).toBe(0);
  });

  it("renders an ordinary local workspace directory as Copy path plus reveal", () => {
    const locator = {
      authority: "workspace" as const,
      workspacePath: "",
      localCompanionPath: "/repo",
    };
    const actions = makeActions({
      accessState: { status: "settled", locator, kind: "directory" },
      pathKind: "directory",
      canReveal: true,
      copyPath: "/repo",
    });
    const { container } = render(
      <FileReferenceMenuContent actions={actions} close={vi.fn()} />,
    );
    const items = screen.getAllByRole("menuitem");

    expect(items.map((item) => item.textContent)).toEqual([
      "Copy path",
      "Reveal folder in Finder",
    ]);
    expect(separatorCount(container)).toBe(0);
    fireEvent.click(items[0]);
    fireEvent.click(items[1]);
    expect(actions.copyCurrentPath).toHaveBeenCalledOnce();
    expect(actions.reveal).toHaveBeenCalledOnce();
    expect(actions.openDefault).not.toHaveBeenCalled();
    expect(actions.openWithTarget).not.toHaveBeenCalled();
  });
});

function makeActions(overrides: Partial<MenuActions>): MenuActions {
  const locator = { authority: "unavailable" as const, reason: "invalid" as const };
  return {
    reference: {
      rawPath: "invalid:path",
      parsedPath: "invalid:path",
      displayPath: "invalid:path",
      line: null,
      column: null,
      locator,
    },
    accessState: { status: "unavailable", reason: "invalid" },
    nativePathKind: null,
    openTargets: [],
    defaultOpenTarget: null,
    pathKind: null,
    pathKindPending: false,
    canOpenInSidebar: false,
    canOpenExternal: false,
    canOpenPrimary: false,
    canReveal: false,
    primaryUnavailableReason: "This path is invalid.",
    copyPath: "invalid:path",
    copyCurrentPath: vi.fn(async () => undefined),
    openInSidebar: vi.fn(async () => undefined),
    openDefault: vi.fn(async () => false),
    openPrimary: vi.fn(async () => "unavailable" as const),
    openWithTarget: vi.fn(async () => undefined),
    reveal: vi.fn(async () => undefined),
    ...overrides,
  };
}

function separatorCount(container: HTMLElement): number {
  return Array.from(container.querySelectorAll("div")).filter(
    (element) => element.className.includes("bg-border/70"),
  ).length;
}
